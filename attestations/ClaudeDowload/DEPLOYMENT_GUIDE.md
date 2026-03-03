# Quick Deployment Guide

## Files Created

### Server Files (Deploy to Phala)
1. **server.js** - Main Express API with TEE support
2. **package.json** - Dependencies (express, @phala/dstack-sdk)
3. **Dockerfile** - Container build configuration
4. **docker-compose.yml** - Phala deployment config
5. **.dockerignore** - Docker build exclusions

### Client Files (Run Locally)
6. **get_attestation_api.cjs** - Collect & store attestations to API
7. **verify_attestation_api.cjs** - Fetch & verify attestations from API

### Documentation
8. **README.md** - Complete documentation

## Quick Start

### Step 1: Local Server Test (Optional)
```bash
npm install
node server.js
# Visit http://localhost:8080
```

### Step 2: Build Docker Image
```bash
docker build -t attestation-storage-api .
docker run -p 8080:8080 attestation-storage-api
# Test: curl http://localhost:8080
```

### Step 3: Push to Docker Hub
```bash
docker login
docker tag attestation-storage-api YOUR_USERNAME/attestation-storage-api:latest
docker push YOUR_USERNAME/attestation-storage-api:latest
```

### Step 4: Update docker-compose.yml
Edit line 6:
```yaml
image: YOUR_USERNAME/attestation-storage-api:latest
```

### Step 5: Deploy on Phala
1. Go to Phala dashboard
2. Upload docker-compose.yml
3. Deploy
4. Copy the public URL (e.g., https://xxx.phala.network)

### Step 6: Configure Clients
In both client files, update:
```javascript
const STORAGE_API_URL = 'https://xxx.phala.network';
```

Or set environment variable:
```bash
export STORAGE_API_URL=https://xxx.phala.network
```

### Step 7: Test End-to-End

Install client dependencies:
```bash
npm install ethereumjs-util
```

Store attestation:
```bash
node get_attestation_api.cjs
# Note the completion_id from output
```

Verify attestation:
```bash
node verify_attestation_api.cjs <completion_id>
```

## File Locations

All files are in `/mnt/user-data/outputs/`:
- Server: server.js, package.json, Dockerfile, docker-compose.yml, .dockerignore
- Clients: get_attestation_api.cjs, verify_attestation_api.cjs
- Docs: README.md

## Important Notes

1. **Docker Hub Username**: Replace `yourusername` in docker-compose.yml with your actual Docker Hub username

2. **Phala Socket**: The `/var/run/dstack.sock` mounting is critical for TEE attestation

3. **Storage API URL**: Update both client files with your deployed Phala URL

4. **Testing**: Test server locally first, then in Docker, before pushing to Phala

5. **Dependencies**: Clients need `ethereumjs-util` package installed

## Verification Chain

Your system will verify:
- Tool TEE (Intel TDX)
- LLM TEE (NVIDIA GPU)
- Storage Server TEE (Intel TDX) ← NEW
- Digital signatures
- Address matching
- Data integrity

## Next Steps

1. Build and test server locally
2. Push to Docker Hub
3. Deploy on Phala
4. Update client URLs
5. Run end-to-end test
6. Monitor storage API endpoints

## Support

Check README.md for:
- Complete API documentation
- Troubleshooting guide
- Environment variables
- Security notes
