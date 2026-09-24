import urllib.request
import json
import sys

TOKEN = "13|wilwYkwrEj0dcUtiqh6GMq1FBNUIm9vk4UPxiXITd341595f"
SERVER_UUID = "su2yhkdyfpc25wn39x1nat4s"
BASE_URL = "http://187.124.174.130:8000"

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
