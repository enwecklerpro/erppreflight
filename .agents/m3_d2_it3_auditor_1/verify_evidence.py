import asyncio
import hashlib
import sys
import uuid

sys.path.insert(0, "services/analysis-python")
from src.engines import ECC2CloudEngine, SPRO2CloudEngine, CleanCoreEngine, GapRadarEngine
from src.models.request import AnalysisRequest

async def main():
    job_id = str(uuid.uuid4())
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())

    reqs = [
        (ECC2CloudEngine, AnalysisRequest(
            job_id=job_id,
            tenant_id=tenant_id,
            project_id=project_id,
            engine_type="ECC2CLOUD_NAVIGATOR",
            target_release="S4HC_2408",
            artifact_type="CSV",
            raw_content="Z_OBJECT_REPORT,25000,200,10\nVA01,50000,300,20\nRFC_READ_TABLE,1000\n",
        )),
        (SPRO2CloudEngine, AnalysisRequest(
            job_id=job_id,
            tenant_id=tenant_id,
            project_id=project_id,
            engine_type="SPRO2CLOUD",
            target_release="S4HC_2408",
            artifact_type="CSV",
            raw_content="Activity_ID,Table_Name,Module\nSIMG_CFMENUOLSDOVL1,TVKO,SD\nZ_CUSTOM_ACT,ZTAB,MM\n",
        )),
        (CleanCoreEngine, AnalysisRequest(
            job_id=job_id,
            tenant_id=tenant_id,
            project_id=project_id,
            engine_type="CLEAN_CORE_OBJECT_GUARD",
            target_release="S4HC_2408",
            artifact_type="ABAP",
            raw_content="REPORT z_test.\nTABLES: mara.\nSELECT * FROM mara INTO TABLE @DATA(lt_mara).\nCALL \"SYSTEM\".\n",
        )),
        (GapRadarEngine, AnalysisRequest(
            job_id=job_id,
            tenant_id=tenant_id,
            project_id=project_id,
            engine_type="SAP_GAP_RADAR",
            target_release="S4HC_2408",
            artifact_type="TXT",
            raw_content="Direct transparent database write to BSEG\nCustom field on SalesOrder\nUnknown custom exotic business requirement\n",
        )),
    ]

    total_findings = 0
    total_evidences = 0
    failures = []

    for engine_cls, req in reqs:
        engine = engine_cls()
        res = await engine.analyze(req)
        print(f"{engine_cls.__name__} emitted {len(res.findings)} findings")
        total_findings += len(res.findings)
        for f in res.findings:
            if not f.evidence:
                failures.append(f"{engine_cls.__name__} {f.rule_id}: no evidence")
                continue
            for ev in f.evidence:
                total_evidences += 1
                if not ev.line_number or ev.line_number < 1:
                    failures.append(f"{engine_cls.__name__} {f.rule_id}: invalid line_number {ev.line_number}")
                if not ev.column_number or ev.column_number < 1:
                    failures.append(f"{engine_cls.__name__} {f.rule_id}: invalid col_number {ev.column_number}")
                if not ev.snippet:
                    failures.append(f"{engine_cls.__name__} {f.rule_id}: empty snippet")
                expected_hash = hashlib.sha256(ev.snippet.encode("utf-8")).hexdigest()
                if ev.sha256 != expected_hash:
                    failures.append(f"{engine_cls.__name__} {f.rule_id}: sha256 mismatch {ev.sha256} vs {expected_hash}")

    print(f"\nSummary:")
    print(f"Total findings verified: {total_findings}")
    print(f"Total evidence items checked: {total_evidences}")
    print(f"Cryptographic and line/column verification failures: {failures}")

if __name__ == "__main__":
    asyncio.run(main())
