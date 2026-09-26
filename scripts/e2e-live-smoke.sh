#!/bin/bash
# Live end-to-end smoke test against a running stack (API + analysis + Postgres + Redis + MinIO + ClamAV).
# Usage: API_BASE_URL=http://localhost:3001 scripts/e2e-live-smoke.sh
# Creates two throwaway tenants, uploads a golden fixture, runs OPD Guard, exports all report
# formats and verifies tenant isolation and secret redaction at rest.
# Account lifecycle checks (e-mail verification, password reset/change, 2FA, invitations,
# members, organization switching, GDPR export/deletion) read e-mails from the dev mailbox:
# the API must run with MAIL_TRANSPORT=dev; pass MAIL_DEV_OUTBOX_TOKEN when it is set on the API.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
A="${API_BASE_URL:-http://localhost:3001}/api/v1"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAILS=0
J='Content-Type: application/json'
R=$RANDOM
pass(){ echo "PASS  $1"; }
fail(){ echo "FAIL  $1 :: $2"; FAILS=$((FAILS+1)); }
jqv(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }
jqe(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
MBT="${MAIL_DEV_OUTBOX_TOKEN:-}"
# mlink <recipient> <TEMPLATE>: newest link of that template in the dev mailbox (polls: some mails are sent in background)
mlink(){ for _i in 1 2 3 4 5 6 7 8 9 10; do _L=$(curl -s "$A/dev/mail/messages?to=$1&limit=10" -H "X-Dev-Mailbox-Token: $MBT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(next((l for m in d['items'] if m['template']==sys.argv[1] for l in m['links']),''))" "$2" 2>/dev/null); [ -n "$_L" ] && { echo "$_L"; return; }; sleep 0.5; done; }
mcount(){ curl -s "$A/dev/mail/messages?to=$1&limit=50" -H "X-Dev-Mailbox-Token: $MBT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(sum(1 for m in d['items'] if m['template']==sys.argv[1]))" "$2" 2>/dev/null; }
# totp <base32 secret> [step offset]: RFC 6238 code (SHA-1, 6 digits, 30 s)
totp(){ python3 -c "import sys,hmac,hashlib,base64,struct,time;k=sys.argv[1];s=base64.b32decode(k+'='*(-len(k)%8));c=int(time.time()//30)+int(sys.argv[2]);h=hmac.new(s,struct.pack('>Q',c),hashlib.sha1).digest();o=h[-1]&15;print('%06d'%((struct.unpack('>I',h[o:o+4])[0]&0x7fffffff)%1000000))" "$1" "${2:-0}"; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }

# 1 register tenant A + B
RA=$(curl -s -X POST $A/auth/register -H "$J" -d "{\"email\":\"alice$R@e2e.local\",\"password\":\"AlicePass!2026x\",\"fullName\":\"Alice\",\"organizationName\":\"Org A $R\"}")
RB=$(curl -s -X POST $A/auth/register -H "$J" -d "{\"email\":\"bob$R@e2e.local\",\"password\":\"BobPass!2026xx\",\"fullName\":\"Bob\",\"organizationName\":\"Org B $R\"}")
[ -n "$(echo $RA | jqv "['accessToken']")" ] && pass "register A" || fail "register A" "$RA"
# 2 login
LA=$(curl -s -X POST $A/auth/login -H "$J" -d "{\"email\":\"alice$R@e2e.local\",\"password\":\"AlicePass!2026x\"}")
TA=$(echo $LA | jqv "['accessToken']"); OA=$(echo $LA | jqv "['user']['organizationId']")
LB=$(curl -s -X POST $A/auth/login -H "$J" -d "{\"email\":\"bob$R@e2e.local\",\"password\":\"BobPass!2026xx\"}")
TB=$(echo $LB | jqv "['accessToken']"); OB=$(echo $LB | jqv "['user']['organizationId']")
[ -n "$TA" ] && pass "login A (org $OA)" || fail "login A" "$LA"
HA="Authorization: Bearer $TA"; HB="Authorization: Bearer $TB"
# 2b e-mail verification gate (unverified users may sign in but not run analyses / exports)
C=$(curl -s -X POST $A/analyses -H "$J" -H "$HA" -d '{}'); echo "$C" | grep -q EMAIL_NOT_VERIFIED && pass "unverified user cannot run analyses (403 EMAIL_NOT_VERIFIED)" || fail "verification gate" "$C"
C=$(code "$A/dev/mail/messages?to=alice$R@e2e.local" -H "X-Dev-Mailbox-Token: $MBT"); [ "$C" = 200 ] || fail "dev mailbox reachable (MAIL_TRANSPORT=dev, MAIL_DEV_OUTBOX_TOKEN)" "$C"
for WHO in alice bob; do
  VL=$(mlink "$WHO$R@e2e.local" EMAIL_VERIFICATION); VT="${VL##*token=}"
  V=$(curl -s -X POST $A/auth/verify-email -H "$J" -d "{\"token\":\"$VT\"}")
  [ "$(echo $V | jqv "['verified']")" = True ] && pass "verification e-mail for $WHO -> link verified" || fail "verify $WHO" "$VL $V"
done
C=$(code -X POST $A/auth/verify-email -H "$J" -d "{\"token\":\"$VT\"}"); [ "$C" = 400 ] && pass "verification link is single-use (reuse -> 400)" || fail "verification reuse" $C
[ "$(curl -s $A/auth/me -H "$HA" | jqv "['user']['emailVerified']")" = True ] && pass "me.emailVerified=true after verification" || fail "me.emailVerified" ""
# wrong password
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST $A/auth/login -H "$J" -d "{\"email\":\"alice$R@e2e.local\",\"password\":\"wrong\"}"); [ "$C" = 401 ] && pass "wrong password -> 401" || fail "wrong password" $C
# 3 project
P=$(curl -s -X POST $A/projects -H "$J" -H "$HA" -d '{"name":"S4 Upgrade E2E","description":"live e2e","targetRelease":"S4H_2023"}')
PID=$(echo $P | jqv "['id']"); [ -n "$PID" ] && pass "create project $PID (targetRelease=$(echo $P | jqv "['targetRelease']"))" || fail "create project" "$P"
# 4 upload real fixture + a file with a secret
UP=$(curl -s -X POST $A/projects/$PID/files -H "$HA" -F "file=@$ROOT/tests/fixtures/known_bad_billing_opd.xml;type=application/xml")
FID=$(echo $UP | jqv "['fileId']" ); [ -z "$FID" ] && FID=$(echo $UP | jqv "['id']")
echo "      upload response: $(echo $UP | head -c 300)"
sleep 3
FL=$(curl -s $A/projects/$PID/files -H "$HA")
QS=$(echo $FL | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('items',d) if isinstance(d,dict) else d;print([(f.get('id'),f.get('quarantineStatus')) for f in d])")
echo "      files: $QS"
echo "$QS" | grep -q CLEAN && pass "file scanned by ClamAV and CLEAN" || fail "file clean" "$QS"
# 5 analysis
AN=$(curl -s -X POST $A/analyses -H "$J" -H "$HA" -d "{\"projectId\":\"$PID\",\"engineTypes\":[\"OPD_GUARD\"],\"fileIds\":[\"$FID\"]}")
AID=$(echo $AN | jqv "['analysisId']"); [ -n "$AID" ] && pass "analysis queued $AID ($(echo $AN | jqv "['status']"))" || fail "analysis trigger" "$AN"
for i in $(seq 1 30); do ST=$(curl -s $A/analyses/$AID -H "$HA" | jqv "['status']"); [[ "$ST" =~ COMPLETED|FAILED|PARTIAL ]] && break; sleep 2; done
[ "$ST" = COMPLETED ] && pass "analysis status $ST" || fail "analysis status" "$ST"
# 6 findings + evidence
F=$(curl -s "$A/findings?projectId=$PID&pageSize=50" -H "$HA")
echo $F | python3 -c "
import sys,json;d=json.load(sys.stdin);items=d.get('items') or d.get('data') or d
print('      findings:',len(items))
for f in items[:5]:
  ev=(f.get('evidence') or [{}])[0]
  print('      -',f.get('code') or f.get('findingCode'),f.get('severity'),f.get('confidence') or f.get('confidenceClass'),'| ev:',ev.get('artifactPath'),'line',ev.get('lineNumber'),'sha',str(ev.get('sha256'))[:12])
"
# 7 export in every supported format + authenticated download
for FMT in PDF JSON_BUNDLE XLSX CSV HTML_OFFLINE; do
  EX=$(curl -s -X POST $A/projects/$PID/analyses/$AID/export -H "$J" -H "$HA" -d "{\"format\":\"$FMT\"}")
  RID=$(echo $EX | jqv "['reportId']"); FN=$(echo $EX | jqv "['fileName']")
  C=$(curl -s -o $TMP/report.bin -w "%{http_code}" $A/reports/$RID/file -H "$HA")
  SZ=$(stat -c %s $TMP/report.bin 2>/dev/null); MG=$(file -b $TMP/report.bin | cut -c1-40)
  [ -n "$RID" ] && [ "$C" = 200 ] && [ "$SZ" -gt 100 ] && pass "export $FMT -> $FN ($SZ bytes, $MG)" || fail "export $FMT" "$C $(echo $EX | head -c 200)"
done
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST $A/projects/$PID/analyses/$AID/export -H "$J" -H "$HA" -d '{"format":"JSON"}'); [ "$C" = 400 ] && pass "unknown export format -> 400" || fail "unknown export format" $C
# 8 cross tenant
C=$(curl -s -o /dev/null -w "%{http_code}" $A/projects/$PID -H "$HB"); [[ "$C" =~ 403|404 ]] && pass "tenant B read A project -> $C" || fail "cross-tenant project" $C
C=$(curl -s -o /dev/null -w "%{http_code}" $A/projects/$PID -H "$HB" -H "X-Tenant-Id: $OA"); [[ "$C" =~ 403|404 ]] && pass "tenant B spoof X-Tenant-Id -> $C" || fail "spoofed tenant header" $C
C=$(curl -s -o /dev/null -w "%{http_code}" "$A/findings?projectId=$PID" -H "$HB" -H "X-Tenant-Id: $OA"); [[ "$C" =~ 403|404 ]] && pass "tenant B spoof findings -> $C" || fail "spoofed findings" $C
C=$(curl -s -o /dev/null -w "%{http_code}" "$A/lab/scenarios" -H "$HB" -H "X-Tenant-Id: $OA"); [[ "$C" =~ 403|404 ]] && pass "tenant B spoof lab -> $C" || fail "spoofed lab" $C
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST $A/analyses -H "$J" -H "$HB" -d "{\"projectId\":\"$PID\",\"engineTypes\":[\"OPD_GUARD\"],\"fileIds\":[\"$FID\"]}"); [[ "$C" =~ 403|404 ]] && pass "tenant B analyse A file -> $C" || fail "cross-tenant analysis" $C
C=$(curl -s -o /dev/null -w "%{http_code}" $A/projects -H "Authorization: Bearer invalid"); [ "$C" = 401 ] && pass "invalid token -> 401" || fail "invalid token" $C
# 9 report download cross-tenant + secret redaction at rest
C=$(curl -s -o /dev/null -w "%{http_code}" $A/reports/$RID/file -H "$HB"); [[ "$C" =~ 403|404 ]] && pass "tenant B download A report -> $C" || fail "cross-tenant report" $C
printf '<RfcConfig>\n<Destination>PRD_CENTRAL</Destination>\n<ApiToken>sk_live_9fQ2xLp7ZbR4tYv1mNc8</ApiToken>\n</RfcConfig>\n' > $TMP/secret.xml
US=$(curl -s -X POST $A/projects/$PID/files -H "$HA" -F "file=@$TMP/secret.xml;type=application/xml")
SF=$(echo $US | jqv "['fileId']"); RC=$(echo $US | jqv "['redactionsCount']")
DU=$(curl -s $A/projects/$PID/files/$SF/presign-download -H "$HA" | jqv "['downloadUrl']")
curl -s "$DU" -o $TMP/stored.xml
grep -q "sk_live_9fQ2" $TMP/stored.xml && fail "secret stored unredacted" "$(cat $TMP/stored.xml)" || { grep -q "PRD_CENTRAL" $TMP/stored.xml && pass "secret redacted at rest (redactions=$RC), structure intact"; }
# 10 account lifecycle: password reset (no enumeration, single-use, revokes sessions)
CE="carol$R@e2e.local"
RC=$(curl -s -X POST $A/auth/register -H "$J" -d "{\"email\":\"$CE\",\"password\":\"CarolPass!2026x\",\"fullName\":\"Carol\",\"organizationName\":\"Org C $R\"}")
TC=$(echo $RC | jqv "['accessToken']"); OC=$(echo $RC | jqv "['user']['organizationId']"); HC="Authorization: Bearer $TC"
VL=$(mlink "$CE" EMAIL_VERIFICATION); curl -s -o /dev/null -X POST $A/auth/verify-email -H "$J" -d "{\"token\":\"${VL##*token=}\"}"
F1=$(curl -s -X POST $A/auth/password/forgot -H "$J" -d "{\"email\":\"$CE\"}" | jqv "['message']")
F2=$(curl -s -X POST $A/auth/password/forgot -H "$J" -d "{\"email\":\"nobody$R@e2e.local\"}" | jqv "['message']")
[ -n "$F1" ] && [ "$F1" = "$F2" ] && pass "forgot-password: identical 200 response for known/unknown e-mail" || fail "forgot-password enumeration" "$F1 | $F2"
RL=$(mlink "$CE" PASSWORD_RESET); RT="${RL##*token=}"
[ "$(curl -s -X POST $A/auth/password/reset/validate -H "$J" -d "{\"token\":\"$RT\"}" | jqv "['valid']")" = True ] && pass "reset e-mail delivered, token valid" || fail "reset token" "$RL"
C=$(code -X POST $A/auth/password/reset -H "$J" -d "{\"token\":\"$RT\",\"newPassword\":\"weakpass\"}"); [ "$C" = 400 ] && pass "reset rejects weak password (policy) -> 400" || fail "reset policy" $C
C=$(code -X POST $A/auth/password/reset -H "$J" -d "{\"token\":\"$RT\",\"newPassword\":\"CarolReset!2026y\"}"); [ "$C" = 200 ] && pass "password reset with token -> 200" || fail "password reset" $C
C=$(code -X POST $A/auth/password/reset -H "$J" -d "{\"token\":\"$RT\",\"newPassword\":\"CarolReset!2026z\"}"); [ "$C" = 400 ] && pass "reset token single-use (reuse -> 400)" || fail "reset reuse" $C
C=$(code $A/auth/me -H "$HC"); [ "$C" = 401 ] && pass "reset revoked existing sessions (old token -> 401)" || fail "reset session revocation" $C
C=$(code -X POST $A/auth/login -H "$J" -d "{\"email\":\"$CE\",\"password\":\"CarolPass!2026x\"}"); [ "$C" = 401 ] && pass "old password rejected after reset" || fail "old password" $C
TC=$(curl -s -X POST $A/auth/login -H "$J" -d "{\"email\":\"$CE\",\"password\":\"CarolReset!2026y\"}" | jqv "['accessToken']"); HC="Authorization: Bearer $TC"
[ -n "$TC" ] && pass "login with new password" || fail "login new password" ""
# 11 change password + logout (single session) + logout-all
CP=$(curl -s -X POST $A/auth/password/change -H "$J" -H "$HC" -d '{"currentPassword":"CarolReset!2026y","newPassword":"CarolChange!2026w"}')
TC2=$(echo $CP | jqv "['accessToken']")
[ -n "$TC2" ] && [ "$(code $A/auth/me -H "$HC")" = 401 ] && [ "$(code $A/auth/me -H "Authorization: Bearer $TC2")" = 200 ] && pass "change password: new session issued, previous token revoked" || fail "change password" "$CP"
TC=$TC2; HC="Authorization: Bearer $TC"
T3=$(curl -s -X POST $A/auth/login -H "$J" -d "{\"email\":\"$CE\",\"password\":\"CarolChange!2026w\"}" | jqv "['accessToken']")
curl -s -o /dev/null -X POST $A/auth/logout -H "Authorization: Bearer $T3"
[ "$(code $A/auth/me -H "Authorization: Bearer $T3")" = 401 ] && [ "$(code $A/auth/me -H "$HC")" = 200 ] && pass "logout revokes only that session" || fail "single logout" ""
T4=$(curl -s -X POST $A/auth/login -H "$J" -d "{\"email\":\"$CE\",\"password\":\"CarolChange!2026w\"}" | jqv "['accessToken']")
SL=$(curl -s $A/auth/sessions -H "$HC"); S4=$(echo "$SL" | jqe "[x['id'] for x in d if not x['current']][0]")
[ "$(echo "$SL" | jqe "sum(1 for x in d if x['current'])")" = 1 ] && [ -n "$S4" ] && pass "session list: $(echo "$SL" | jqe "len(d)") active sessions, current flagged" || fail "session list" "$SL"
C=$(code -X DELETE $A/auth/sessions/$S4 -H "$HC"); [ "$C" = 200 ] && [ "$(code $A/auth/me -H "Authorization: Bearer $T4")" = 401 ] && pass "revoke one session (device) -> its token 401" || fail "revoke session" $C
# 12 2FA (TOTP): setup -> enable -> login requires code -> recovery code
SU=$(curl -s -X POST $A/auth/2fa/setup -H "$J" -H "$HC" -d '{"password":"CarolChange!2026w"}'); SEC=$(echo $SU | jqv "['secret']")
echo "$SU" | grep -q "otpauth://totp/" && pass "2FA setup returns otpauth URI + base32 secret" || fail "2fa setup" "$SU"
C=$(code -X POST $A/auth/2fa/enable -H "$J" -H "$HC" -d '{"code":"000000"}'); [ "$C" = 400 ] && pass "2FA enable rejects wrong code" || fail "2fa wrong code" $C
EN=$(curl -s -X POST $A/auth/2fa/enable -H "$J" -H "$HC" -d "{\"code\":\"$(totp $SEC)\"}")
RCODE=$(echo $EN | jqv "['recoveryCodes'][0]"); TC2=$(echo $EN | jqv "['accessToken']")
[ -n "$RCODE" ] && [ "$(echo $EN | jqv "['user']['mfaEnabled']")" = True ] && pass "2FA enabled, $(echo $EN | jqe "len(d['recoveryCodes'])") recovery codes issued" || fail "2fa enable" "$EN"
[ "$(code $A/auth/me -H "$HC")" = 401 ] && pass "enabling 2FA revoked other sessions" || fail "2fa session revocation" ""
TC=$TC2; HC="Authorization: Bearer $TC"
LG=$(curl -s -X POST $A/auth/login -H "$J" -d "{\"email\":\"$CE\",\"password\":\"CarolChange!2026w\"}")
CH=$(echo $LG | jqv "['challengeToken']")
[ "$(echo $LG | jqv "['mfaRequired']")" = True ] && [ -z "$(echo $LG | jqv "['accessToken']")" ] && pass "login with 2FA returns challenge, no session" || fail "2fa login challenge" "$LG"
[ "$(code $A/projects -H "Authorization: Bearer $CH")" = 401 ] && pass "challenge token is not a session (401)" || fail "challenge as session" ""
C=$(code -X POST $A/auth/login/2fa -H "$J" -d "{\"challengeToken\":\"$CH\",\"code\":\"123456\"}"); [ "$C" = 401 ] && pass "2FA login rejects wrong code" || fail "2fa login wrong code" $C
L2=$(curl -s -X POST $A/auth/login/2fa -H "$J" -d "{\"challengeToken\":\"$CH\",\"code\":\"$(totp $SEC 1)\"}")
[ -n "$(echo $L2 | jqv "['accessToken']")" ] && pass "2FA login with TOTP code -> session" || fail "2fa login" "$L2"
L3=$(curl -s -X POST $A/auth/login/2fa -H "$J" -d "{\"challengeToken\":\"$CH\",\"recoveryCode\":\"$RCODE\"}")
[ -n "$(echo $L3 | jqv "['accessToken']")" ] && pass "2FA login with recovery code -> session" || fail "2fa recovery login" "$L3"
C=$(code -X POST $A/auth/login/2fa -H "$J" -d "{\"challengeToken\":\"$CH\",\"recoveryCode\":\"$RCODE\"}"); [ "$C" = 401 ] && pass "recovery code single-use" || fail "recovery code reuse" $C
HC="Authorization: Bearer $(echo $L3 | jqv "['accessToken']")"
# 13 invitations, members, roles, organization switching
IV=$(curl -s -X POST $A/organizations/invitations -H "$J" -H "$HA" -d "{\"email\":\"$CE\",\"role\":\"AUDITOR\"}")
[ "$(echo $IV | jqv "['status']")" = PENDING ] && pass "owner invites existing user as AUDITOR" || fail "create invitation" "$IV"
IL=$(mlink "$CE" ORGANIZATION_INVITATION); IT="${IL##*token=}"
PV=$(curl -s -X POST $A/invitations/preview -H "$J" -d "{\"token\":\"$IT\"}")
[ "$(echo $PV | jqv "['organizationName']")" = "Org A $R" ] && pass "invitation e-mail + preview (org, role=$(echo $PV | jqv "['role']"))" || fail "invitation preview" "$PV"
C=$(code -X POST $A/invitations/accept -H "$J" -H "$HB" -d "{\"token\":\"$IT\"}"); [ "$C" = 403 ] && pass "invitation cannot be accepted by another account (403)" || fail "invite wrong account" $C
AC=$(curl -s -X POST $A/invitations/accept -H "$J" -H "$HC" -d "{\"token\":\"$IT\"}")
[ "$(echo $AC | jqv "['user']['organizationId']")" = "$OA" ] && [ "$(echo $AC | jqv "['user']['role']")" = AUDITOR ] && pass "invitation accepted: carol joined org A as AUDITOR" || fail "accept invitation" "$AC"
C=$(code -X POST $A/invitations/preview -H "$J" -d "{\"token\":\"$IT\"}"); [ "$C" = 404 ] && pass "accepted invitation token is single-use" || fail "invitation reuse" $C
NO=$(curl -s $A/organizations -H "$HC" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
[ "$NO" = 2 ] && pass "carol belongs to 2 organizations (switcher list)" || fail "org list" "$NO"
[ "$(curl -s $A/organizations/current -H "$HC" -H "X-Tenant-Id: $OA" | jqv "['id']")" = "$OA" ] && [ "$(curl -s $A/organizations/current -H "$HC" -H "X-Tenant-Id: $OC" | jqv "['id']")" = "$OC" ] && pass "org switch via X-Tenant-Id works for both memberships" || fail "org switch" ""
C=$(code $A/organizations/current -H "$HC" -H "X-Tenant-Id: $OB"); [ "$C" = 403 ] && pass "switch to non-member org B still denied (403)" || fail "cross-tenant switch" $C
SW=$(curl -s -X POST $A/auth/switch-organization -H "$J" -H "$HC" -d "{\"organizationId\":\"$OA\"}"); [ "$(echo $SW | jqv "['user']['organizationId']")" = "$OA" ] && pass "switch-organization issues session for org A" || fail "switch-organization" "$SW"
HC="Authorization: Bearer $(echo $SW | jqv "['accessToken']")"  # the switch replaced the previous session
[ "$(code $A/auth/me -H "$HC")" = 200 ] && pass "switched session active (previous session replaced)" || fail "switched session" ""
C=$(code -X POST $A/auth/switch-organization -H "$J" -H "$HC" -d "{\"organizationId\":\"$OB\"}"); [ "$C" = 403 ] && pass "switch-organization to foreign org -> 403" || fail "switch foreign" $C
C=$(code -X POST $A/organizations/invitations -H "$J" -H "$HC" -H "X-Tenant-Id: $OA" -d "{\"email\":\"x$R@e2e.local\",\"role\":\"VIEWER\"}"); [ "$C" = 403 ] && pass "AUDITOR cannot invite (RolesGuard 403)" || fail "auditor invite" $C
MEM=$(curl -s $A/organizations/members -H "$HA"); CMID=$(echo $MEM | python3 -c "import sys,json;print([m['id'] for m in json.load(sys.stdin) if m['email']=='$CE'][0])"); AMID=$(echo $MEM | python3 -c "import sys,json;print([m['id'] for m in json.load(sys.stdin) if m['role']=='ORGANIZATION_OWNER'][0])")
[ "$(curl -s -X PATCH $A/organizations/members/$CMID -H "$J" -H "$HA" -d '{"role":"LEAD_ARCHITECT"}' | jqv "['role']")" = LEAD_ARCHITECT ] && pass "owner changes carol's role to LEAD_ARCHITECT" || fail "change role" ""
C=$(code -X PATCH $A/organizations/members/$AMID -H "$J" -H "$HA" -d '{"role":"VIEWER"}'); [ "$C" = 409 ] && pass "last owner cannot be demoted (409)" || fail "last owner demote" $C
C=$(code -X DELETE $A/organizations/members/$AMID -H "$HA"); [ "$C" = 409 ] && pass "last owner cannot be removed (409)" || fail "last owner remove" $C
IV2=$(curl -s -X POST $A/organizations/invitations -H "$J" -H "$HA" -d "{\"email\":\"erin$R@e2e.local\",\"role\":\"VIEWER\"}" | jqv "['id']")
EL1=$(mlink "erin$R@e2e.local" ORGANIZATION_INVITATION)
RS=$(curl -s -X POST $A/organizations/invitations/$IV2/resend -H "$HA" | jqv "['status']"); EL2=$(mlink "erin$R@e2e.local" ORGANIZATION_INVITATION)
[ "$RS" = PENDING ] && [ "$EL1" != "$EL2" ] && [ "$(code -X POST $A/invitations/preview -H "$J" -d "{\"token\":\"${EL1##*token=}\"}")" = 404 ] && pass "resend invitation issues new token, old token revoked" || fail "resend invitation" "$RS"
[ "$(curl -s -X POST $A/organizations/ownership-transfer -H "$J" -H "$HA" -d "{\"memberId\":\"$CMID\"}" | jqv "['transferred']")" = True ] && pass "ownership transferred alice -> carol" || fail "ownership transfer" ""
C=$(code -X POST $A/organizations/ownership-transfer -H "$J" -H "$HA" -d "{\"memberId\":\"$AMID\"}"); [ "$C" = 403 ] && pass "former owner (now SECURITY_ADMIN) cannot transfer ownership" || fail "transfer by non-owner" $C
[ "$(curl -s -X PATCH $A/organizations/members/$AMID -H "$J" -H "$HC" -H "X-Tenant-Id: $OA" -d '{"role":"ORGANIZATION_OWNER"}' | jqv "['role']")" = ORGANIZATION_OWNER ] && pass "new owner restores alice as co-owner" || fail "restore owner" ""
DE="dave$R@e2e.local"
curl -s -o /dev/null -X POST $A/organizations/invitations -H "$J" -H "$HA" -d "{\"email\":\"$DE\",\"role\":\"VIEWER\"}"
DL=$(mlink "$DE" ORGANIZATION_INVITATION)
[ "$(curl -s -X POST $A/invitations/preview -H "$J" -d "{\"token\":\"${DL##*token=}\"}" | jqv "['accountExists']")" = False ] && pass "invitation preview for new user (accountExists=false)" || fail "new-user preview" "$DL"
DN=$(curl -s -X POST $A/invitations/accept-new -H "$J" -d "{\"token\":\"${DL##*token=}\",\"password\":\"DavePass!2026xy\",\"fullName\":\"Dave\"}")
TD=$(echo $DN | jqv "['accessToken']")
[ "$(echo $DN | jqv "['user']['organizationId']")" = "$OA" ] && [ "$(echo $DN | jqv "['user']['emailVerified']")" = True ] && pass "new user signs up via invitation (verified, VIEWER in org A)" || fail "accept-new" "$DN"
curl -s -o /dev/null -X POST $A/auth/logout-all -H "Authorization: Bearer $TD"
[ "$(code $A/auth/me -H "Authorization: Bearer $TD")" = 401 ] && pass "logout-all revokes every session" || fail "logout-all" ""
# 14 GDPR: account export, org export, account deletion (sole-owner org deleted with confirmation)
EXP=$(curl -s $A/account/export -H "$HC")
[ "$(echo $EXP | jqv "['profile']['email']")" = "$CE" ] && [ "$(echo $EXP | jqe "len(d['memberships'])")" = 2 ] && pass "account export JSON (profile + 2 memberships, $(echo $EXP | jqe "len(d['activity'])") activity events)" || fail "account export" "$(echo $EXP | head -c 200)"
C=$(curl -s -o $TMP/org.zip -w "%{http_code}" $A/organizations/current/export -H "$HA"); unzip -l $TMP/org.zip 2>/dev/null | grep -q findings.json && pass "organization export ZIP ($(stat -c %s $TMP/org.zip) bytes, $(unzip -l $TMP/org.zip | grep -c json) JSON files)" || fail "org export" $C
IMP=$(curl -s $A/account/deletion-impact -H "$HC")
[ "$(echo $IMP | jqv "['soleOwnerOrganizations'][0]['id']")" = "$OC" ] && pass "deletion impact: sole-owner org C will be deleted, org A only left" || fail "deletion impact" "$IMP"
C=$(code -X DELETE $A/account -H "$J" -H "$HC" -d "{\"password\":\"CarolChange!2026w\",\"recoveryCode\":\"$(echo $EN | jqv "['recoveryCodes'][2]")\",\"confirmation\":\"DELETE MY ACCOUNT\"}"); [ "$C" = 409 ] && pass "account deletion requires explicit org-deletion confirmation (409)" || fail "delete w/o confirm" $C
DEL=$(curl -s -X DELETE $A/account -H "$J" -H "$HC" -d "{\"password\":\"CarolChange!2026w\",\"recoveryCode\":\"$(echo $EN | jqv "['recoveryCodes'][1]")\",\"confirmation\":\"DELETE MY ACCOUNT\",\"confirmOrganizationDeletion\":[\"$OC\"]}")
[ "$(echo $DEL | jqv "['deleted']")" = True ] && pass "account deleted (orgs deleted: $(echo $DEL | jqe "len(d['organizationsDeleted'])"))" || fail "account deletion" "$DEL"
[ "$(code $A/auth/me -H "$HC")" = 401 ] && [ "$(code -X POST $A/auth/login -H "$J" -d "{\"email\":\"$CE\",\"password\":\"CarolChange!2026w\"}")" = 401 ] && pass "deleted account: sessions revoked, login impossible" || fail "deleted account access" ""
curl -s $A/organizations/members -H "$HA" | grep -q "$CE" && fail "anonymisation" "carol still listed in org A" || pass "deleted user removed from org A and anonymised"
echo; [ "$FAILS" -eq 0 ] && echo "ALL CHECKS PASSED" || { echo "$FAILS CHECK(S) FAILED"; exit 1; }
