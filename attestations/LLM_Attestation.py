#!/usr/bin/env python3
"""Complete LLM Verification: Chat Completion + TEE Attestation + Signature"""

import requests
import json
import base64
from eth_account.messages import encode_defunct
from eth_account import Account

API_KEY = 'sk-cb209387ad164ffb8aedd7a0d3ab57dc'
BASE_URL = 'https://865d4c24102519d7d0a91f5918902ff1ca4b9670-3000.dstack-prod5.phala.network'
MODEL = 'openai/gpt-oss-120b'
NVIDIA_URL = 'https://nras.attestation.nvidia.com/v3/attest/gpu'


def decode_jwt(token):
    """Decode JWT payload"""
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        payload = parts[1]
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += '=' * padding
        decoded = base64.urlsafe_b64decode(payload)
        return json.loads(decoded)
    except Exception as e:
        print(f'JWT decode error: {e}')
        return None


def chat_completion(message):
    """Step 1: Chat completion"""
    response = requests.post(
        f'{BASE_URL}/v1/chat/completions',
        headers={'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'},
        json={'model': MODEL, 'messages': [{'role': 'user', 'content': message}]}
    )
    return response.json()


def get_tee_report():
    """Step 2: Get TEE attestation report"""
    response = requests.get(
        f'{BASE_URL}/v1/attestation/report',
        headers={'Authorization': f'Bearer {API_KEY}'},
        params={'model': MODEL}
    )
    return response.json()


def get_signature(completion_id):
    """Step 4: Get signature for completion"""
    response = requests.get(
        f'{BASE_URL}/v1/signature/{completion_id}',
        headers={'Authorization': f'Bearer {API_KEY}'},
        params={'model': MODEL, 'signing_algo': 'ecdsa'}
    )
    return response.json()


def verify_nvidia_attestation(nvidia_payload):
    """Step 5: Verify NVIDIA TEE attestation"""
    evidence = json.loads(nvidia_payload)
    response = requests.post(
        NVIDIA_URL,
        headers={'Content-Type': 'application/json'},
        json=evidence
    )
    
    try:
        parsed_body = response.json()
        if isinstance(parsed_body, list) and len(parsed_body) > 0:
            first_element = parsed_body[0]
            if isinstance(first_element, list) and first_element[0] == 'JWT':
                jwt_payload = decode_jwt(first_element[1])
                if jwt_payload and 'x-nvidia-overall-att-result' in jwt_payload:
                    return jwt_payload['x-nvidia-overall-att-result'] is True
    except Exception as e:
        print(f'NVIDIA verification error: {e}')
    
    return False


def verify_signature(text_hash, signature):
    """Step 6: Verify signature and recover address"""
    message = encode_defunct(text=text_hash)
    recovered_address = Account.recover_message(message, signature=signature)
    return recovered_address


def main():
    print('=' * 60)
    print('COMPLETE LLM VERIFICATION CHAIN')
    print('=' * 60)
    
    # Step 1: Chat completion
    print('\n[1/6] Chat completion...')
    completion = chat_completion('What is 2+2?')
    completion_id = completion['id']
    response_text = completion['choices'][0]['message']['content']
    print(f'✓ Completion ID: {completion_id}')
    print(f'✓ Response: {response_text[:80]}...')
    
    # Step 2: Get TEE report
    print('\n[2/6] Fetching TEE attestation report...')
    attestation = get_tee_report()
    tee_signing_address = attestation['signing_address']
    nvidia_payload = attestation['nvidia_payload']
    print(f'✓ TEE Signing Address: {tee_signing_address}')
    
    # Step 3: Store TEE signing address
    print('\n[3/6] Storing TEE signing address...')
    stored_tee_address = tee_signing_address
    print(f'✓ Stored: {stored_tee_address}')
    
    # Step 4: Get signing response
    print('\n[4/6] Fetching signature for completion...')
    sig_data = get_signature(completion_id)
    text_hash = sig_data['text']
    signature = sig_data['signature']
    sig_response_address = sig_data['signing_address']
    print(f'✓ Text Hash: {text_hash}')
    print(f'✓ Signature: {signature}')
    print(f'✓ Signature Response Address: {sig_response_address}')
    
    # Step 5: Verify TEE report (NVIDIA attestation)
    print('\n[5/6] Verifying NVIDIA GPU attestation...')
    nvidia_verified = verify_nvidia_attestation(nvidia_payload)
    if nvidia_verified:
        print('✓ NVIDIA Attestation: PASSED (Genuine NVIDIA hardware in TEE)')
    else:
        print('✗ NVIDIA Attestation: FAILED')
        return False
    
    # Step 6: Verify signature
    print('\n[6/6] Verifying signature...')
    recovered_address = verify_signature(text_hash, signature)
    print(f'✓ Recovered Address: {recovered_address}')
    
    # Compare all 3 addresses
    print('\n' + '=' * 60)
    print('ADDRESS VERIFICATION')
    print('=' * 60)
    print(f'TEE Signing Address (Step 3):      {stored_tee_address}')
    print(f'Signature Response Address (Step 4): {sig_response_address}')
    print(f'Recovered Address (Step 6):          {recovered_address}')
    
    match_1 = stored_tee_address.lower() == sig_response_address.lower()
    match_2 = stored_tee_address.lower() == recovered_address.lower()
    match_3 = sig_response_address.lower() == recovered_address.lower()
    
    print(f'\nTEE ↔ Signature Response: {"✓ MATCH" if match_1 else "✗ MISMATCH"}')
    print(f'TEE ↔ Recovered:          {"✓ MATCH" if match_2 else "✗ MISMATCH"}')
    print(f'Signature ↔ Recovered:    {"✓ MATCH" if match_3 else "✗ MISMATCH"}')
    
    all_match = match_1 and match_2 and match_3
    
    print('\n' + '=' * 60)
    print('FINAL VERIFICATION RESULT')
    print('=' * 60)
    if nvidia_verified and all_match:
        print('✅ COMPLETE VERIFICATION PASSED')
        print('   • Hardware: Genuine NVIDIA GPU in TEE')
        print('   • Signature: Valid and matches TEE instance')
        print('   • Chain of Trust: VERIFIED')
        return True
    else:
        print('❌ VERIFICATION FAILED')
        if not nvidia_verified:
            print('   • NVIDIA attestation failed')
        if not all_match:
            print('   • Address mismatch detected')
        return False


if __name__ == '__main__':
    success = main()
    exit(0 if success else 1)