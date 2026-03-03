// NVIDIA GPU Attestation Verification Script (Fixed for JWT responses)
// This script properly handles JWT-based attestation responses

const API_KEY = 'sk-cb209387ad164ffb8aedd7a0d3ab57dc';
const BASE_URL = 'https://865d4c24102519d7d0a91f5918902ff1ca4b9670-3000.dstack-prod5.phala.network';
const MODEL = 'openai/gpt-oss-120b';
const NVIDIA_ATTESTATION_URL = 'https://nras.attestation.nvidia.com/v3/attest/gpu';

// Function to decode JWT without verification (just to read the payload)
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    // Decode the payload (second part)
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error('Error decoding JWT:', error.message);
    return null;
  }
}

async function getAttestationReport() {
  console.log('📥 Fetching attestation report...\n');
  
  const response = await fetch(
    `${BASE_URL}/v1/attestation/report?model=${encodeURIComponent(MODEL)}`,
    {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch attestation: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

async function verifyNvidiaGPU(nvidiaPayload) {
  console.log('🔐 Verifying NVIDIA GPU attestation...\n');
  
  // Parse the nvidia_payload string to JSON
  const evidence = JSON.parse(nvidiaPayload);
  
  const response = await fetch(NVIDIA_ATTESTATION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(evidence)
  });

  const status = response.status;
  const responseBody = await response.text();
  
  // Try to parse as JSON
  let parsedBody;
  try {
    parsedBody = JSON.parse(responseBody);
  } catch (e) {
    return {
      verified: false,
      status: status,
      error: 'Failed to parse response',
      response: responseBody
    };
  }

  // NVIDIA returns an array: [["JWT", "token..."], {"GPU-0": "token..."}]
  // We need to decode the first JWT to get x-nvidia-overall-att-result
  
  let overallResult = null;
  let jwtPayload = null;
  
  // Check if response is an array with JWT
  if (Array.isArray(parsedBody) && parsedBody.length > 0) {
    const firstElement = parsedBody[0];
    
    if (Array.isArray(firstElement) && firstElement[0] === 'JWT' && firstElement[1]) {
      const jwtToken = firstElement[1];
      jwtPayload = decodeJWT(jwtToken);
      
      if (jwtPayload && jwtPayload['x-nvidia-overall-att-result'] !== undefined) {
        overallResult = jwtPayload['x-nvidia-overall-att-result'];
      }
    }
  }
  
  // Also check the old header method (fallback)
  const headerResult = response.headers.get('x-nvidia-overall-att-result');
  if (headerResult) {
    overallResult = headerResult === 'True' || headerResult === 'true';
  }
  
  const verified = overallResult === true || overallResult === 'True' || overallResult === 'true';
  
  return {
    verified: verified,
    status: status,
    overallResult: overallResult,
    jwtPayload: jwtPayload,
    response: responseBody
  };
}

async function main() {
  try {
    console.log('═══════════════════════════════════════════════════');
    console.log('  NVIDIA GPU TEE Attestation Verification');
    console.log('═══════════════════════════════════════════════════\n');

    // Step 1: Get attestation report
    const attestation = await getAttestationReport();
    
    console.log('✅ Attestation report received');
    console.log(`   Signing Address: ${attestation.signing_address}`);
    console.log(`   Signing Algorithm: ${attestation.signing_algo}`);
    console.log(`   App ID: ${attestation.info.app_id}`);
    console.log(`   Instance ID: ${attestation.info.instance_id}\n`);

    // Step 2: Verify NVIDIA GPU
    const nvidiaResult = await verifyNvidiaGPU(attestation.nvidia_payload);
    
    console.log('═══════════════════════════════════════════════════');
    console.log('  NVIDIA GPU Verification Result');
    console.log('═══════════════════════════════════════════════════\n');

    console.log(`NVIDIA GPU Attestation Details:${nvidiaResult}`);
    console.log(`NVIDIA GPU Attestation Details:${nvidiaResult.response}`);
    console.log(`NVIDIA GPU Attestation Details:${nvidiaResult.verified}`);
    
    if (nvidiaResult.verified) {
      console.log('✅ NVIDIA GPU VERIFICATION PASSED');
      console.log('   Status: Genuine NVIDIA Hardware in TEE Mode');
      console.log(`   HTTP Status: ${nvidiaResult.status}`);
      console.log(`   Overall Result: ${nvidiaResult.overallResult}`);
      
      if (nvidiaResult.jwtPayload) {
        console.log('\n📋 JWT Payload Details:');
        console.log(`   Issuer: ${nvidiaResult.jwtPayload.iss || 'N/A'}`);
        console.log(`   Subject: ${nvidiaResult.jwtPayload.sub || 'N/A'}`);
        console.log(`   Version: ${nvidiaResult.jwtPayload['x-nvidia-ver'] || 'N/A'}`);
        console.log(`   Issued At: ${new Date(nvidiaResult.jwtPayload.iat * 1000).toISOString()}`);
        console.log(`   Expires At: ${new Date(nvidiaResult.jwtPayload.exp * 1000).toISOString()}`);
      }
    } else {
      console.log('❌ NVIDIA GPU VERIFICATION FAILED');
      console.log(`   HTTP Status: ${nvidiaResult.status}`);
      console.log(`   Overall Result: ${nvidiaResult.overallResult}`);
      
      if (nvidiaResult.error) {
        console.log(`   Error: ${nvidiaResult.error}`);
      }
      
      if (nvidiaResult.jwtPayload) {
        console.log('\n📋 JWT Payload (for debugging):');
        console.log(JSON.stringify(nvidiaResult.jwtPayload, null, 2));
      }
    }
    
    console.log('\n═══════════════════════════════════════════════════\n');
    
    // Return verification result
    return {
      success: nvidiaResult.verified,
      attestation: {
        signingAddress: attestation.signing_address,
        appId: attestation.info.app_id,
        instanceId: attestation.info.instance_id
      },
      nvidia: {
        verified: nvidiaResult.verified,
        status: nvidiaResult.status,
        overallResult: nvidiaResult.overallResult
      }
    };

  } catch (error) {
    console.error('❌ Error during verification:', error.message);
    console.error(error);
    throw error;
  }
}

// Run the verification
main()
  .then(result => {
    console.log('Verification completed successfully');
    console.log(`Final Result: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('Verification failed');
    process.exit(1);
  });