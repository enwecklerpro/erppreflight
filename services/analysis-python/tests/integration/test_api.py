def test_get_engines_list(client):
    response = client.get("/api/v1/engines")
    assert response.status_code == 200
    engines = response.json()
    assert len(engines) >= 19
    engine_types = [e["engine_type"] for e in engines]
    assert "OPD_GUARD" in engine_types
    assert "MFS_BLACKBOX" in engine_types


def test_get_specific_engine(client):
    response = client.get("/api/v1/engines/OPD_GUARD")
    assert response.status_code == 200
    data = response.json()
    assert data["engine_type"] == "OPD_GUARD"
    assert data["name"] == "OPD Guard"


def test_post_analyze_endpoint(client):
    payload = {
        "job_id": "99999999-9999-9999-9999-999999999999",
        "tenant_id": "88888888-8888-8888-8888-888888888888",
        "project_id": "77777777-7777-7777-7777-777777777777",
        "engine_type": "FORM_DOCTOR",
        "target_release": "S4H_2023",
        "artifact_type": "XML",
        "raw_content": "<smartform><name>Z_INV_01</name><node>%PAGE 1</node></smartform>",
    }
    response = client.post("/api/v1/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["job_id"] == payload["job_id"]
    assert data["status"] == "COMPLETED"
    assert any(f["rule_id"] == "FORM_LEGACY_SMARTFORM_DETECTED" for f in data["findings"])
    assert data["engine_type"] == "FORM_DOCTOR"
    assert data["metrics"]["rules_evaluated"] > 0


def test_post_analyze_data_xml_without_template_is_insufficient(client):
    """A runtime data XML alone carries no bindings to verify: no verdict, FAILED + INSUFFICIENT_INPUT."""
    payload = {
        "job_id": "99999999-9999-9999-9999-999999999998",
        "tenant_id": "88888888-8888-8888-8888-888888888888",
        "project_id": "77777777-7777-7777-7777-777777777777",
        "engine_type": "FORM_DOCTOR",
        "artifact_type": "XML",
        "raw_content": "<form><name>Z_INV_01</name></form>",
    }
    data = client.post("/api/v1/analyze", json=payload).json()
    assert data["status"] == "FAILED"
    assert [f["rule_id"] for f in data["findings"]] == ["FORM_INSUFFICIENT_INPUT"]
    assert data["findings"][0]["confidence"] == "UNKNOWN"
