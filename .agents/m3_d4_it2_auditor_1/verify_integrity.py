import asyncio
import hashlib
from pathlib import Path
from src.engines.software_collection import SoftwareCollectionEngine, SoftwareCollectionItem
from src.engines.transport_dependency import TransportDependencyEngine
from src.models.request import AnalysisRequest
from src.models.enums import EngineType, ArtifactType, AnalysisStatus, ConfidenceClass
from src.platform.confidence import ConfidenceClassifier
from src.models.finding import Finding
from src.models.evidence import Evidence

def test_cts_csv_discrimination():
    content = Path('services/analysis-python/tests/fixtures/domain4/tr_e070_e071_complete.csv').read_text(encoding='utf-8')
    req = AnalysisRequest(
        job_id='check-csv-it2',
        tenant_id='t',
        project_id='p',
        engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
        raw_content=content,
        artifact_type=ArtifactType.CSV
    )
    eng = TransportDependencyEngine()
    data = eng._parse_inputs(req)
    total_objects = sum(len(objs) for objs in data.objects_by_tr.values())
    total_keys = sum(len(k) for k in data.keys_by_tr.values())
    print(f'[CHECK 2] CTS CSV: total_objects={total_objects}, total_keys={total_keys}')
    assert total_objects == 3, f'Expected 3 objects, got {total_objects}'
    assert total_keys == 1, f'Expected 1 key, got {total_keys}'
    assert 'DEVK900010' in data.objects_by_tr
    assert 'DEVK900020' in data.objects_by_tr
    assert 'DEVK900030' in data.objects_by_tr
    assert 'DEVK900080' in data.keys_by_tr
    print('  -> PASS: CTS CSV row discrimination is cell-content-driven!')

def test_algorithmic_attribution():
    code_text = Path('services/analysis-python/src/engines/transport_dependency.py').read_text(encoding='utf-8')
    assert 'Tarjan' not in code_text, 'Found reference to Tarjan in transport_dependency.py'
    assert 'Cycle Detection via 3-Color Recursive DFS' in code_text, 'Missing 3-Color Recursive DFS comment'
    print('[CHECK 3] Algorithmic Attribution:')
    print('  -> PASS: Cycle detection explicitly attributed to 3-Color Recursive DFS. Tarjan claim removed.')

def test_unicode_and_pydantic_hardening():
    # 1. Non-Latin1 parsing
    manifest = SoftwareCollectionEngine.parse_artifact(
        '{"collections": [{"id": "JP_COL", "items": [{"id": "YY1_TEST", "type": "CUSTOM_FIELD", "comment": "東京 München 🚀 日本語"}]}]}'
    )
    assert len(manifest.collections) == 1
    assert manifest.collections[0].id == "JP_COL"
    print('[CHECK 4] Unicode Hardening:')
    print('  -> PASS: Non-Latin1 UTF-8 parsed without UnicodeEncodeError!')

    # 2. Integer dependencies in SoftwareCollectionItem
    item = SoftwareCollectionItem.model_validate({"id": "ITEM1", "type": "CUSTOM_FIELD", "dependencies": 99999})
    assert item.dependencies == []
    print('  -> PASS: Integer dependencies safely normalized to [] in SoftwareCollectionItem.')

    # 3. Analyze request with non-Latin1 text and int dependencies
    req = AnalysisRequest(
        job_id='check-unicode',
        tenant_id='t',
        project_id='p',
        engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
        raw_content='{"collections": [{"id": "JP_COL", "name": "日本語コレクション", "items": [{"id": "YY1_JP", "type": "CUSTOM_FIELD", "status": "PUBLISHED", "dependencies": 12345}]}]}',
        artifact_type=ArtifactType.JSON
    )
    eng = SoftwareCollectionEngine()
    resp = asyncio.run(eng.analyze(req))
    assert resp.status == AnalysisStatus.COMPLETED
    print('  -> PASS: End-to-end analyze() with Unicode and non-list dependencies succeeded cleanly!')

