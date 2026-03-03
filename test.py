# test.py
import requests
import fitz  # PyMuPDF

API = 'https://f006b170132550fedf03fb36412212b7000285fc-8080.dstack-pha-prod7.phala.network'
TEST_PDF = 'test_v2.pdf'
LLM_API = 'https://865d4c24102519d7d0a91f5918902ff1ca4b9670-3000.dstack-prod5.phala.network/v1/chat/completions'
LLM_KEY = 'sk-cb209387ad164ffb8aedd7a0d3ab57dc'

# Upload & download
upload_res = requests.get(f'{API}/sign/upload?name={TEST_PDF}')
upload_data = upload_res.json()
with open(TEST_PDF, 'rb') as f:
    files = {'file': (TEST_PDF, f, 'application/pdf')}
    requests.post(f'{API}{upload_data["upload_url"]}', files=files)

download_res = requests.get(f'{API}/sign/download/{upload_data["filename"]}')
pdf_res = requests.get(f'{API}{download_res.json()["download_url"]}')

# Extract text with PyMuPDF
doc = fitz.open(stream=pdf_res.content, filetype="pdf")
text = ""
for page in doc:
    text += page.get_text()
doc.close()

print("Extracted text:")
print(text[:500])

# Send to your GPT model
response = requests.post(
    LLM_API,
    headers={'Authorization': f'Bearer {LLM_KEY}', 'Content-Type': 'application/json'},
    json={
        'model': 'openai/gpt-oss-120b',
        'messages': [{
            'role': 'user',
            'content': f'Summarize this document:\n\n{text}'
        }]
    }
)

print("\nLLM Response:")
print(response.json())