# RFC & SAProuter Regex Fix Blueprint

**Author**: `m2_it2_explorer_2`  
**Date**: 2026-09-24  
**Target Files**:
- `apps/api/src/modules/redaction/secret-redactor.service.ts`
- `services/analysis-python/src/platform/redaction.py`
- `apps/api/test/m2_challenges.spec.ts`
- `services/analysis-python/tests/adversarial/test_m2_challenges.py`

---

## 1. Problem Statement & Root Cause Analysis

### 1.1 SAP RFC Quoted Password Leakage
- **Observation**:
  In both `secret-redactor.service.ts` (line 78) and `redaction.py` (line 56), the regex for RFC credentials was:
  ```regex
  \b(rfc_pass(?:word)?|passwd|password|pwd)\s*[:=]\s*['"]?([^'"\s;,]{4,})['"]?
  ```
  And for general RFC parameters (line 83 and line 57):
  ```regex
  \b(ASHOST|GWHOST|SYSNR|CLIENT|USER|PASSWD|RFC_USER|RFC_PASS)\s*=\s*['"]?([^,\s'";\n]+)['"]?
  ```
- **Failure Mode**:
  When presented with an RFC string such as:
  `ASHOST=sapdev;PASSWD="my;complex,pwd 123";USER=BWUSER`
  or
  `rfc_password = "Secret;Complex;Pass#123"`
  the negated character class `[^'"\s;,]` terminates matching at the first semicolon, comma, or space.
  Consequently:
  - `my;complex,pwd 123` fails or matches only `my` (which is < 4 characters in `SAP_RFC_PASSWORD`, or stops at `;` in `SAP_RFC_PARAMS`).
  - The suffix `;complex,pwd 123"` or `;Complex;Pass#123"` leaks completely in plaintext into sanitized logs and preflight artifacts.

### 1.2 SAProuter Password Leakage with Port Specification (`/S/3299`)
- **Observation**:
  In both `secret-redactor.service.ts` (line 88) and `redaction.py` (line 58), the regex was:
  ```regex
  /H/[^/]+/W/([^/]+)/H/
  ```
  With replacement:
  - TypeScript: `template: '/H/.../W/__MASK__/H/'`
  - Python: `return f"/H/.../W/{mask}/H/"`
- **Failure Modes**:
  1. **Port Specification Bypass**: In SAP landscapes, SAProuter connections almost universally specify the router service/port `/S/3299` between host and password:
     `/H/router.corp/S/3299/W/SecretRouterPassword/H/target.corp/S/3200`.
     Because `[^/]+` stops at `/`, the intermediate `/S/3299/` breaks regex matching completely, leaking `SecretRouterPassword` unredacted.
  2. **Leading /S/ Format Bypass**: Strings such as `/S/3299/W/router_secret` fail because there is no leading `/H/`.
  3. **Trailing /H/ Dependency**: Route strings ending at the router password or preceding a non-`/H/` destination fail because trailing `/H/` is mandatory in the regex.
  4. **Multi-Hop Hop Skipping**: Because `/H/` is consumed at the end of the first match, consecutive router hops (e.g. `/H/r1/W/p1/H/r2/W/p2/H/dest`) fail to match the second hop because the leading slash and `H` of `/H/r2` were already swallowed by the first match.
  5. **Destination Passwords**: Legacy `/P/` destination passwords (e.g. `/H/appserver/P/destpass`) and terminal hop passwords are not detected.

---

## 2. Technical Fix Strategy

### 2.1 Refactoring SAP RFC Parameter Regex
We unify RFC credential matching across both TypeScript and Python by supporting:
1. **Quoted values** (enclosed in double quotes `"..."` or single quotes `'...'`) containing arbitrary characters including semicolons, commas, equals signs, and spaces:
   `(?:"([^"]*)"|'([^']*)')`
2. **Unquoted values** ending at whitespace, comma, or semicolon:
   `([^\s;,]+)`
3. **Structured Group Capture**:
   - Group 1: Key identifier
   - Group 2: Key-value separator (`[:=]` or `=`) with surrounding whitespace
   - Group 3: Double-quoted secret (or undefined/None)
   - Group 4: Single-quoted secret (or undefined/None)
   - Group 5: Unquoted secret (or undefined/None)
4. **Deterministic Reconstruction**:
   Instead of using error-prone `.replace(secret, mask)` (which can inadvertently corrupt keys if `secret` is a substring of the key, e.g. secret="pass" inside key="password"), we reconstruct the replacement:
   `${key}${eq}${quote}${mask}${quote}`
   preserving original quotes around the mask when quoted.

