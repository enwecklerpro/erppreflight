import urllib.request
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

TOKEN = os.environ.get("COOLIFY_API_TOKEN") or sys.exit("COOLIFY_API_TOKEN is not set")
BASE_URL = os.environ.get("COOLIFY_BASE_URL") or sys.exit("COOLIFY_BASE_URL is not set (e.g. http://<vps-ip>:8000)")

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

def main():
    deployments = get("/api/v1/deployments")
    print(f"Deployments count: {len(deployments)}")
    for d in deployments:
        dep_id = d.get("id")
        status = d.get("status")
        updated = d.get("updated_at")
        logs = d.get("logs") or []
        if isinstance(logs, str):
            try:
                logs = json.loads(logs)
            except Exception:
                pass
        print(f"Deployment {dep_id}: status={status}, updated={updated}, log_entries={len(logs)}")
        if logs:
            print("--- Last 8 log lines ---")
            for entry in logs[-15:]:
                if isinstance(entry, dict):
                    out = entry.get("output", "").strip()
                    ts = entry.get("timestamp", "")
                    print(f"[{ts}] {out}")
                else:
                    print(str(entry).strip())
            print("------------------------")

    apps = get("/api/v1/applications")
    print(f"\nApplications count: {len(apps)}")
    for a in apps:
        print(f"App: {a.get('name')} | UUID: {a.get('uuid')} | Status: {a.get('status')} | FQDN: {a.get('fqdn')}")

if __name__ == "__main__":
    main()
