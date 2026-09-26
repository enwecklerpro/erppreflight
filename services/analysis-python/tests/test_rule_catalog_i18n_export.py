"""The UI's rule-catalog export must match the live engine registry.

``apps/web/src/i18n/rule-catalog/rule-catalog.en.json`` is the key list for the German rule texts
(web parity test ``rule-catalog-i18n.test.ts``). When a rule is added or its English text changes,
this test fails until ``python scripts/generate-rule-catalog-i18n.py`` is re-run — and the web
parity test then fails until the German translation exists.
"""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "generate-rule-catalog-i18n.py"


def _load_generator():
    spec = importlib.util.spec_from_file_location("generate_rule_catalog_i18n", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.mark.skipif(not SCRIPT.exists(), reason="monorepo checkout required (script lives outside the service)")
def test_rule_catalog_export_is_current():
    gen = _load_generator()
    expected = gen.render(gen.build_catalog())
    current = gen.OUTPUT.read_text(encoding="utf-8") if gen.OUTPUT.exists() else ""
    assert current == expected, "rule-catalog.en.json is stale: run python scripts/generate-rule-catalog-i18n.py"


@pytest.mark.skipif(not SCRIPT.exists(), reason="monorepo checkout required (script lives outside the service)")
def test_rule_catalog_export_covers_every_engine_code():
    gen = _load_generator()
    rules = gen.build_catalog()["rules"]
    from src.core.registry import EngineRegistry

    for engine in EngineRegistry._engines.values():
        for code in engine.get_rule_catalog():
            assert code in rules, code
            assert rules[code]["remediation"].strip(), code
