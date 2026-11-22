"""Run the app and the Django API together for local development.

    python tools/dev_server.py [port]

Uses server/.venv (create it with: uv venv server/.venv && uv pip install --python server/.venv -r server/requirements.txt),
migrates the local database, and serves the app from the repository root in debug mode.
"""
import os
import subprocess
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / 'server'
PY = SERVER / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')

if __name__ == '__main__':
    port = sys.argv[1] if len(sys.argv) > 1 else '5179'
    env = {**os.environ, 'DJANGO_DEBUG': '1', 'DJANGO_ALLOWED_HOSTS': 'localhost,127.0.0.1'}
    for args in (['migrate', '--noinput', '-v', '0'], ['createcachetable']):
        subprocess.run([str(PY), 'manage.py', *args], cwd=SERVER, env=env, check=True)
    subprocess.run([str(PY), 'manage.py', 'runserver', f'127.0.0.1:{port}'], cwd=SERVER, env=env)