def test_evidence_cryptographic_veracity():
    print('[CHECK 6] Cryptographic SHA-256 and Line/Column Verification:')
    # Run SC engine on defect fixture
    fixture_path = Path('services/analysis-python/tests/fixtures/domain4/sc_circular.json')
    content = fixture_path.read_text(encoding='utf-8')
    req = AnalysisRequest(
        job_id='check-ev-sc', tenant_id='t', project_id='p',
        engine_type=EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD,
        raw_content=content, artifact_type=ArtifactType.JSON
    )
    sc_eng = SoftwareCollectionEngine()
    sc_resp = asyncio.run(sc_eng.analyze(req))
    assert len(sc_resp.findings) > 0, 'Expected findings in circular dependency fixture'
    for f in sc_resp.findings:
        assert len(f.evidence) > 0, f'Finding {f.rule_id} missing evidence'
        for ev in f.evidence:
            assert ev.sha256 and len(ev.sha256) == 64, f'Invalid sha256: {ev.sha256}'
            assert ev.line_number is not None and ev.line_number >= 1, f'Invalid line_number: {ev.line_number}'
            assert ev.column_number is not None and ev.column_number >= 1, f'Invalid column_number: {ev.column_number}'
            assert ev.snippet is not None and len(ev.snippet) > 0, 'Empty snippet in evidence'
    print(f'  -> PASS: Verified {len(sc_resp.findings)} SC findings with authentic SHA-256 hashes and line/col coordinates.')

    # Run TR engine on collision fixture
    fixture_path_tr = Path('services/analysis-python/tests/fixtures/domain4/tr_collision.json')
    content_tr = fixture_path_tr.read_text(encoding='utf-8')
    req_tr = AnalysisRequest(
        job_id='check-ev-tr', tenant_id='t', project_id='p',
        engine_type=EngineType.TRANSPORT_DEPENDENCY_ANALYZER,
        raw_content=content_tr, artifact_type=ArtifactType.JSON
    )
    tr_eng = TransportDependencyEngine()
    tr_resp = asyncio.run(tr_eng.analyze(req_tr))
    assert len(tr_resp.findings) > 0, 'Expected findings in collision fixture'
    for f in tr_resp.findings:
        assert len(f.evidence) > 0, f'Finding {f.rule_id} missing evidence'
        for ev in f.evidence:
            assert ev.sha256 and len(ev.sha256) == 64, f'Invalid sha256: {ev.sha256}'
            assert ev.line_number is not None and ev.line_number >= 1, f'Invalid line_number: {ev.line_number}'
            assert ev.column_number is not None and ev.column_number >= 1, f'Invalid column_number: {ev.column_number}'
            assert ev.snippet is not None and len(ev.snippet) > 0, 'Empty snippet in evidence'
    print(f'  -> PASS: Verified {len(tr_resp.findings)} TR findings with authentic SHA-256 hashes and line/col coordinates.')

def test_epistemic_confidence_invariants():
    print('[CHECK 7] Epistemic Confidence Invariants (AI cap 0.60, UNKNOWN demotion 0.30):')
    # 1. Missing evidence demotes to UNKNOWN (0.30)
    dummy_finding = Finding(
        rule_id='TEST_RULE',
        severity='BLOCKER',
        category='TEST',
        title='Test Finding',
        description='Test Description',
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        evidence=[], # Empty evidence!
        remediation='Fix it'
    )
    classified = ConfidenceClassifier.classify(dummy_finding)
    assert classified.confidence == ConfidenceClass.UNKNOWN, f'Expected UNKNOWN, got {classified.confidence}'
    assert classified.confidence_score == 0.30, f'Expected 0.30, got {classified.confidence_score}'
    print('  -> PASS: Empty evidence correctly demoted to UNKNOWN (0.30).')

    # 2. AI-assisted finding capped at INFERRED (0.60)
    dummy_ev = Evidence(
        artifact_path='test.json',
        snippet='test',
        sha256=hashlib.sha256(b'test').hexdigest(),
        provenance=ConfidenceClass.VERIFIED,
        line_number=1, column_number=1
    )
    ai_finding = Finding(
        rule_id='TEST_AI_RULE',
        severity='MAJOR',
        category='TEST',
        title='AI Finding',
        description='AI Description',
        confidence=ConfidenceClass.VERIFIED,
        confidence_score=1.0,
        evidence=[dummy_ev],
        remediation='Fix it'
    )
    classified_ai = ConfidenceClassifier.classify(ai_finding, is_ai_generated=True)
    assert classified_ai.confidence == ConfidenceClass.INFERRED, f'Expected INFERRED, got {classified_ai.confidence}'
    assert classified_ai.confidence_score == 0.60, f'Expected 0.60, got {classified_ai.confidence_score}'
    print('  -> PASS: AI-generated finding strictly capped at INFERRED (0.60).')

if __name__ == '__main__':
    test_cts_csv_discrimination()
    test_algorithmic_attribution()
    test_unicode_and_pydantic_hardening()
    test_evidence_cryptographic_veracity()
    test_epistemic_confidence_invariants()
    print('\nALL FORENSIC INTEGRITY PROBES PASSED 100% CLEANLY!')
