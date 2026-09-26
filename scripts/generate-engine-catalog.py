#!/usr/bin/env python3
"""Generate ENGINE_CATALOG.md from the analysis service's live engine registry.

The catalog is derived, never hand-written, so it cannot drift from the code:

* engine metadata (type, name, description, version, artifact types, rule prefix) comes from
  ``EngineRegistry`` after importing ``src.engines`` exactly like ``src/main.py`` does;
* finding codes are the string constants (and ``f"{self.rule_prefix}_..."`` templates) in the
  registered engine's module that start with the engine's rule prefix, plus the runner-level
  input codes every engine can emit;
* tests / fixtures are the test files under ``services/analysis-python/tests`` that reference
  the engine class or its ``EngineType`` member, and the fixture files those tests name;
* the "input probes" run every engine through ``EngineRunner.execute`` with an empty payload and
  with a non-SAP text payload, and record the resulting status and codes. This documents, from
  observed behaviour, which engines reject unusable input.

Usage:
    python scripts/generate-engine-catalog.py            # (re)write ENGINE_CATALOG.md
    python scripts/generate-engine-catalog.py --check    # exit 1 if ENGINE_CATALOG.md is stale

Needs the service's requirements (fastapi, pydantic, defusedxml ...) installed.
"""
from __future__ import annotations

import argparse
import ast
import asyncio
import inspect
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "services" / "analysis-python"
TESTS = SERVICE / "tests"
FIXTURES = TESTS / "fixtures"
OUTPUT = ROOT / "ENGINE_CATALOG.md"

sys.path.insert(0, str(SERVICE))
os.chdir(SERVICE)

import src.engines  # noqa: E402,F401  (registers every engine, as src/main.py does)
from src.core.registry import EngineRegistry  # noqa: E402
from src.core.runner import EngineRunner  # noqa: E402
from src.models.request import AnalysisRequest  # noqa: E402

CODE_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$")
RUNNER_SUFFIXES = ("INSUFFICIENT_INPUT", "PARSE_ERROR", "INVALID_INPUT")
PROBE_GARBAGE = "this is not an SAP artifact\nlorem ipsum 42\n"


def finding_codes(module_path: Path, prefix: str) -> list[str]:
    """String constants / rule_prefix f-strings in the module that look like finding codes."""
    tree = ast.parse(module_path.read_text(encoding="utf-8"))
    codes: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if CODE_RE.match(node.value) and node.value.startswith(prefix + "_"):
                codes.add(node.value)
        elif isinstance(node, ast.JoinedStr):
            parts: list[str] = []
            for value in node.values:
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    parts.append(value.value)
                elif (isinstance(value, ast.FormattedValue) and isinstance(value.value, ast.Attribute)
                      and value.value.attr == "rule_prefix"):
                    parts.append(prefix)
                else:
                    parts = []
                    break
            text = "".join(parts)
            if text and CODE_RE.match(text) and text.startswith(prefix + "_"):
                codes.add(text)
    return sorted(codes)


def related_tests(class_name: str, member: str) -> tuple[list[str], list[str]]:
    fixture_names = sorted(p.name for p in FIXTURES.rglob("*") if p.is_file()) if FIXTURES.exists() else []
    tests: list[str] = []
    fixtures: set[str] = set()
    for path in sorted(TESTS.rglob("test_*.py")):
        text = path.read_text(encoding="utf-8", errors="replace")
        if re.search(rf"\b{re.escape(class_name)}\b", text) or f"EngineType.{member}" in text \
                or f'"{member}"' in text or f"'{member}'" in text:
            tests.append(path.relative_to(SERVICE).as_posix())
            fixtures.update(name for name in fixture_names if name in text)
    return tests, sorted(fixtures)


