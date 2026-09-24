def test_liveness_probe(client):
    response = client.get("/health/liveness")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "analysis-python"
    assert "timestamp" in data


def test_root_health_probe(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "analysis-python"
    assert "timestamp" in data


def test_readiness_probe(client):
    response = client.get("/health/readiness")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["engines_registered"] >= 19
    assert data["checks"]["registry_ready"] is True
