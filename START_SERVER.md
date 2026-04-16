# Starting the Mistral Backend Server

## Prerequisites
- Python 3.8+ installed
- Virtual environment already created at `backend\venv`
- `.env` file configured with `MISTRAL_API_KEY`

## Step 1: Start the Backend Server

Open Command Prompt or PowerShell and run:

```bash
cd "D:\my projects\my research\life agent"
backend\venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

You should see output like:
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started server process [xxxx]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

## Step 2: Test the API (in another terminal)

Once the server is running, test the `/api/chat` endpoint:

```bash
cd "D:\my projects\my research\life agent"
backend\venv\Scripts\python.exe test_api.py
```

Expected successful output:
```
Status Code: 200
Response: {
  "reply": "Hello! I'm working correctly."
}

✅ SUCCESS: Mistral API is working!
```

## API Endpoint

- **URL:** `http://127.0.0.1:8000/api/chat`
- **Method:** POST
- **Content-Type:** application/json

### Request Body
```json
{
  "message": "Your message here",
  "mode": "chat"
}
```

### Response
```json
{
  "reply": "Response from Mistral LLM"
}
```

## Example cURL Command

```bash
curl -X POST http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"Hello, how are you?\", \"mode\": \"chat\"}"
```

## Troubleshooting

### Error: MISTRAL_API_KEY is missing
- Check that `.env` file exists in `backend/` directory
- Verify `MISTRAL_API_KEY=your-key-here` is set in the file
- Restart the server

### Connection refused error
- Ensure the server is running on port 8000
- Check if another process is using port 8000
- Try changing port: `--port 8001`

### Module import errors
- Ensure virtual environment is active
- Check that all dependencies are installed: `pip install -r requirements.txt`
