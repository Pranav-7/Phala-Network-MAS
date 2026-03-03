# Attestation Storage API

TEE-backed attestation storage system for Phala Network with Intel TDX and NVIDIA GPU attestation support.

## Architecture

```
Agent 1 (Generator)          Storage API              Agent 2 (Verifier)
    Intel TDX         →     Intel TDX TEE      ←        Intel TDX
                            + Volume Storage
                            
    Collects:                Stores:                   Verifies:
    - Tool attestation       - All attestations        - Tool TEE
    - LLM attestation        - Provides TEE quote      - LLM TEE
    - Chat signature         - JSON storage            - Storage TEE
                                                        - Signatures
                                                        - Hash integrity
```

## Files

### Server (for Phala deployment)
- `server.js` - Main Express API server
- `package.json` - Node.js dependencies
- `Dockerfile` - Container configuration
- `docker-compose.yml` - Phala deployment config

### Clients (run locally)
- `get_attestation_api.cjs` - Collect and store attestations
- `verify_attestation_api.cjs` - Fetch and verify attestations

## API Endpoints

### Storage Operations
```
POST   /attestations                 - Store new attestation
GET    /attestations/:completion_id  - Retrieve attestation
GET    /attestations?limit=10        - List attestations
```

### TEE Attestation (Storage Server)
```
GET    /tee/info                     - TEE information
GET    /tee/attestation              - Generate attestation quote
GET    /tee/verify                   - Quick TEE verification
```

### Health
```
GET    /                             - API info
GET    /health                       - Health status
```

## Deployment Steps

### 1. Local Development

```bash
# Install dependencies
npm install

# Run locally
node server.js

# Test endpoints
curl http://localhost:8080/
curl http://localhost:8080/health
```

### 2. Docker Build & Test (Windows/Docker Desktop)

```bash
# Build image
docker build -t attestation-storage-api .

# Run locally
docker run -p 8080:8080 -v ${PWD}/storage:/app/storage attestation-storage-api

# Test
curl http://localhost:8080/
```

### 3. Push to Docker Hub

```bash
# Login to Docker Hub
docker login

# Tag image (replace 'yourusername')
docker tag attestation-storage-api yourusername/attestation-storage-api:latest

# Push
docker push yourusername/attestation-storage-api:latest
```

### 4. Deploy on Phala

1. Update `docker-compose.yml` with your Docker Hub username
2. Upload `docker-compose.yml` to Phala dashboard
3. Deploy
4. Note the public URL (e.g., `https://xxx.phala.network`)

### 5. Update Client Configuration

In both `get_attestation_api.cjs` and `verify_attestation_api.cjs`:

```javascript
const STORAGE_API_URL = 'https://xxx.phala.network';
```

Or set environment variable:
```bash
export STORAGE_API_URL=https://xxx.phala.network
```

## Usage

### Store Attestation

```bash
node get_attestation_api.cjs
```

Output:
```
Calling chat completion API...
Fetching tool attestation...
Fetching LLM attestation...
Fetching signature...
Storing attestation to API...
✅ Attestation stored successfully
Completion ID: chat-abc123
Retrieve at: https://xxx.phala.network/attestations/chat-abc123
```

### Verify Attestation

```bash
node verify_attestation_api.cjs chat-abc123
```

Output:
```
Starting verification process...

[1/6] Fetching attestation from storage API...
Attestation fetched successfully

Agent Communication Details:
Requested Agent: agent_1
Query: What is 2+2?
Receiver Agent: llm_agent
Response: 4

[2/6] Verifying Tool Attestation (Intel TDX)...
Tool Attestation: PASSED

[3/6] Verifying LLM Attestation (NVIDIA GPU)...
LLM Attestation: PASSED

[4/6] Verifying Storage Server Attestation (Intel TDX)...
Storage Server Attestation: PASSED
Storage App ID: abc123...
Storage Instance ID: def456...

[5/6] Verifying Signature...
Signature Verification: PASSED
Address Chain: PASSED

[6/6] Verifying Data Integrity...
Hash Integrity: PASSED

========================================
FINAL VERIFICATION RESULT
========================================
Tool Attestation (Intel TDX):     PASSED
LLM Attestation (NVIDIA GPU):     PASSED
Storage Attestation (Intel TDX):  PASSED
Signature Verification:           PASSED
Address Chain of Trust:           PASSED
Data Integrity Hash:              PASSED
========================================

Overall Status: VERIFIED
```

## Testing API Directly

### Store attestation
```bash
curl -X POST https://xxx.phala.network/attestations \
  -H "Content-Type: application/json" \
  -d @attestation_data.json
```

### Retrieve attestation
```bash
curl https://xxx.phala.network/attestations/chat-abc123
```

### List attestations
```bash
curl "https://xxx.phala.network/attestations?limit=5&offset=0"
```

### Get storage server TEE attestation
```bash
curl https://xxx.phala.network/tee/attestation
```

## Attestation Data Structure

```json
{
  "requested_agent": "agent_1",
  "requested_agent_query": "What is 2+2?",
  "rcvr_agent": "llm_agent",
  "rcvr_agent_response": "4",
  "completion_id": "chat-abc123",
  "tool_attestation": "hex-string...",
  "llm_attestation": "json-string...",
  "agent_attestation": "",
  "chat_signature": {
    "text_hash": "...",
    "signature": "0x...",
    "signing_address": "0x..."
  },
  "timestamp": "2025-11-25T12:00:00.000Z",
  "hash": "sha256:..."
}
```

## Verification Chain

The system verifies a complete chain of trust:

1. **Tool Attestation** - Proves tools run in Intel TDX TEE
2. **LLM Attestation** - Proves LLM runs in NVIDIA GPU TEE
3. **Storage Attestation** - Proves storage server runs in Intel TDX TEE
4. **Signature** - Proves LLM signed the response
5. **Address Chain** - Proves signing addresses match TEE instances
6. **Hash Integrity** - Proves data hasn't been tampered with

## Environment Variables

### Server
- `PORT` - Server port (default: 8080)
- `STORAGE_DIR` - Storage directory (default: /app/storage)
- `DSTACK_SOCKET_PATH` - Dstack socket (default: /var/run/dstack.sock)

### Clients
- `STORAGE_API_URL` - Storage API URL (default: http://localhost:8080)

## Troubleshooting

### DstackClient errors
- Ensure `/var/run/dstack.sock` is mounted in docker-compose.yml
- Check Phala dstack service is running

### Storage errors
- Verify volume is properly mounted
- Check disk space on Phala instance

### Network errors
- Ensure clients can reach storage API URL
- Check firewall rules

## Security Notes

- All components run in TEE (Trusted Execution Environment)
- Data integrity verified via cryptographic hashes
- Signatures prove authenticity of LLM responses
- Storage server provides its own attestation for verification
- Currently no authentication (public read/write for MVP)

## Future Enhancements

- Add API key authentication for write operations
- Implement signed URLs for downloads
- Add automatic cleanup of old attestations
- Support bulk export of attestations
- Add webhook notifications for new attestations
