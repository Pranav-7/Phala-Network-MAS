#!/usr/bin/env python3
"""
CALCULATE COMPOSE-HASH FROM APPCOMPOSE JSON

This script shows you EXACTLY how to calculate the compose-hash
from the docker_compose_file field in your AppCompose JSON.
"""

import hashlib
import json

# Your complete AppCompose JSON (from the attestation)
APP_COMPOSE_JSON = """{
    "allowed_envs":[
        "PORT",
        "STORAGE_DIR",
        "SIGN_SECRET"
    ],
    "docker_compose_file":"version: '3.8'\\n\\nservices:\\n  pdf-api:\\n    image: pranav6773/pdf-secure-api:latest\\n    container_name: pdf-secure-api\\n    restart: unless-stopped\\n    ports:\\n      - \\"8080:8080\\"\\n    environment:\\n      - PORT=8080\\n      - STORAGE_DIR=/app/storage\\n      - SIGN_SECRET=${SIGN_SECRET}\\n    volumes:\\n      - pdf-storage:/app/storage\\n\\nvolumes:\\n  pdf-storage:\\n    driver: local",
    "features":[
        "kms",
        "tproxy-net"
    ],
    "gateway_enabled":true,
    "kms_enabled":true,
    "local_key_provider_enabled":false,
    "manifest_version":2,
    "name":"",
    "no_instance_id":false,
    "public_logs":true,
    "public_sysinfo":true,
    "public_tcbinfo":true,
    "runner":"docker-compose",
    "secure_time":false,
    "storage_fs":"zfs",
    "tproxy_enabled":true
}"""

# Expected compose-hash from attestation
EXPECTED_COMPOSE_HASH = "92c5594154a8aa2556a0e329ab1cf85aa03491351660d0f6d7b7c3bc2365e177"

print("""
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║               CALCULATE COMPOSE-HASH - THE RIGHT Way                         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
""")

print("=" * 80)
print("STEP 1: PARSE THE APPCOMPOSE JSON")
print("=" * 80)

# Parse the JSON
app_compose = json.loads(APP_COMPOSE_JSON)

print("\n✅ JSON parsed successfully!")
print(f"   Fields found: {len(app_compose)} fields")
print(f"   Contains 'docker_compose_file': {('docker_compose_file' in app_compose)}")

print("\n" + "=" * 80)
print("STEP 2: EXTRACT THE docker_compose_file FIELD")
print("=" * 80)

# Get the docker_compose_file content
docker_compose_content = app_compose['docker_compose_file']

print("\nThe docker_compose_file field contains:")
print("-" * 80)
print(docker_compose_content)
print("-" * 80)

print(f"\nString length: {len(docker_compose_content)} characters")
print(f"Contains newlines: {'\\n' in docker_compose_content}")

print("\n" + "=" * 80)
print("STEP 3: CALCULATE SHA-256 HASH")
print("=" * 80)

# Calculate SHA-256 of the docker_compose_file content
compose_hash = hashlib.sha256(docker_compose_content.encode('utf-8')).hexdigest()

print("\n🔢 CALCULATION:")
print(f"   Input: docker_compose_file string")
print(f"   Encoding: UTF-8")
print(f"   Algorithm: SHA-256")
print(f"   Output: {compose_hash}")

print("\n" + "=" * 80)
print("STEP 4: VERIFICATION")
print("=" * 80)

print(f"\nCalculated compose-hash:")
print(f"  {compose_hash}")

print(f"\nExpected compose-hash (from attestation):")
print(f"  {EXPECTED_COMPOSE_HASH}")

print(f"\n{'✅ MATCH!' if compose_hash == EXPECTED_COMPOSE_HASH else '❌ NO MATCH'}")

if compose_hash == EXPECTED_COMPOSE_HASH:
    print("\n🎉 SUCCESS! You've successfully calculated the compose-hash!")
    print("\nThis proves:")
    print("  ✅ The docker_compose_file in AppCompose is correct")
    print("  ✅ The SHA-256 hash matches the attestation")
    print("  ✅ Your deployment configuration is verified")
else:
    print("\n⚠️  Hashes don't match. Let's debug:")
    print(f"\n   Length of calculated hash: {len(compose_hash)}")
    print(f"   Length of expected hash: {len(EXPECTED_COMPOSE_HASH)}")
    print(f"   Input length: {len(docker_compose_content)} chars")
    print(f"   Input bytes: {len(docker_compose_content.encode('utf-8'))} bytes")

print("\n" + "=" * 80)
print("SHOW ME THE BYTES")
print("=" * 80)

# Show the first 100 bytes in hex
content_bytes = docker_compose_content.encode('utf-8')
print(f"\nFirst 100 bytes (hex):")
print(content_bytes[:100].hex())

print(f"\nFirst 50 characters:")
print(repr(docker_compose_content[:50]))

print("\n" + "=" * 80)
print("MANUAL VERIFICATION STEPS")
print("=" * 80)

print("""
To verify this yourself manually:

METHOD 1: Using Python
-----------------------
import hashlib
import json

# Load your AppCompose JSON
with open('app-compose.json', 'r') as f:
    data = json.load(f)

# Extract docker_compose_file
compose_content = data['docker_compose_file']

# Calculate SHA-256
hash_value = hashlib.sha256(compose_content.encode('utf-8')).hexdigest()
print(f"compose-hash: {hash_value}")


METHOD 2: Using Command Line
-----------------------------
# Save the docker_compose_file content to a file (keeping \\n as actual newlines)
# Then:
sha256sum docker-compose.yml


METHOD 3: Using This Script
----------------------------
# Just run this script!
python calculate_compose_hash.py


METHOD 4: Using Node.js
-----------------------
const crypto = require('crypto');
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('app-compose.json', 'utf8'));
const composeContent = data.docker_compose_file;
const hash = crypto.createHash('sha256').update(composeContent, 'utf8').digest('hex');
console.log('compose-hash:', hash);
""")

print("\n" + "=" * 80)
print("SAVE THE DOCKER-COMPOSE CONTENT TO FILE")
print("=" * 80)

# Save the actual content to a file
output_file = "/tmp/extracted-docker-compose.yml"
with open(output_file, 'w') as f:
    f.write(docker_compose_content)

print(f"\n✅ Saved docker_compose_file content to: {output_file}")
print("\nYou can now verify with command line:")
print(f"  sha256sum {output_file}")

# Calculate hash of the saved file to verify
import os
if os.path.exists(output_file):
    with open(output_file, 'rb') as f:
        file_hash = hashlib.sha256(f.read()).hexdigest()
    print(f"\nSHA-256 of saved file: {file_hash}")
    print(f"Matches calculated:    {file_hash == compose_hash}")

print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)

print(f"""
What you calculated:
  Source: docker_compose_file field from AppCompose JSON
  Method: SHA-256 hash
  Result: {compose_hash}

What was expected:
  Source: compose-hash from attestation
  Result: {EXPECTED_COMPOSE_HASH}

Status: {'✅ VERIFIED!' if compose_hash == EXPECTED_COMPOSE_HASH else '❌ Mismatch'}

{
"This means the docker_compose_file in your AppCompose JSON is exactly what's " +
"being attested to by Phala!" if compose_hash == EXPECTED_COMPOSE_HASH else
"There may be a formatting difference. Check whitespace and line endings."
}
""")

print("=" * 80)
print()