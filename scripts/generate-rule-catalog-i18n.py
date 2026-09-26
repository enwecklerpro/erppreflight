#!/usr/bin/env python3
"""Export the analysis service's rule catalog as the key list for UI translations.

Writes ``apps/web/src/i18n/rule-catalog/rule-catalog.en.json``: every finding code any registered
engine can emit (engine-declared rules plus the runner-generated input-validation codes) with its
English title and remediation text, exactly as ``BaseEngine.get_rule_catalog()`` declares them.

The German rule texts live in ``apps/web/src/i18n/rule-catalog/de.ts``; the web parity test
(``apps/web/src/__tests__/rule-catalog-i18n.test.ts``) fails when a code in this file has no
German title/remediation, and the Python test ``tests/test_rule_catalog_i18n_export.py`` fails when
this file is stale — so a new rule without a German translation cannot pass CI.

Engine output is never changed: the UI swaps in the German catalog text for display only.

Usage:
    python scripts/generate-rule-catalog-i18n.py           # (re)write the JSON file
    python scripts/generate-rule-catalog-i18n.py --check   # exit 1 if the JSON file is stale
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "services" / "analysis-python"
OUTPUT = ROOT / "apps" / "web" / "src" / "i18n" / "rule-catalog" / "rule-catalog.en.json"


def build_catalog() -> Dict[str, Any]:
    """Deterministic {code: {...}} map of every rule of every registered engine."""
    if str(SERVICE) not in sys.path:
        sys.path.insert(0, str(SERVICE))
    cwd = os.getcwd()
    os.chdir(SERVICE)
    try:
        import src.engines  # noqa: F401  (registers every engine, as src/main.py does)
        from src.core.contracts import INPUT_RULE_SUFFIXES
        from src.core.registry import EngineRegistry
    finally:
        os.chdir(cwd)

    rules: Dict[str, Any] = {}
    for engine_type in sorted(EngineRegistry._engines, key=lambda e: getattr(e, "value", str(e))):
        engine = EngineRegistry.get(engine_type)
        prefix = engine.get_rule_prefix()
        declared = set(engine.finding_codes)
        formats = (
            ", ".join(f.value for f in engine.input_contract.formats)
            if engine.input_contract else ", ".join(t.value for t in engine.supported_artifact_types)
        )
        for code, spec in sorted(engine.get_rule_catalog().items()):
            entry: Dict[str, Any] = {
                "engine": engine.engine_type.value,
                "title": spec.title,
                "remediation": spec.remediation,
            }
            if code not in declared:
                suffix = code[len(prefix) + 1:]
                if suffix in INPUT_RULE_SUFFIXES:
                    # Runner-generated input codes share one text template per suffix
                    # (see standard_input_rules); the variables let the UI fill the German template.
                    entry["inputRule"] = suffix
                    entry["inputArgs"] = {"engineName": engine.name, "formats": formats}
            if code in rules and rules[code] != entry:
                raise ValueError(f"Finding code {code} is declared with different texts by two engines")
            rules[code] = entry
    return {
        "_generated": "scripts/generate-rule-catalog-i18n.py — do not edit by hand",
        "rules": rules,
    }


def render(catalog: Dict[str, Any]) -> str:
    return json.dumps(catalog, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if the JSON export is stale")
    args = parser.parse_args()
    text = render(build_catalog())
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != text:
            print(f"{OUTPUT.relative_to(ROOT)} is stale — run: python scripts/generate-rule-catalog-i18n.py", file=sys.stderr)
            return 1
        print("rule catalog export is up to date")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({len(json.loads(text)['rules'])} finding codes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
