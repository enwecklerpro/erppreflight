import urllib.request
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

TOKEN = "13|wilwYkwrEj0dcUtiqh6GMq1FBNUIm9vk4UPxiXITd341595f"
BASE_URL = "http://187.124.174.130:8000"
APP_UUID = "b1jbemmdf9uioi0w2fdnnlb2"
DEP_UUID = sys.argv[1] if len(sys.argv) > 1 else "l7o1s1ton3upcslagzdpvuls"

def get(path):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json"
        }
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())

def monitor():
    print(f"Monitoring deployment: {DEP_UUID} ...")
    last_count = 0
    for _ in range(60): # up to 5 minutes
        try:
            dep = get(f"/api/v1/deployments/{DEP_UUID}")
            status = dep.get("status")
            logs = dep.get("logs") or []
            if isinstance(logs, str):
                try:
                    logs = json.loads(logs)
                except Exception:
                    logs = [logs]
            
            if len(logs) > last_count:
                for entry in logs[last_count:]:
                    if isinstance(entry, dict):
                        out = entry.get("output", "").strip()
                        print(out)
                    else:
                        print(str(entry).strip())
                last_count = len(logs)
            
            if status in ["finished", "failed", "killed", "error"]:
                print(f"\nFinal status: {status}")
                break
        except Exception as e:
            print(f"Polling error: {e}")
        time.sleep(5)

if __name__ == "__main__":
    monitor()