async def probe(engine_type, artifact_type, raw: str | None) -> str:
    request = AnalysisRequest(
        job_id="catalog-probe", tenant_id="catalog", project_id="catalog",
        engine_type=engine_type, artifact_type=artifact_type, raw_content=raw,
        configuration={"evaluation_date": "2026-01-01"},
    )
    try:
        response = await EngineRunner.execute(request)
    except Exception as exc:  # the probe documents behaviour; it never hides it
        return f"exception `{type(exc).__name__}`"
    status = getattr(response.status, "value", response.status)
    pairs = sorted({(f.rule_id, getattr(f.confidence, "value", f.confidence)) for f in response.findings})
    shown = ", ".join(f"`{code}` ({conf})" for code, conf in pairs[:3]) + (" …" if len(pairs) > 3 else "")
    return f"{status}, {len(response.findings)} finding(s)" + (f": {shown}" if pairs else "")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if ENGINE_CATALOG.md is out of date")
    args = parser.parse_args()

    engines = sorted(EngineRegistry._engines.values(), key=lambda e: e.engine_type.value)
    registered_modules = {Path(inspect.getfile(type(e))).name for e in engines}
    unregistered = sorted(p.name for p in (SERVICE / "src" / "engines").glob("*.py")
                          if p.name != "__init__.py" and p.name not in registered_modules)

    out: list[str] = []
    w = out.append
    w("# ERP Preflight — Engine Catalog")
    w("")
    w("> **Generated file — do not edit by hand.** Source: the analysis service engine registry")
    w("> (`services/analysis-python/src/engines`). Regenerate with")
    w("> `python scripts/generate-engine-catalog.py`; CI runs it with `--check` and fails when this")
    w("> file no longer matches the code.")
    w("")
    w(f"**{len(engines)} engines registered.** Every engine runs deterministically behind "
      "`POST /api/v1/analyses` (the API queues a BullMQ job; the Python service executes it). "
      "Every finding carries a confidence class (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`); "
      "findings without a verifiable artifact path, line and SHA-256 are demoted to `UNKNOWN` by "
      "the runner.")
    w("")
    w("Runner-level input codes available to every engine (`<PREFIX>_` + suffix): "
      + ", ".join(f"`{s}`" for s in RUNNER_SUFFIXES) + ".")
    w("")
    w("## Overview")
    w("")
    w("| Engine type (API value) | Name | Rule prefix | Artifact types | Binary input | Version |")
    w("|---|---|---|---|---|---|")
    for e in engines:
        types = ", ".join(t.value for t in e.supported_artifact_types)
        w(f"| `{e.engine_type.value}` | {e.name} | `{e.get_rule_prefix()}` | {types} | "
          f"{'yes' if e.accepts_binary_input else 'no'} | {e.version} |")
    w("")
    w("## Input probes (observed behaviour)")
    w("")
    w("Each engine is executed through `EngineRunner.execute` with its first supported artifact type. "
      "*Empty* sends no payload; *non-SAP text* sends a short plain-text string. An engine that "
      "answers `COMPLETED, 0 finding(s)` to non-SAP text cannot distinguish \"nothing wrong\" from "
      "\"nothing understood\" — see KNOWN_LIMITATIONS.md.")
    w("")
    w("| Engine type | Empty payload | Non-SAP text payload |")
    w("|---|---|---|")
    for e in engines:
        art = e.supported_artifact_types[0]
        empty = asyncio.run(probe(e.engine_type, art, None))
        garbage = asyncio.run(probe(e.engine_type, art, PROBE_GARBAGE))
        w(f"| `{e.engine_type.value}` | {empty} | {garbage} |")
    w("")
    w("## Engines")
    for e in engines:
        cls = type(e)
        module = Path(inspect.getfile(cls))
        prefix = e.get_rule_prefix()
        codes = finding_codes(module, prefix)
        tests, fixtures = related_tests(cls.__name__, e.engine_type.name)
        w("")
        w(f"### {e.name} — `{e.engine_type.value}`")
        w("")
        w(f"{e.description}")
        w("")
        w(f"- **Implementation:** `{module.relative_to(ROOT).as_posix()}` (`{cls.__name__}`)")
        w(f"- **Artifact types:** {', '.join(t.value for t in e.supported_artifact_types)}"
          + (" (binary payloads accepted as base64)" if e.accepts_binary_input else ""))
        w(f"- **Finding codes in the engine module ({len(codes)}):** "
          + (", ".join(f"`{c}`" for c in codes) if codes else "none with the rule prefix"))
        w(f"- **Tests referencing the engine ({len(tests)}):** "
          + (", ".join(f"`{t}`" for t in tests) if tests else "none"))
        w(f"- **Fixture files named in those test files ({len(fixtures)}):** "
          + (", ".join(f"`{f}`" for f in fixtures) if fixtures else "none under `tests/fixtures`"))
    w("")
    w("## Modules in `src/engines` that are not registered")
    w("")
    if unregistered:
        w("These files are importable but no registered engine is defined in them; the registry "
          "never dispatches to code that lives only there:")
        w("")
        for name in unregistered:
            w(f"- `services/analysis-python/src/engines/{name}`")
    else:
        w("None.")
    w("")
    content = "\n".join(out)

    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != content:
            print("ENGINE_CATALOG.md is out of date. Run: python scripts/generate-engine-catalog.py", file=sys.stderr)
            return 1
        print(f"ENGINE_CATALOG.md is up to date ({len(engines)} engines).")
        return 0
    OUTPUT.write_text(content, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({len(engines)} engines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
