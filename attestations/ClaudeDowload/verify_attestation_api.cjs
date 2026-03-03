const https = require('https');
const http = require('http');
const crypto = require('crypto');

const INTEL_VERIFY_URL = 'cloud-api.phala.network';
const NVIDIA_VERIFY_URL = 'nras.attestation.nvidia.com';

const STORAGE_API_URL = process.env.STORAGE_API_URL || 'http://localhost:8080';

function httpsRequest(hostname, path, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path,
      method,
      headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function httpRequest(url, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers
    };

    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    let payload = parts[1];
    const padding = 4 - (payload.length % 4);
    if (padding !== 4) {
      payload += '='.repeat(padding);
    }
    
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (e) {
    return null;
  }
}

async function fetchAttestation(completionId) {
  const response = await httpRequest(
    `${STORAGE_API_URL}/attestations/${completionId}`,
    'GET'
  );
  return response;
}

async function fetchStorageAttestation() {
  const response = await httpRequest(
    `${STORAGE_API_URL}/tee/attestation`,
    'GET'
  );
  return response;
}

async function verifyIntelAttestation(hex) {
  const response = await httpsRequest(
    INTEL_VERIFY_URL,
    '/api/v1/attestations/verify',
    'POST',
    { 'Content-Type': 'application/json' },
    { hex }
  );
  return response.body.quote && response.body.quote.verified === true;
}

async function verifyNvidiaAttestation(nvidiaPayload) {
  const evidence = JSON.parse(nvidiaPayload);
  const response = await httpsRequest(
    NVIDIA_VERIFY_URL,
    '/v3/attest/gpu',
    'POST',
    { 'Content-Type': 'application/json' },
    evidence
  );
  
  if (response.statusCode !== 200) return false;
  
  const body = response.body;
  if (Array.isArray(body) && body.length > 0) {
    const firstElement = body[0];
    if (Array.isArray(firstElement) && firstElement[0] === 'JWT') {
      const jwtPayload = decodeJWT(firstElement[1]);
      if (jwtPayload && 'x-nvidia-overall-att-result' in jwtPayload) {
        return jwtPayload['x-nvidia-overall-att-result'] === true;
      }
    }
  }
  
  return false;
}

function recoverAddress(messageHash, signature) {
  const ethUtil = require('ethereumjs-util');
  
  const messagePrefix = '\x19Ethereum Signed Message:\n';
  const prefixedMsg = Buffer.concat([
    Buffer.from(messagePrefix),
    Buffer.from(String(messageHash.length)),
    Buffer.from(messageHash)
  ]);
  
  const msgHash = ethUtil.keccak256(prefixedMsg);
  
  const sigBuffer = Buffer.from(signature.slice(2), 'hex');
  const r = sigBuffer.slice(0, 32);
  const s = sigBuffer.slice(32, 64);
  const v = sigBuffer[64];
  
  const pubKey = ethUtil.ecrecover(msgHash, v, r, s);
  const address = ethUtil.pubToAddress(pubKey);
  return '0x' + address.toString('hex');
}

function calculateHash(obj) {
  const { hash, ...rest } = obj;
  const data = JSON.stringify(rest);
  return 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
}

