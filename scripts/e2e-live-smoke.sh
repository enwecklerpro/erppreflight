#!/bin/bash
# Live end-to-end smoke test against a running stack (API + analysis + Postgres + Redis + MinIO + ClamAV).
# Usage: API_BASE_URL=http://localhost:3001 scripts/e2e-live-smoke.sh
# Creates two throwaway tenants, uploads a golden fixture, runs OPD Guard, exports all report
# formats and verifies tenant isolation and secret redaction at rest.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
A="${API_BASE_URL:-http://localhost:3001}/api/v1"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAILS=0
J='Content-Type: application/json'
R=$RANDOM
pass(){ echo "PASS  $1"; }
fail(){ echo "FAIL  $1 :: $2"; FAILS=$((FAILS+1)); }
jqv(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

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
echo; [ "$FAILS" -eq 0 ] && echo "ALL CHECKS PASSED" || { echo "$FAILS CHECK(S) FAILED"; exit 1; }
