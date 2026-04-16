
#!/usr/bin/env python
import subprocess
import sys
import os

os.chdir("D:\\my projects\\my research\\life agent")
venv_python = "backend\\venv\\Scripts\\python.exe"
subprocess.run([venv_python, "-m", "uvicorn", "backend.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"])
