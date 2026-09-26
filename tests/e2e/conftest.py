"""ERP Preflight - Pytest Conftest Configuration for Opaque-Box E2E Testing."""

import os
import sys
from pathlib import Path
import pytest

# Ensure root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture(scope="session")
def fixtures_root() -> Path:
    return PROJECT_ROOT / "tests" / "e2e" / "fixtures"


@pytest.fixture(scope="session")
def sample_tenant_id() -> str:
    return "org_01H9A3XW8Y1234567890ABCDEF"


@pytest.fixture(scope="session")
def sample_project_id() -> str:
    return "proj_01H9A3XW8Y9876543210FEDCBA"
