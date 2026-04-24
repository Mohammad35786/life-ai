setup.ps1 (first-time only)
python -m venv backend\venv
.\backend\venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt


start_server.ps1 (every time)
for backend:
.\backend\venv\Scripts\Activate.ps1
uvicorn backend.main:app --reload


test_api.ps1 (test the API)
.\backend\venv\Scripts\Activate.ps1  (if not already activated)
python test_api.py


Port conflict?
uvicorn backend.main:app --reload --port 8001


for frontend:
cd frontend
npm run dev