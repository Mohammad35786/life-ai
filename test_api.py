import requests
import json
import time
import base64
import uuid

# Wait a moment for server to start
time.sleep(2)

url = "http://127.0.0.1:8000/api/chat"
payload = {
    "message": "Say hello and confirm you're working correctly",
    "mode": "chat"
}

# Generate a dummy ES256 token to bypass local auth checks
header = base64.urlsafe_b64encode(json.dumps({"alg": "ES256", "typ": "JWT"}).encode()).decode().rstrip("=")
jwt_payload = base64.urlsafe_b64encode(json.dumps({"sub": str(uuid.uuid4())}).encode()).decode().rstrip("=")
dummy_token = f"{header}.{jwt_payload}.dummy_signature"

headers = {
    "Authorization": f"Bearer {dummy_token}"
}

try:
    response = requests.post(url, json=payload, headers=headers, timeout=10)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    if response.status_code == 200:
        print("\n[SUCCESS] Mistral API is working!")
    else:
        print(f"\n[ERROR] Status Code: {response.status_code}")
except requests.exceptions.ConnectionError as e:
    print(f"[ERROR] Connection Error: Could not connect to server at {url}")
    print(f"   Details: {str(e)}")
except Exception as e:
    print(f"[ERROR] Error: {str(e)}")