### 2.2 Refactoring SAProuter Connection String Regex
We refactor `SAPROUTER_PASS` to:
1. **Support All Hop Structures**:
   Match one or more route prefix segments `/H/<host>/` or `/S/<port>/`, followed by `/W/` (modern router password) or `/P/` (legacy destination password):
   ```regex
   ((?:/(?:H|S)/[^/\s"';]+)+/[WP]/)([^/\s"';]+)
   ```
2. **Non-Destructive Replacement**:
   - Capture Group 1 (`prefix`): Everything up to and including `/[WP]/` (e.g. `/H/router.corp/S/3299/W/` or `/S/3299/W/`).
   - Capture Group 2 (`secret`): The password token up to the next slash, whitespace, quote, or delimiter.
   - Replacement: `${prefix}${mask}`.
3. **Key Advantages**:
   - Preserves router hostnames and port numbers intact (non-destructive).
   - Eliminates trailing `/H/` dependency, resolving terminal passwords and multi-hop route string matching.
   - Zero false positives on URLs (e.g. `https://example.com/W/index.html` is rejected because it lacks `/H/` or `/S/` segments).

---

## 3. Concrete Code Modifications

### 3.1 TypeScript: `apps/api/src/modules/redaction/secret-redactor.service.ts`

#### Regex & Replacer Updates in `PATTERN_DEFS`
```typescript
    {
      category: 'SAP_RFC_PASSWORD',
      regex: /\b(rfc_pass(?:word)?|passwd|password|pwd)(\s*[:=]\s*)(?:"([^"]*)"|'([^']*)'|([^\s;,]+))/gi,
      replacer: (m, k, eq, qDouble, qSingle, unquoted) => {
        const sec = qDouble !== undefined ? qDouble : (qSingle !== undefined ? qSingle : unquoted);
        if (!sec || sec.startsWith('[REDACTED:')) return null;
        const q = qDouble !== undefined ? '"' : (qSingle !== undefined ? "'" : '');
        return { secret: sec, template: `${k}${eq}${q}__MASK__${q}` };
      },
    },
    {
      category: 'SAP_RFC_PARAMS',
      regex: /\b(ASHOST|GWHOST|SYSNR|CLIENT|USER|PASSWD|RFC_USER|RFC_PASS)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s;,]+))/gi,
      replacer: (m, k, eq, qDouble, qSingle, unquoted) => {
        const sec = qDouble !== undefined ? qDouble : (qSingle !== undefined ? qSingle : unquoted);
        if (!sec || sec.startsWith('[REDACTED:')) return null;
        const q = qDouble !== undefined ? '"' : (qSingle !== undefined ? "'" : '');
        return { secret: sec, template: `${k}${eq}${q}__MASK__${q}` };
      },
    },
    {
      category: 'SAPROUTER_PASS',
      regex: /((?:\/(?:H|S)\/[^\/\s"';]+)+\/[WP]\/)([^\/\s"';]+)/gi,
      replacer: (m, prefix, sec) => {
        if (!sec || sec.startsWith('[REDACTED:')) return null;
        return { secret: sec, template: `${prefix}__MASK__` };
      },
    },
```

---

### 3.2 Python: `services/analysis-python/src/platform/redaction.py`

#### Regex Updates in `REGEX_PATTERNS`
```python
        ("SAP_RFC_PASSWORD", re.compile(r"(?i)\b(rfc_pass(?:word)?|passwd|password|pwd)(\s*[:=]\s*)(?:\"([^\"]*)\"|'([^']*)'|([^\s;,]+))")),
        ("SAP_RFC_PARAMS", re.compile(r"(?i)\b(ASHOST|GWHOST|SYSNR|CLIENT|USER|PASSWD|RFC_USER|RFC_PASS)(\s*=\s*)(?:\"([^\"]*)\"|'([^']*)'|([^\s;,]+))")),
        ("SAPROUTER_PASS", re.compile(r"(?i)((?:/(?:H|S)/[^/\s\"';]+)+/[WP]/)([^/\s\"';]+)")),
```

