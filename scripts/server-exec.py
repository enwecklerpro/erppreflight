import urllib.request
import json
import os
import sys

TOKEN = os.environ.get("COOLIFY_API_TOKEN") or sys.exit("COOLIFY_API_TOKEN is not set")
SERVER_UUID = os.environ.get("COOLIFY_SERVER_UUID") or sys.exit("COOLIFY_SERVER_UUID is not set")
BASE_URL = os.environ.get("COOLIFY_BASE_URL") or sys.exit("COOLIFY_BASE_URL is not set (e.g. http://<vps-ip>:8000)")

def run(cmd):
    url = f"{BASE_URL}/api/v1/servers/{SERVER_UUID}/command"
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    body = json.dumps({"command": cmd}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            print(data)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "docker ps"
    run(cmd)
