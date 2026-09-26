# Runbook — TLS certificate renewal

> TLS terminates at Coolify's Traefik proxy. Certificates come from Let's Encrypt via the
> `letsencrypt` cert resolver referenced in the `traefik.*` labels of `web` and `api` in
> `docker-compose.coolify.yml` (hosts `erppreflight.com`, `www.erppreflight.com`,
> `api.erppreflight.com`). Renewal is automatic ~30 days before expiry (90-day certificates).
> The application containers never hold certificates.

## Check expiry

```bash
for h in erppreflight.com www.erppreflight.com api.erppreflight.com; do
  printf '%-24s ' "$h"
  echo | openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null | openssl x509 -noout -enddate -issuer
done
```

Alert threshold: < 20 days remaining means automatic renewal has failed.

## Why renewal fails and how to fix it

| Cause | Check | Fix |
|---|---|---|
| DNS A record no longer points to the VPS | `dig +short api.erppreflight.com` = VPS IP | Fix DNS at the registrar (Hostinger hPanel) |
| Port 80 blocked (HTTP-01 challenge) | `curl -I http://api.erppreflight.com/.well-known/acme-challenge/test` reaches Traefik (404 from Traefik, not a timeout) | Open 80/tcp in ufw and the Hostinger firewall; keep the `*-http` routers in the compose labels |
| Let's Encrypt rate limit (too many failed attempts / duplicate certs) | Traefik log: `urn:ietf:params:acme:error:rateLimited` | Wait for the window (1 h for failed validations, 7 days for duplicates); do not loop redeploys |
| Traefik lost its ACME storage (`acme.json`) after a proxy reset | Coolify → Servers → Proxy → logs | Restart the proxy in Coolify; it re-issues (watch rate limits) |
| Router label typo after a compose edit | `docker inspect erppreflight-api --format '{{json .Config.Labels}}'` | Labels must keep `tls=true`, `tls.certresolver=letsencrypt`, `entrypoints=https` |

Proxy logs: `docker logs --since 1h coolify-proxy 2>&1 | grep -i -E 'acme|certificate|error'`.

## Force a renewal

Coolify → Servers → Proxy → **Restart proxy**. Traefik re-checks all routers and renews what is
due. As a last resort remove the specific certificate from `acme.json` (back it up first:
`/data/coolify/proxy/acme.json` on Coolify v4) and restart the proxy.

## After renewal

```bash
curl -sI https://api.erppreflight.com/health/liveness | head -1
curl -sI https://erppreflight.com | head -1
```

HSTS is not configured yet (SECURITY_REVIEW S2), so browsers do not pin; once HSTS is added, never let a
certificate lapse — clients will refuse plain-HTTP fallback.
