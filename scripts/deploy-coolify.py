import urllib.request
import json
import os
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

TOKEN = os.environ.get("COOLIFY_API_TOKEN") or sys.exit("COOLIFY_API_TOKEN is not set")
BASE_URL = os.environ.get("COOLIFY_BASE_URL") or sys.exit("COOLIFY_BASE_URL is not set (e.g. http://<vps-ip>:8000)")
APP_UUID = os.environ.get("COOLIFY_APP_UUID") or sys.exit("COOLIFY_APP_UUID is not set")

def request(method, path, data=None):
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(f"{BASE_URL}{path}", data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())

def main():
    print(f"Triggering deployment for app {APP_UUID}...")
    res = request("POST", f"/api/v1/deploy?uuid={APP_UUID}&force_rebuild=true")
    print(f"Deploy response: {res}")
    
    dep_uuid = res.get("deployments", [{}])[0].get("deployment_uuid") if "deployments" in res else res.get("deployment_uuid")
    print(f"Deployment UUID: {dep_uuid}")

if __name__ == "__main__":
    main()
