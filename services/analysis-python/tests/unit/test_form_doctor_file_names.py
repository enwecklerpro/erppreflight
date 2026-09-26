"""
FormDoctor evidence cites the real uploaded artifact file names (P7).

The API sends the analysed artifact's name as `sourceFileName` and the companion XDP
template's name as `xdp_file_name` (next to `xdp_content`). Evidence must point at those
files instead of the template defaults ("invoice_template.xdp", "payload.xml") or the
internal object-storage key.
"""
from pathlib import Path

import pytest

from src.core.runner import EngineRunner
from src.engines.form_doctor import FormDoctorEngine
from src.models.enums import AnalysisStatus, ArtifactType, EngineType
from src.models.request import AnalysisRequest

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "domain1"
STORAGE_KEY = "tenants/0000/projects/1111/2222/rechnung_daten.xml"


def _fixture(name: str) -> str:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


def _request(configuration: dict, key: str | None = STORAGE_KEY) -> AnalysisRequest:
    return AnalysisRequest(
        job_id="22222222-1111-1111-1111-111111111191",
        tenant_id="22222222-2222-2222-2222-222222222222",
        project_id="33333333-3333-3333-3333-333333333333",
        engine_type=EngineType.FORM_DOCTOR,
        raw_content=_fixture("form_data_missing_field.xml"),
        artifact_s3_key=key,
        configuration={"xdp_content": _fixture("form_template_xdp.xml"), **configuration},
        artifact_type=ArtifactType.XML,
    )


def _evidence_paths(res) -> set[str]:
    return {ev.artifact_path for f in res.findings for ev in f.evidence}


@pytest.mark.asyncio
async def test_evidence_uses_uploaded_file_names():
    res = await EngineRunner.execute(
        _request({"sourceFileName": "rechnung_daten.xml", "xdp_file_name": "ZRECHNUNG_FORMULAR.xdp"})
    )
    assert res.status == AnalysisStatus.COMPLETED
    binding = [f for f in res.findings if f.rule_id == "FORM_FIELD_MISSING_IN_XML"]
    assert binding, "fixture must produce a broken binding"
    paths = _evidence_paths(res)
    assert "ZRECHNUNG_FORMULAR.xdp" in paths
    assert "invoice_template.xdp" not in paths
    assert STORAGE_KEY not in paths
    assert all(ev.sha256 for f in binding for ev in f.evidence)


@pytest.mark.asyncio
async def test_without_names_the_previous_behaviour_is_kept():
    res = await EngineRunner.execute(_request({}))
    paths = _evidence_paths(res)
    assert "invoice_template.xdp" in paths
    assert "ZRECHNUNG_FORMULAR.xdp" not in paths


@pytest.mark.asyncio
async def test_identical_inputs_produce_identical_evidence():
    cfg = {"sourceFileName": "rechnung_daten.xml", "xdp_file_name": "ZRECHNUNG_FORMULAR.xdp"}
    a = await EngineRunner.execute(_request(cfg))
    b = await EngineRunner.execute(_request(cfg))
    dump = lambda r: sorted((f.rule_id, ev.artifact_path, ev.line_number, ev.sha256) for f in r.findings for ev in f.evidence)
    assert dump(a) == dump(b)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("ZRECHNUNG.xdp", "ZRECHNUNG.xdp"),
        ("../../etc/passwd.xdp", "passwd.xdp"),
        ("C:\\forms\\Rechnung.xdp", "Rechnung.xdp"),
        ("bad\x00name\n.xdp", "badname.xdp"),
        ("x" * 400 + ".xdp", "x" * 255),
        (None, ""),
        (42, ""),
    ],
)
def test_file_name_is_sanitised(raw, expected):
    assert FormDoctorEngine._file_name(raw) == expected


def test_file_name_keys_are_options_not_data():
    from src.core.contracts import OPTION_KEYS
    from src.core.runner import OPTION_CONFIG_KEYS

    for key in ("xdp_file_name", "xml_file_name"):
        assert key in OPTION_KEYS
        assert key in OPTION_CONFIG_KEYS
