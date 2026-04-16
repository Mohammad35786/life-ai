import requests
import json

url = "http://localhost:8000/api/roadmaps/generate"
payload = {
    "topic": "Learn Python",
    "difficulty": "beginner",
    "provider": "default"
}

response = requests.post(url, json=payload)
with open("backend/scratch/output.json", "w") as f:
    json.dump(response.json(), f, indent=2)
print("Saved to output.json")
