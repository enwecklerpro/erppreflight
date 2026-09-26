# Runbook — Secret rotation

> Where secrets live: Coolify → Project → Environment variables (template: `.env.coolify.example`).
> Never in git. After changing a variable, **redeploy** the affected services in Coolify (restart is
> not enough when the value is interpolated into the compose file). Inventory and consequences:
> `SECURITY_REVIEW.md` §4. Generate values with `openssl rand -base64 48` (JWT) /
> `openssl rand -hex 32` (keys, passwords).

## 1. Coolify API token (and other leaked values) — **do this first**

A Coolify API token was committed to this public repository before commit `b08f142`, and demo /
super-admin passwords before `a242eb9`. Git history keeps them; assume they are compromised.

1. Coolify → **Keys & Tokens** → revoke every existing API token. Create a new token with the
   narrowest permission the helper scripts need; store it in your password manager.
2. Use it only via the environment: `export COOLIFY_API_TOKEN=…` before running
   `scripts/deploy-coolify.py`, `monitor-deployment.py`, `check-coolify.py`, `server-exec.py`.
   The token grants command execution on the server (`server-exec.py`) — treat it like root SSH.
3. Review Coolify → Server → Terminal/Activity and `/var/log/auth.log` for use of the old token
   since the leak; if anything is unexplained, follow `INCIDENT_RESPONSE.md`.
4. Change or disable the historical accounts in production:
   ```bash
   docker exec -it erppreflight-postgres psql -U erppreflight -d erppreflight -c \
     "UPDATE users SET status='SUSPENDED' WHERE email IN ('contact@erppreflight.com','demo.client@erppreflight.com')"
   ```
   (or log in and change the password). Bootstrap never resets existing accounts, so this is manual.
   Then rotate `JWT_SECRET` (§2) so sessions issued with the old passwords end.
5. Record the rotation date in `SECURITY_REVIEW.md` §5 (S1 → resolved).

## 2. `JWT_SECRET`

Signs user JWTs and agent-gate execution tokens (`apps/api/src/modules/agent-gate/agent-gate.service.ts`).

- **Consequence:** every user is logged out (tokens fail with 401 → the web redirects to login);
  agent-gate execution tokens that were issued but not yet used become invalid and must be re-issued.
  No stored data depends on it.
- Steps: set the new value (≥ 32 chars, not a known default — the API refuses to start otherwise) →
  redeploy `api` → verify `POST /api/v1/auth/login` works → announce the forced re-login.
- There is no per-user revocation (SECURITY_REVIEW S12): rotating this secret is the only way to
  end all live sessions immediately.

## 3. `MASTER_ENCRYPTION_KEY`

Keys the HMAC in secret-redaction masks (`apps/api/src/modules/redaction/secret-redactor.service.ts`):
a secret found in an upload is stored as `[REDACTED:SECRET:<hmac>]`. It does **not** encrypt data at rest.

- **Consequence:** stored files, findings and reports remain readable. Masks created after the
  rotation differ from masks created before for the same secret value, so "the same credential
  appears in files X and Y" can no longer be correlated across the rotation date. Keep the old value
  in the password manager (labelled with the rotation date) if such correlation matters for an
  investigation.
- Steps: set new value (≥ 32 chars) → redeploy `api`. Rotate only when the key is suspected leaked
  (it would let an attacker confirm guesses of redacted secrets offline).

## 4. `POSTGRES_PASSWORD`

The image applies `POSTGRES_PASSWORD` **only when the data volume is initialised**; changing the
variable alone locks the API out. Order:

```bash
docker exec -it erppreflight-postgres psql -U erppreflight -d postgres \
  -c "ALTER ROLE erppreflight WITH PASSWORD '<new>'"      # password_encryption defaults to scram-sha-256
```

then set `POSTGRES_PASSWORD=<new>` in Coolify and redeploy `api` (it builds `DATABASE_URL` from it).
Update `/opt/erppreflight/backup.env` only if it contains DB credentials (the backup script uses the
container socket and does not). The runtime role `erppreflight_app` is `NOLOGIN` — nothing to rotate.

## 5. `S3_ACCESS_KEY` / `S3_SECRET_KEY` (MinIO root)

MinIO reads `MINIO_ROOT_USER/PASSWORD` from these on start. Set both new values in Coolify →
redeploy `minio` **and** `api` together → update `/opt/erppreflight/backup.env`.
Consequence: presigned URLs issued before the change (≤ 15 min lifetime) stop working. Data is untouched.

## 6. Other credentials

| Secret | Steps |
|---|---|
| `METRICS_TOKEN` | Set new value → redeploy api → update the Prometheus scrape config |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Roll in the Stripe dashboard → update env → redeploy api → send a test webhook |
| `ADMIN_BOOTSTRAP_PASSWORD` | Used once; after the admin exists remove the variable and change the password in the UI |
| Webhook signing secrets (per tenant, stored in DB) | Tenant admin deletes and re-registers the endpoint in Settings |
| API keys (per tenant, stored as SHA-256 hash) | Tenant revokes and generates a new key in Settings |
| Off-site backup store credentials | Rotate at the provider; update rclone config |
| GitHub: `GITHUB_TOKEN` is ephemeral per workflow run; release signing is keyless (no key to rotate) | — |

## 7. Verify after any rotation

```bash
curl -s https://api.erppreflight.com/health/readiness | jq .status
API_BASE_URL=https://api.erppreflight.com bash scripts/e2e-live-smoke.sh
```
