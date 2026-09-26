#!/usr/bin/env python3
"""Live commercial & governance smoke test (audit trail, usage metering, plan
limits, billing webhooks, exports incl. ZIP_ALL, retention, feature flags,
support grants, super-admin incident view).

Usage:
  API_BASE_URL=http://localhost:3301 \\
  SUPER_ADMIN_EMAIL=owner@e2e.local SUPER_ADMIN_PASSWORD=... \\
  [STRIPE_WEBHOOK_SECRET=whsec_...] python3 scripts/e2e-commercial-smoke.py

Creates throwaway tenants. Stripe webhook checks run only when the API was
started with the same STRIPE_WEBHOOK_SECRET (payloads are signed locally).
"""
import hashlib
import hmac
import io
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

BASE = os.environ.get("API_BASE_URL", "http://localhost:3001").rstrip("/") + "/api/v1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "known_bad_billing_opd.xml")
FAILS = []


def ok(msg):
    print(f"PASS  {msg}")


def bad(msg, detail=""):
    print(f"FAIL  {msg} :: {str(detail)[:400]}")
    FAILS.append(msg)


def check(cond, msg, detail=""):
    ok(msg) if cond else bad(msg, detail)
    return cond


def call(method, path, token=None, body=None, raw=False, headers=None, data=None):
    h = {"Accept": "application/json"}
    if headers:
        h.update(headers)
    if token:
        h["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            content = r.read()
            return r.status, content if raw else _json(content), dict(r.headers)
    except urllib.error.HTTPError as e:
        content = e.read()
        return e.code, _json(content), dict(e.headers)


def _json(b):
    try:
        return json.loads(b)
    except Exception:
        return b


def upload(token, project_id, path):
    boundary = uuid.uuid4().hex
    with open(path, "rb") as f:
        payload = f.read()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{os.path.basename(path)}\"\r\n"
        f"Content-Type: application/xml\r\n\r\n"
    ).encode() + payload + f"\r\n--{boundary}--\r\n".encode()
    return call("POST", f"/projects/{project_id}/files", token, data=body,
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


def register(tag):
    email = f"{tag}{random.randint(10000, 99999)}@e2e.local"
    s, b, _ = call("POST", "/auth/register", body={
        "email": email, "password": "CommercialPass!2026", "fullName": tag, "organizationName": f"Org {tag} {random.randint(1000, 9999)}"})
    check(s in (200, 201) and "accessToken" in b, f"register {tag}", b)
    verify_email(email)
    return b["accessToken"], b["user"]["organizationId"], email


def verify_email(email):
    """Confirm the address via the dev mailbox (API must run with MAIL_TRANSPORT=dev)."""
    token = os.environ.get("MAIL_DEV_OUTBOX_TOKEN", "")
    for _ in range(30):
        req = urllib.request.Request(
            f"{BASE}/dev/mail/messages?to={urllib.parse.quote(email)}",
            headers={"X-Dev-Mailbox-Token": token})
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                items = json.loads(res.read() or b"{}").get("items", [])
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                check(False, "dev mailbox available (MAIL_TRANSPORT=dev)", exc.code)
            items = []
        links = [l for m in items if m.get("template") == "EMAIL_VERIFICATION" for l in m.get("links", [])]
        if links:
            s, b, _ = call("POST", "/auth/verify-email", body={"token": links[0].split("token=")[1]})
            check(s in (200, 201), f"verify e-mail {email}", b)
            return
        time.sleep(0.5)
    check(False, f"verification e-mail for {email}", "not received")


def run_analysis(token, project_id, file_id):
    s, b, _ = call("POST", "/analyses", token, {"projectId": project_id, "engineTypes": ["OPD_GUARD"], "fileIds": [file_id]})
    if s not in (200, 201):
        return s, b, None
    aid = b["analysisId"]
    status = None
    for _ in range(60):
        _, a, _ = call("GET", f"/analyses/{aid}", token)
        status = a.get("status") if isinstance(a, dict) else None
        if status in ("COMPLETED", "FAILED", "PARTIAL"):
            break
        time.sleep(2)
    return s, b, status


def main():
    sa_email = os.environ.get("SUPER_ADMIN_EMAIL")
    sa_password = os.environ.get("SUPER_ADMIN_PASSWORD")
    if not sa_email or not sa_password:
        print("SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD are required")
        return 2

    # --- Tenant setup, login audit (success + failure) ---------------------------------
    ta, org_a, email_a = register("carol")
    s, _, _ = call("POST", "/auth/login", body={"email": email_a, "password": "wrong-password"})
    check(s == 401, "wrong password -> 401")
    s, b, _ = call("POST", "/auth/login", body={"email": email_a, "password": "CommercialPass!2026"})
    ta = b["accessToken"]

    s, sa, _ = call("POST", "/auth/login", body={"email": sa_email, "password": sa_password})
    check(s == 200, "super admin login", sa)
    tsa = sa["accessToken"]

    # --- Billing overview: trial started at org creation, meters present ----------------
    s, ov, _ = call("GET", "/billing/overview", ta)
    check(s == 200 and ov["trial"]["active"] and ov["effectiveTier"] == "PROFESSIONAL" and ov["planTier"] == "FREE",
          "new org is on an active PROFESSIONAL trial over FREE", ov)
    check(len(ov.get("meters", [])) == 7, "billing overview exposes 7 usage meters")
    s, plans, _ = call("GET", "/billing/plans")
    check(s == 200 and any(p["tier"] == "ENTERPRISE" and p["monthlyPriceEur"] is None for p in plans["plans"]),
          "public plan catalog (Enterprise = contact sales)")
    if not ov["provider"]["configured"]:
        s, b, _ = call("POST", "/billing/checkout", ta, {"targetTier": "STARTER"})
        check(s == 503, "checkout without billing provider -> 503 (billing not configured)", b)

    # --- Project, upload, analysis ------------------------------------------------------
    s, p, _ = call("POST", "/projects", ta, {"name": "Commercial E2E", "description": "e2e", "targetRelease": "S4H_2023"})
    check(s in (200, 201), "create project", p)
    pid = p["id"]
    s, up, _ = upload(ta, pid, FIXTURE)
    check(s in (200, 201) and up.get("status") == "CLEAN", "upload fixture (CLEAN)", up)
    fid = up["fileId"]
    s, an, status = run_analysis(ta, pid, fid)
    check(status == "COMPLETED", f"analysis completed ({status})", an)
    aid = an["analysisId"]

    # --- Exports: every format incl. ZIP_ALL + report types -----------------------------
    magic = {"PDF": b"%PDF", "XLSX": b"PK", "ZIP_ALL": b"PK", "JSON_BUNDLE": b"{", "CSV": b"\xef\xbb\xbf", "HTML_OFFLINE": b"<!DOCTYPE"}
    for fmt, prefix in magic.items():
        s, ex, _ = call("POST", f"/projects/{pid}/analyses/{aid}/export", ta, {"format": fmt})
        if not check(s in (200, 201), f"export {fmt}", ex):
            continue
        s, content, hdr = call("GET", f"/reports/{ex['reportId']}/file", ta, raw=True)
        check(s == 200 and content.startswith(prefix), f"download {fmt} ({len(content)} bytes)", content[:40])
        if fmt == "ZIP_ALL" and s == 200:
            names = zipfile.ZipFile(io.BytesIO(content)).namelist()
            manifest = json.loads(zipfile.ZipFile(io.BytesIO(content)).read("manifest.json"))
            check(len(names) == 6 and len(manifest["files"]) == 5, f"ZIP_ALL contains manifest + 5 formats {names}")
    s, ex, _ = call("POST", f"/projects/{pid}/analyses/{aid}/export", ta, {"format": "JSON_BUNDLE", "reportType": "AUDIT"})
    s2, content, _ = call("GET", f"/reports/{ex['reportId']}/file", ta)
    check(s in (200, 201) and isinstance(content, dict) and len(content.get("audit_trail", [])) > 0
          and content["metadata"]["report_type"] == "AUDIT", "AUDIT report embeds the analysis audit trail")
    s, ex, _ = call("POST", f"/projects/{pid}/analyses/{aid}/export", ta, {"format": "JSON_BUNDLE", "reportType": "MIGRATION_BLOCKER"})
    check(s in (200, 201), "MIGRATION_BLOCKER report generated", ex)
    s, reports, _ = call("GET", f"/projects/{pid}/analyses/{aid}/reports", ta)
    check(s == 200 and len(reports) >= 8, f"report history lists {len(reports) if isinstance(reports, list) else '?'} reports")

    # --- Audit trail + verification -----------------------------------------------------
    s, log, _ = call("GET", "/audit/log?limit=200", ta)
    actions = {i["action"] for i in log.get("items", [])} if isinstance(log, dict) else set()
    for expected in ["auth.registered", "auth.login.failed", "auth.login.succeeded", "billing.trial.started", "project.created",
                     "artifact.uploaded", "analysis.queued", "analysis.engine.completed", "analysis.completed",
                     "report.generated", "report.downloaded"]:
        check(expected in actions, f"audit event {expected}")
    s, log2, _ = call("GET", "/audit/log?action=report.&limit=3", ta)
    check(s == 200 and all(i["action"].startswith("report.") for i in log2["items"]) and log2["nextCursor"] is not None,
          "audit log filter + keyset pagination")
    s, ver, _ = call("GET", "/audit/verify", ta)
    check(s == 200 and ver["isValid"] and ver["totalEventsVerified"] >= 20, f"audit chain verifies ({ver.get('totalEventsVerified')} events)", ver)

    # --- Usage metering -----------------------------------------------------------------
    s, ov, _ = call("GET", "/billing/overview", ta)
    m = ov["metered"]
    check(m.get("ANALYSIS_RUN") == 1 and m.get("ENGINE_EXECUTION") == 1 and m.get("ARTIFACT_UPLOAD") == 1
          and m.get("REPORT_EXPORT") >= 8 and m.get("ARTIFACT_BYTES", 0) > 0, f"usage metered {m}")

    # --- Plan-limit enforcement via super-admin override --------------------------------
    s, b, _ = call("PATCH", f"/admin/tenants/{org_a}/limits", tsa, {"analysesPerMonth": 1, "exportsPerMonth": 9})
    check(s == 200, "super admin sets tiny limits on test org", b)
    s, b, _ = call("POST", "/analyses", ta, {"projectId": pid, "engineTypes": ["OPD_GUARD"], "fileIds": [fid]})
    check(s == 402 and b.get("code") == "PLAN_LIMIT_EXCEEDED" and b.get("limitKey") == "analysesPerMonth",
          f"2nd analysis over limit -> {s} {b.get('code')}", b)
    s, b, _ = call("POST", f"/projects/{pid}/analyses/{aid}/export", ta, {"format": "CSV"})
    s, b, _ = call("POST", f"/projects/{pid}/analyses/{aid}/export", ta, {"format": "CSV"})
    check(s == 402 and b.get("limitKey") == "exportsPerMonth", f"export over limit -> {s}", b)
    s, b, _ = call("PATCH", f"/admin/tenants/{org_a}/limits", tsa, {})
    check(s == 200, "limits override cleared")

    # --- Stripe webhooks (locally signed) -----------------------------------------------
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
    if secret:
        def send(evt):
            raw = json.dumps(evt).encode()
            t = int(time.time())
            sig = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
            return call("POST", "/billing/webhook", data=raw,
                        headers={"Content-Type": "application/json", "Stripe-Signature": f"t={t},v1={sig}"})
        cus = f"cus_e2e_{random.randint(1000, 9999)}"
        evt = {"id": f"evt_{uuid.uuid4().hex}", "type": "checkout.session.completed",
               "data": {"object": {"client_reference_id": org_a, "customer": cus, "subscription": "sub_e2e",
                                    "metadata": {"target_tier": "STARTER"}}}}
        s, b, _ = send(evt)
        check(s == 200 and b.get("handled"), "webhook checkout.session.completed", b)
        s, b, _ = send(evt)
        check(s == 200 and b.get("duplicate"), "webhook replay is idempotent", b)
        s, ov, _ = call("GET", "/billing/overview", ta)
        check(ov["planTier"] == "STARTER" and ov["subscriptionStatus"] == "ACTIVE", "plan upgraded to STARTER / ACTIVE", ov)
        s, b, _ = send({"id": f"evt_{uuid.uuid4().hex}", "type": "invoice.payment_failed", "data": {"object": {"customer": cus}}})
        s, ov, _ = call("GET", "/billing/overview", ta)
        check(ov["subscriptionStatus"] == "PAST_DUE", "invoice.payment_failed -> PAST_DUE")
        s, b, _ = send({"id": f"evt_{uuid.uuid4().hex}", "type": "customer.subscription.deleted",
                        "data": {"object": {"id": "sub_e2e", "customer": cus, "status": "canceled", "metadata": {"organization_id": org_a}}}})
        s, ov, _ = call("GET", "/billing/overview", ta)
        check(ov["planTier"] == "FREE" and ov["subscriptionStatus"] == "CANCELED", "subscription.deleted -> FREE / CANCELED")
        raw = json.dumps({"id": "evt_forged", "type": "invoice.payment_failed", "data": {"object": {"customer": cus}}}).encode()
        s, b, _ = call("POST", "/billing/webhook", data=raw, headers={"Content-Type": "application/json",
                                                                    "Stripe-Signature": f"t={int(time.time())},v1={'0' * 64}"})
        check(s == 400, "forged webhook signature -> 400")
        s, log, _ = call("GET", "/audit/log?action=billing.subscription&limit=10", ta)
        check(len(log["items"]) >= 3, "billing changes audited")
    else:
        print("SKIP  Stripe webhook checks (STRIPE_WEBHOOK_SECRET not set)")

    # --- Retention: delete-after-analysis policy ----------------------------------------
    tb, org_b, _ = register("dave")
    s, p2, _ = call("POST", "/projects", tb, {"name": "Retention E2E", "description": "e2e", "targetRelease": "S4H_2023"})
    s, r, _ = call("PUT", "/retention/settings", tb, {"artifactRetentionDays": 0, "reportRetentionDays": 30})
    check(s == 200 and r["artifactRetentionDays"] == 0, "retention policy: delete artifacts after analysis", r)
    s, up2, _ = upload(tb, p2["id"], FIXTURE)
    s, an2, status2 = run_analysis(tb, p2["id"], up2["fileId"])
    time.sleep(1)
    s, files, _ = call("GET", f"/projects/{p2['id']}/files", tb)
    check(isinstance(files, list) and len(files) == 0, f"artifact purged after analysis ({status2})", files)
    s, log, _ = call("GET", "/audit/log?action=retention.&limit=10", tb)
    check(any(i["action"] == "retention.artifacts.purged" for i in log["items"]), "retention purge audited")
    s, r, _ = call("PUT", "/retention/settings", tb, {"artifactRetentionDays": 9999, "reportRetentionDays": 30})
    check(s == 400, "retention above plan maximum rejected")

    # --- Feature flags ------------------------------------------------------------------
    key = f"e2e.flag-{random.randint(1000, 9999)}"
    s, f, _ = call("PUT", f"/admin/feature-flags/{key}", tsa, {"description": "e2e", "enabled": True, "allowOrganizations": [org_b],
                                                                "rolloutPercentage": 0})
    check(s == 200 and f["key"] == key, "super admin creates feature flag", f)
    s, ev_b, _ = call("GET", "/feature-flags", tb)
    s, ev_a, _ = call("GET", "/feature-flags", ta)
    fb = next((x for x in ev_b["flags"] if x["key"] == key), None)
    fa = next((x for x in ev_a["flags"] if x["key"] == key), None)
    check(fb and fb["enabled"] and fb["reason"] == "ORGANIZATION_ALLOWED" and fa and not fa["enabled"],
          f"flag targeting: allowed org on, others {fa and fa['reason']}")
    s, _, _ = call("PUT", f"/admin/feature-flags/{key}", ta, {"enabled": True})
    check(s == 403, "tenant owner cannot manage flags (403)")
    call("DELETE", f"/admin/feature-flags/{key}", tsa)

    # --- Support: tickets, grants, support console --------------------------------------
    s, fl, _ = call("GET", f"/analyses/{aid}/findings", ta)
    rows = fl if isinstance(fl, list) else (fl.get("data") or fl.get("items") or []) if isinstance(fl, dict) else []
    finding_id = rows[0]["id"] if rows else None
    ticket = {"subject": "Finding looks wrong", "description": "The OPD finding seems incorrect.", "analysisId": aid}
    ticket.update({"category": "INCORRECT_FINDING", "findingId": finding_id} if finding_id else {"category": "QUESTION"})
    s, t, _ = call("POST", "/support/tickets", ta, ticket)
    check(s in (200, 201) and t.get("diagnostic", {}).get("analysis"), "incorrect-finding ticket with diagnostic", t)
    s, b, _ = call("GET", f"/admin/tenants/{org_a}", tsa)
    check(s == 400, "support console needs a grant or break-glass reason")
    s, g, _ = call("POST", "/support/access-grants", ta, {"reason": "Investigate ticket", "hours": 2})
    check(s in (200, 201) and g["active"], "tenant grants time-boxed support access", g)
    s, d, _ = call("GET", f"/admin/tenants/{org_a}", tsa)
    check(s == 200 and d["activeSupportGrant"]["id"] == g["id"] and len(d["recentAnalyses"]) >= 1, "support console tenant lookup")
    s, log, _ = call("GET", "/audit/log?action=support.&limit=10", ta)
    check({"support.ticket.created", "support.access.granted", "support.tenant_viewed"} <= {i["action"] for i in log["items"]},
          "support activity visible in tenant audit log")

    # --- Super admin: incidents, business, engines, tenant isolation of admin API -------
    s, inc, _ = call("GET", "/admin/incidents", tsa)
    check(s == 200 and any(q["queueName"] == "analysis-queue" for q in inc["queues"]), "incidents: queue stats")
    s, bus, _ = call("GET", "/admin/business", tsa)
    check(s == 200 and bus["tenants"]["total"] >= 2, "business metrics")
    s, eng, _ = call("GET", "/admin/engines", tsa)
    check(s == 200 and eng["summary"]["serviceStatus"] in ("ONLINE", "DEGRADED", "OFFLINE"), f"engine registry ({eng['summary']})")
    s, _, _ = call("GET", "/admin/incidents", ta)
    check(s == 403, "non-super-admin denied admin API (403)")
    s, _, _ = call("GET", "/audit/log", tb, headers={"X-Tenant-Id": org_a})
    check(s == 403, "cross-tenant audit log read denied (403)")

    print()
    if FAILS:
        print(f"{len(FAILS)} CHECK(S) FAILED")
        return 1
    print("ALL COMMERCIAL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
