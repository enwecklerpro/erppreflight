"""Supply-chain guard: test tooling never ships in the analysis runtime image.

infra/docker/Dockerfile.analysis installs only requirements.txt (+ requirements-otel.txt);
requirements-dev.txt layers the test tools on top of it for CI and local runs.
"""

import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[2]
TEST_ONLY = {"pytest", "pytest-asyncio", "pytest-cov", "hypothesis"}


def _requirement_names(path: Path) -> list[str]:
    names = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        names.append(re.split(r"[\[<>=!~ ;]", line, maxsplit=1)[0].lower())
    return names


def test_runtime_requirements_contain_no_test_tooling():
    runtime = set(_requirement_names(SERVICE_ROOT / "requirements.txt"))
    assert runtime.isdisjoint(TEST_ONLY), runtime & TEST_ONLY


def test_dev_requirements_include_runtime_and_test_tooling():
    dev_file = SERVICE_ROOT / "requirements-dev.txt"
    assert "-r requirements.txt" in dev_file.read_text(encoding="utf-8")
    assert TEST_ONLY <= set(_requirement_names(dev_file))


def test_pyproject_runtime_dependencies_match_requirements():
    text = (SERVICE_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    block = re.search(r"^dependencies = \[(.*?)^\]", text, re.S | re.M)
    assert block, "pyproject.toml has no [project] dependencies block"
    declared = {re.split(r"[\[<>=!~ ;]", d, maxsplit=1)[0].lower() for d in re.findall(r'"([^"]+)"', block.group(1))}
    assert declared.isdisjoint(TEST_ONLY)
    assert declared == set(_requirement_names(SERVICE_ROOT / "requirements.txt"))
