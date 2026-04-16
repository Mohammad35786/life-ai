import requests

url = "http://localhost:8000/api/roadmaps/folders"
payload = {
    "name": "My Learning Roadmaps"
}

response = requests.post(url, json=payload)
print(response.json())
