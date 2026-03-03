const https = require('https');
const http = require('http');
const crypto = require('crypto');

const API_KEY = 'sk-cb209387ad164ffb8aedd7a0d3ab57dc';
const BASE_URL = '865d4c24102519d7d0a91f5918902ff1ca4b9670-3000.dstack-prod5.phala.network';
const MODEL = 'openai/gpt-oss-120b';
const TOOL_ATTESTATION_URL = 'f006b170132550fedf03fb36412212b7000285fc-8080.dstack-pha-prod7.phala.network';

const STORAGE_API_URL = process.env.STORAGE_API_URL || 'https://9d8707e2db62a44b9b68b555467c7fae306ea9c8-8080.dstack-pha-prod7.phala.network';

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
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
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

async function chatCompletion(message) {
  const response = await httpsRequest(
    BASE_URL,
    '/v1/chat/completions',
    'POST',
    {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    {
      model: MODEL,
      messages: [{ role: 'user', content: message }]
    }
  );
  return response;
}

async function getToolAttestation() {
  const response = await httpsRequest(
    TOOL_ATTESTATION_URL,
    '/tee/attestation',
    'GET'
  );
  return response.attestation.quote;
}

async function getLLMAttestation() {
  const response = await httpsRequest(
    BASE_URL,
    `/v1/attestation/report?model=${MODEL}`,
    'GET',
    { 'Authorization': `Bearer ${API_KEY}` }
  );
  return response;
}

async function getSignature(completionId) {
  const response = await httpsRequest(
    BASE_URL,
    `/v1/signature/${completionId}?model=${MODEL}&signing_algo=ecdsa`,
    'GET',
    { 'Authorization': `Bearer ${API_KEY}` }
  );
  return response;
}

function calculateHash(obj) {
  const data = JSON.stringify(obj);
  return 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
}

async function storeAttestation(payload) {
  const response = await httpRequest(
    `${STORAGE_API_URL}/attestations`,
    'POST',
    { 'Content-Type': 'application/json' },
    payload
  );
  return response;
}

async function main() {
  const userMessage = 'Who is Satoshi Nakamoto?';
  
  console.log('Calling chat completion API...');
  const completion = await chatCompletion(userMessage);
  const completionId = completion.id;
  const responseText = completion.choices[0].message.content;
  
  console.log('Fetching tool attestation...');
  const toolAttestation = await getToolAttestation();
  
  console.log('Fetching LLM attestation...');
  const llmAttestation = await getLLMAttestation();
  
  console.log('Fetching signature...');
  const signatureData = await getSignature(completionId);
  
  const payload = {
    requested_agent: 'agent_1',
    requested_agent_query: userMessage,
    rcvr_agent: 'llm_agent',
    rcvr_agent_response: responseText,
    completion_id: completionId,
    tool_attestation: toolAttestation,
    llm_attestation: llmAttestation.nvidia_payload,
    agent_attestation: '',
    chat_signature: {
      text_hash: signatureData.text,
      signature: signatureData.signature,
      signing_address: signatureData.signing_address
    },
    timestamp: new Date().toISOString()
  };
  
  payload.hash = calculateHash(payload);
  
  console.log('Storing attestation to API...');
  const storeResponse = await storeAttestation(payload);
  
  if (storeResponse.statusCode === 200) {
    console.log(`✅ Attestation stored successfully`);
    console.log(`Completion ID: ${storeResponse.body.completion_id}`);
    console.log(`Retrieve at: ${STORAGE_API_URL}/attestations/${storeResponse.body.completion_id}`);
  } else {
    console.log(`❌ Failed to store attestation: ${storeResponse.statusCode}`);
    console.log(storeResponse.body);
  }
}

main().catch(console.error);
