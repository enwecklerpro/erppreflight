import asyncio
import hashlib
import sys
import os

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ANALYSIS_PY_DIR = os.path.join(BASE_DIR, "services", "analysis-python")
if ANALYSIS_PY_DIR not in sys.path:
    sys.path.insert(0, ANALYSIS_PY_DIR)

from src.engines.form_doctor import FormDoctorEngine
from src.engines.opd_guard import OPDGuardEngine
from src.models.request import AnalysisRequest, ArtifactReference
from src.models.enums import EngineType, ArtifactType

async def run_veracity_checks():
    print("--- CHECK 1: FormDoctor Evidence Veracity ---")
    xdp = """<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="RootForm" dataRef="$.Invoice">
      <field name="Fld1">
        <bind match="dataRef" ref="$.Header.Missing"/>
      </field>
    </subform>
  </template>
</xdp:xdp>"""
    xml = """<Invoice>
  <Header>
    <Existing>1</Existing>
  </Header>
</Invoice>"""

    req = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000001",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.FORM_DOCTOR,
        artifacts=[
            ArtifactReference(file_name="form.xdp", artifact_type=ArtifactType.XDP, raw_content=xdp),
            ArtifactReference(file_name="data.xml", artifact_type=ArtifactType.XML, raw_content=xml),
        ]
    )
    res = await FormDoctorEngine().analyze(req)
    assert len(res.findings) >= 1
    for f in res.findings:
        print(f"Finding: {f.rule_id} (sev: {f.severity.value}, conf: {f.confidence.value})")
        for ev in f.evidence:
            expected_hash = hashlib.sha256(xdp.encode("utf-8")).hexdigest()
            assert ev.sha256 == expected_hash, f"Hash mismatch: got {ev.sha256}, expected {expected_hash}"
            xdp_lines = xdp.splitlines()
            line_content = xdp_lines[ev.line_number - 1].strip()
            print(f"  Line {ev.line_number}: col {ev.column_number}: content={repr(line_content)}")
            assert '<bind match="dataRef" ref="$.Header.Missing"/>' in line_content
            print(f"  SHA-256 Verified: {ev.sha256}")

    print("\n--- CHECK 2: OPD Guard Evidence Veracity ---")
    csv_content = """# Step: Channel
COND_DOCTYPE,RESULT
*,PRINT
ZINV,EMAIL
"""
    req2 = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000004",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.OPD_GUARD,
        raw_content=csv_content,
        artifact_type=ArtifactType.CSV,
    )
    res2 = await OPDGuardEngine().analyze(req2)
    shadowed = [f for f in res2.findings if f.rule_id == "OPD_UNREACHABLE_RULE"]
    assert len(shadowed) == 1
    f = shadowed[0]
    print(f"Finding: {f.rule_id} (sev: {f.severity.value}, conf: {f.confidence.value})")
    for ev in f.evidence:
        expected_hash = hashlib.sha256(csv_content.strip().encode("utf-8")).hexdigest()
        assert ev.sha256 == expected_hash, f"Hash mismatch: got {ev.sha256}, expected {expected_hash}"
        csv_lines = csv_content.splitlines()
        line_content = csv_lines[ev.line_number - 1].strip()
        print(f"  Line {ev.line_number}: content={repr(line_content)}")
        assert line_content == "ZINV,EMAIL"
        print(f"  SHA-256 Verified: {ev.sha256}")

    print("\n--- CHECK 3: FormDoctor SAPscript Evidence Line/Hash Veracity ---")
    sapscript_text = "HEADER\n/: DEFINE &MY_VAR& = 'VALUE'\nFOOTER"
    req3 = AnalysisRequest(
        job_id="00000000-0000-0000-0000-000000000005",
        tenant_id="00000000-0000-0000-0000-000000000002",
        project_id="00000000-0000-0000-0000-000000000003",
        engine_type=EngineType.FORM_DOCTOR,
        raw_content=sapscript_text,
        artifact_type=ArtifactType.TXT,
        target_release="S4HC_2502",
    )
    res3 = await FormDoctorEngine().analyze(req3)
    sap_findings = [f for f in res3.findings if f.rule_id == "FORM_LEGACY_SAPSCRIPT_DETECTED"]
    assert len(sap_findings) == 1
    f_sap = sap_findings[0]
    print(f"Finding: {f_sap.rule_id} (sev: {f_sap.severity.value}, conf: {f_sap.confidence.value})")
    for ev in f_sap.evidence:
        combined = f"{sapscript_text}\n"
        expected_hash = hashlib.sha256(combined.encode("utf-8")).hexdigest()
        assert ev.sha256 == expected_hash, f"Hash mismatch: got {ev.sha256}, expected {expected_hash}"
        lines = sapscript_text.splitlines()
        print(f"  Line {ev.line_number}: snippet={repr(ev.snippet)}, line text={repr(lines[ev.line_number - 1])}")
        assert ev.line_number == 2
        assert ev.snippet == "/: DEFINE"
        print(f"  SHA-256 Verified: {ev.sha256}")

    print("\nALL EVIDENCE VERACITY CHECKS PASSED EMPIRICALLY!")

if __name__ == "__main__":
    asyncio.run(run_veracity_checks())
