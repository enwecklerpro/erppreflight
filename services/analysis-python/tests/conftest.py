import sys
from pathlib import Path

# Ensure services/analysis-python is in python path
service_root = Path(__file__).resolve().parent.parent
if str(service_root) not in sys.path:
    sys.path.insert(0, str(service_root))

import os

# Every finding code emitted anywhere in the suite must be declared in its engine's rule catalog
# (Axiom 2 #5/#14): the runner raises UndeclaredRuleError instead of only logging.
os.environ.setdefault("ERPP_STRICT_RULE_CATALOG", "1")

import pytest
from starlette.testclient import TestClient
from src.main import create_app


@pytest.fixture(scope="session")
def client() -> TestClient:
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