#### Replacer Handler Updates in `redact()`
```python
                        elif category in ("SAP_RFC_PASSWORD", "SAP_RFC_PARAMS"):
                            key = match.group(1)
                            eq = match.group(2)
                            q_double = match.group(3)
                            q_single = match.group(4)
                            unquoted = match.group(5)
                            secret = q_double if q_double is not None else (q_single if q_single is not None else unquoted)
                            if not secret or secret.startswith("[REDACTED:"):
                                return match.group(0)
                            categories.add(category)
                            mask = self.get_mask(secret)
                            redactions.append(RedactionItem(
                                category=category,
                                mask=mask,
                                line_number=line_idx,
                                column_start=match.start(),
                                column_end=match.end(),
                                detection_method="REGEX",
                            ))
                            q = '"' if q_double is not None else ("'" if q_single is not None else "")
                            return f"{key}{eq}{q}{mask}{q}"
                        elif category == "SAPROUTER_PASS":
                            prefix = match.group(1)
                            secret = match.group(2)
                            if secret.startswith("[REDACTED:"):
                                return match.group(0)
                            categories.add(category)
                            mask = self.get_mask(secret)
                            redactions.append(RedactionItem(
                                category=category,
                                mask=mask,
                                line_number=line_idx,
                                column_start=match.start(),
                                column_end=match.end(),
                                detection_method="REGEX",
                            ))
                            return f"{prefix}{mask}"
```

---

## 4. Test Suite Remediation & Extension Plan

### 4.1 Update Challenger Regression Tests
The tests in `apps/api/test/m2_challenges.spec.ts` and `services/analysis-python/tests/adversarial/test_m2_challenges.py` previously asserted that vulnerabilities existed (e.g. `expect(partialLeak).toBe(true)`). They must be updated to assert that vulnerabilities are fully resolved.

#### In `apps/api/test/m2_challenges.spec.ts`
```typescript
    it('REMEDIATED: Quoted SAP RFC passwords containing semicolons or spaces are completely redacted', () => {
      const input = 'rfc_password = "Secret;Complex;Pass#123"';
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).not.toContain('Secret;Complex;Pass#123');
      expect(res.sanitizedText).not.toContain(';Complex;Pass#123');
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
      expect(res.sanitizedText).toMatch(/rfc_password\s*=\s*"\[REDACTED:SECRET:[a-f0-9]{64}\]"/);
    });

    it('REMEDIATED: SAP Router string with /S/ port and destinations are completely redacted', () => {
      const input = '/H/router.corp/S/3299/W/SecretRouterPassword/H/target.corp/S/3200';
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).not.toContain('SecretRouterPassword');
      expect(res.sanitizedText).toContain('/H/router.corp/S/3299/W/[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('/H/target.corp/S/3200');
    });
```

#### In `services/analysis-python/tests/adversarial/test_m2_challenges.py`
```python
    def test_sap_rfc_password_quoted_with_semicolon_completely_redacted(self, engine):
        """Quoted RFC passwords containing delimiters (; , space) must not leak any plaintext tail."""
        rfc_quoted = 'rfc_password = "Secret;Complex;Pass#123"'
        res = engine.redact(rfc_quoted)
        assert ";Complex;Pass#123" not in res.sanitized_text
        assert "Secret;Complex;Pass#123" not in res.sanitized_text
        assert '[REDACTED:SECRET:' in res.sanitized_text

    def test_saprouter_string_with_port_and_destinations_completely_redacted(self, engine):
        """SAProuter connections with port /S/3299 and destination servers must be redacted cleanly."""
        router_str = "/H/router.corp/S/3299/W/SecretRouterPassword/H/target.corp/S/3200"
        res = engine.redact(router_str)
        assert "SecretRouterPassword" not in res.sanitized_text
        assert "/H/router.corp/S/3299/W/[REDACTED:SECRET:" in res.sanitized_text
        assert "/H/target.corp/S/3200" in res.sanitized_text
```

### 4.2 Comprehensive New Test Cases (To Add in Both Suites)
Both test suites should include:
1. `ASHOST=sapdev;PASSWD="my;complex,pwd 123";USER=BWUSER`: Assert all three parameters are masked without tail leaks.
2. `PASSWD='my;single,quoted 456';USER='batch user'`: Single-quoted credentials with spaces/commas/semicolons.
3. Unquoted credentials: `PASSWD=SuperSecret2026!` cleanly masked as `PASSWD=[REDACTED:SECRET:...]`.
4. Password equality edge cases: `password = "pass"` and `password = pass` (verifying key `password` is never mangled).
5. SAProuter port with no host: `/S/3299/W/router_secret`.
6. SAProuter hop with appserver destination: `/H/saprouter/S/3299/W/pass/H/appserver`.
7. SAProuter multi-hop route: `/H/r1/S/3299/W/p1/H/r2/S/3299/W/p2/H/dest` (verifying both `p1` and `p2` are redacted).
8. SAProuter destination password: `/H/saprouter/S/3299/W/pass/H/appserver/W/destpass` and `/P/destpass` (verifying both intermediate and destination secrets are redacted).
9. Negative test: `https://example.com/W/index.html` remains unchanged.
