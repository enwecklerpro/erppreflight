"""Axiom 2 #4 — determinism across processes, hash seeds and wall clock.

* Every golden fixture is run through its engine in separate interpreter processes with different
  PYTHONHASHSEED values; the canonical responses (findings, ids, fingerprints, evidence, status and
  non-timing metrics) must be byte-identical.
* Rule code (engines, parsers, core) must not read the system clock or random sources.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "tests" / "support" / "determinism_snapshot.py"


def _snapshot(seed: str) -> str:
    env = dict(os.environ, PYTHONHASHSEED=seed)
    proc = subprocess.run(
        [sys.executable, str(SNAPSHOT)], capture_output=True, text=True, env=env, cwd=str(ROOT), timeout=300,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    return proc.stdout


def test_golden_fixtures_byte_identical_across_hash_seeds():
    first = _snapshot("0")
    second = _snapshot("4242")
    assert len(first) > 1000
    assert first == second


FORBIDDEN = re.compile(
    r"\b(date\.today|datetime\.now|datetime\.utcnow|time\.time\(|random\.|uuid\.uuid4|uuid4\(|secrets\.)"
)


@pytest.mark.parametrize("folder", ["src/engines", "src/parsers", "src/core"])
def test_rule_code_does_not_read_clock_or_randomness(folder):
    offenders = []
    for path in sorted((ROOT / folder).rglob("*.py")):
        for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("#", 1)[0]
            if FORBIDDEN.search(code):
                offenders.append(f"{path.relative_to(ROOT)}:{no}: {line.strip()}")
    assert offenders == []
