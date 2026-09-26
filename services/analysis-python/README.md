# ERP Preflight Analysis Engine (Python FastAPI)

Stateless, deterministic analysis microservice hosting the 18 SAP preflight engines + MFS BlackBox.

## Quick Start

```bash
pip install -r requirements-dev.txt        # runtime + pytest, pytest-asyncio, hypothesis
python -m pytest tests -q                  # full suite (unit, adversarial, property, determinism)
uvicorn src.main:app --port 8000           # run service
```

## Engine SDK (spec 05 §5.12, AGENTS.md Axiom 2)

Every engine (`src/engines/*.py`) declares in one place, between the
`# ==== ENGINE CONTRACT ====` markers:

- `RULES = rule_catalog(RuleSpec(code, title, severity, remediation, category), ...)` — the complete
  finding-code inventory with remediation guides. The runner rejects undeclared codes in strict mode
  (`ERPP_STRICT_RULE_CATALOG=1`, enabled in tests) and fills empty remediation from the catalog.
- `INPUT_CONTRACT = InputContract(formats, summary, required, json_model, ...)` — accepted formats and a
  Pydantic model for structured input. `src/core/contracts.py::validate_request_input` enforces it before any
  rule runs: empty/garbage/malformed/unrelated payloads end as `<PREFIX>_INSUFFICIENT_INPUT`,
  `<PREFIX>_PARSE_ERROR`, `<PREFIX>_INVALID_INPUT` or `<PREFIX>_ARCHIVE_REJECTED` (status FAILED, UNKNOWN
  confidence) — never as a verdict.
- optional `knowledge_sources` (provenance of static catalogs, spec §59) and `engine_health_checks()`.
- `BaseEngine.contract_probes()` is the test-generation hook used by `tests/unit/test_engine_contracts.py`.

The runner records telemetry per analysis (duration, tracemalloc peak memory, rules evaluated, finding count,
unknown-finding rate) in `metrics` and `metrics.additional_metrics.telemetry`.

## Admin catalog

- `GET /api/v1/engines` — per engine: version, domain, target releases, supported formats, rule codes/count
  (derived from the declared catalog), rules with remediation, input contract summary, knowledge sources, health.
- `GET /api/v1/engines/{ENGINE}` / `GET /api/v1/engines/{ENGINE}/health` / `GET /api/v1/engines-summary`.

## Hardened parsers

- `src/parsers/json_input.py` — strict JSON with a 64-level nesting cap.
- `src/parsers/safe_xml.py` — defusedxml (no DTD/entities/external refs), 256-level depth cap, line/column retention.
- `src/parsers/safe_zip.py` — 100:1 ratio, 500 MB total, entry cap, traversal/encryption rejection, nested
  archives up to 2 levels with shared global budgets.
- `src/parsers/abap_tokenizer.py` — ABAP lexer/statement splitter (literals, templates, comments, chains,
  EXEC SQL) used by the Clean Core Object Guard; released-object knowledge lives in
  `src/knowledge/clean_core_released_objects.v2408.1.json` (versioned, immutable snapshot).