async function verify(completionId) {
  console.log('Starting verification process...\n');
  
  console.log('[1/6] Fetching attestation from storage API...');
  const fetchResponse = await fetchAttestation(completionId);
  
  if (fetchResponse.statusCode !== 200) {
    console.log(`Failed to fetch attestation: ${fetchResponse.statusCode}`);
    return false;
  }
  
  const data = fetchResponse.body;
  console.log('Attestation fetched successfully\n');
  
  console.log('Agent Communication Details:');
  console.log(`Requested Agent: ${data.requested_agent}`);
  console.log(`Query: ${data.requested_agent_query}`);
  console.log(`Receiver Agent: ${data.rcvr_agent}`);
  console.log(`Response: ${data.rcvr_agent_response}\n`);
  
  console.log('[2/6] Verifying Tool Attestation (Intel TDX)...');
  const toolVerified = await verifyIntelAttestation(data.tool_attestation);
  console.log(`Tool Attestation: ${toolVerified ? 'PASSED' : 'FAILED'}\n`);
  
  console.log('[3/6] Verifying LLM Attestation (NVIDIA GPU)...');
  const llmVerified = await verifyNvidiaAttestation(data.llm_attestation);
  console.log(`LLM Attestation: ${llmVerified ? 'PASSED' : 'FAILED'}\n`);
  
  console.log('[4/6] Verifying Storage Server Attestation (Intel TDX)...');
  const storageAttestationResponse = await fetchStorageAttestation();
  let storageVerified = false;
  
  if (storageAttestationResponse.statusCode === 200) {
    const storageAttestation = storageAttestationResponse.body;
    if (storageAttestation.attestation && storageAttestation.attestation.quote) {
      storageVerified = await verifyIntelAttestation(storageAttestation.attestation.quote);
      console.log(`Storage Server Attestation: ${storageVerified ? 'PASSED' : 'FAILED'}`);
      if (storageVerified) {
        console.log(`Storage App ID: ${storageAttestation.tee_info.app_id}`);
        console.log(`Storage Instance ID: ${storageAttestation.tee_info.instance_id}`);
      }
    }
  } else {
    console.log('Storage Server Attestation: FAILED (could not fetch)');
  }
  console.log('');
  
  console.log('[5/6] Verifying Signature...');
  let signatureVerified = false;
  let addressesMatch = false;
  
  try {
    const recoveredAddress = recoverAddress(
      data.chat_signature.text_hash,
      data.chat_signature.signature
    );
    
    const addr1 = data.chat_signature.signing_address.toLowerCase();
    const addr2 = recoveredAddress.toLowerCase();
    
    addressesMatch = addr1 === addr2;
    signatureVerified = addressesMatch;
    
    console.log(`Signature Verification: ${signatureVerified ? 'PASSED' : 'FAILED'}`);
    console.log(`Address Chain: ${addressesMatch ? 'PASSED' : 'FAILED'}\n`);
  } catch (e) {
    console.log(`Signature Verification: FAILED`);
    console.log(`Error: ${e.message}\n`);
  }
  
  console.log('[6/6] Verifying Data Integrity...');
  const expectedHash = calculateHash(data);
  const hashValid = expectedHash === data.hash;
  console.log(`Hash Integrity: ${hashValid ? 'PASSED' : 'FAILED'}\n`);
  
  console.log('========================================');
  console.log('FINAL VERIFICATION RESULT');
  console.log('========================================');
  console.log(`Tool Attestation (Intel TDX):     ${toolVerified ? 'PASSED' : 'FAILED'}`);
  console.log(`LLM Attestation (NVIDIA GPU):     ${llmVerified ? 'PASSED' : 'FAILED'}`);
  console.log(`Storage Attestation (Intel TDX):  ${storageVerified ? 'PASSED' : 'FAILED'}`);
  console.log(`Signature Verification:           ${signatureVerified ? 'PASSED' : 'FAILED'}`);
  console.log(`Address Chain of Trust:           ${addressesMatch ? 'PASSED' : 'FAILED'}`);
  console.log(`Data Integrity Hash:              ${hashValid ? 'PASSED' : 'FAILED'}`);
  console.log('========================================');
  
  const allPassed = toolVerified && llmVerified && storageVerified && signatureVerified && addressesMatch && hashValid;
  console.log(`\nOverall Status: ${allPassed ? 'VERIFIED' : 'VERIFICATION FAILED'}`);
  
  return allPassed;
}

const completionId = process.argv[2];
if (!completionId) {
  console.log('Usage: node verify_attestation_api.cjs <completion_id>');
  process.exit(1);
}

verify(completionId).catch(console.error);
