# SAP Preflight Engine Authoring & Execution Standard Playbook

> **Playbook Identifier**: `engine-authoring`  
> **Authority**: Binding architectural specification across all 18 SAP Preflight Engines and platform analysis modules.  
> **Governing Standards**: Part 22.4, Part 17 Trust AI, Python 3.13 FastAPI, Pydantic, Zod, pytest, Hypothesis.  
> **Anchored Cardinal Axiom**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Defined in `AGENTS.md` Section 1)  
> **Applicable Trigger**: Any implementation, modification, refactoring, or testing of an analysis engine or parser in `services/analysis-python` or TypeScript analysis packages.

---

## 1. Overview & Operational Philosophy

ERP Preflight delivers audit-grade, defensible preflight analysis for enterprise SAP migrations, Clean Core compliance, and release upgrades. Preflight findings are relied upon by enterprise architects, systems integrators, and auditors to make multimillion-dollar migration decisions.

Therefore, an engine in ERP Preflight is **never** a loose generative prompt or probabilistic heuristic. Every engine operates as a deterministic, pure evaluation machine backed by rigorous parsing, cryptographic evidence pointers, and curated regression test fixtures. Generative AI is strictly restricted to secondary explanatory text and remediation assistance.

---

## 2. Cardinal Axiom 2 & The 14-Point Engine Anatomy Specification

Section 1 of `AGENTS.md` defines **Cardinal Axiom 2**: *"An engine without deterministic logic/evidence/fixtures is not complete."* A preflight analysis engine is not a prompt wrapper or heuristic script. Every engine within `services/analysis-python/src/engines/` must implement all 14 points below to achieve preflight certification:

| Point | Anatomy Component | Requirement & Technical Implementation |
|---|---|---|
| **1** | **Metadata** | Unique `engine_type` from `EngineTypeEnum`, human-readable name, domain classification, semantic `version` string (e.g. `2.1.0`), supported target releases (`TargetReleaseEnum`), and supported artifact types (`ArtifactTypeEnum`). |
| **2** | **Input Schema** | Strict runtime schema validation (Pydantic model in Python, Zod in TypeScript). Rejects missing or extra fields before execution. Never accept unvalidated JSON. |
| **3** | **Parser / Normalizer** | Memory-bounded artifact parser transforming raw text, XML, JSON, or CSV into typed domain structures with exact line, column, and byte offset tracking. |
| **4** | **Deterministic Analysis** | Pure, rule-based AST, DOM, or tabular evaluations. Given identical input bytes and rule versions, the output MUST be bitwise identical. Zero network I/O, zero random seed drift. |
| **5** | **Finding Codes** | Namespaced identifier following `<ENGINE>_<CATEGORY>_<SPECIFIC_DEFECT>` (e.g. `OPD_DETERMINATION_STEP_MISSING`, `CLEAN_CORE_TIER3_DIRECT_DB_MUTATION`). |
| **6** | **Evidence Items** | Every finding must attach one or more `EvidenceItem` structures containing artifact path, line/col numbers, exact snippet, context preview, SHA-256 hash, and source trust score. |
| **7** | **Confidence Classifier** | Enforces the 4 confidence classes (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`). Absence of evidence automatically demotes to `UNKNOWN`. |
| **8** | **Fixtures** | Curated minimal test artifacts: at least one positive fixture (compliant/clean), one negative fixture (defect triggered), and one edge-case fixture (malformed, empty, or boundary). |
| **9** | **Tests** | Automated test suite in `pytest` (Python) or Vitest (TS) testing all rules, line offset extraction, and error conditions with 100% pass rate. |
| **10** | **Generated / Property Tests** | Property-based tests via `Hypothesis` (Python) or `fast-check` (TS) providing fuzz inputs to prove the engine fails closed without uncaught crashes. |
| **11** | **Metrics & Telemetry** | Execution duration, memory footprint, rule evaluation count, finding count by severity, unknown rate, and total bytes processed recorded per run. |
| **12** | **Project / Report Integration** | Finding output serializable to `FindingWireSchema` / `BaseFindingSchema` for database storage and client report generation. |
| **13** | **Admin Trust Center Visibility** | Health check endpoints, rule bundle version reporting, and quality status exposed to the admin monitoring service. |
| **14** | **Documentation & Runbook** | Markdown documentation detailing rule logic, SAP note references, Clean Core justification, and step-by-step remediation guide. |

---

## 3. Deterministic AST / DOM / Rule Logic Principles

### 3.1 Purity and Bitwise Reproducibility
- An engine must behave as a pure function: $\text{Engine}(A, R, K) \to [F_1, F_2, \dots, F_n]$, where $A$ is the input artifact, $R$ is the target release, and $K$ is the immutable knowledge snapshot.
- Given identical inputs, the findings, evidence hashes, and confidence scores must be 100% identical.
- **Strictly Prohibited**: Calling system clocks (`datetime.now()`), random number generators (`random()`, `uuid4()` for deterministic finding keys), or making outbound HTTP requests inside the evaluation loop.

### 3.2 Safe XML Parsing with Line Number Retention (`SafeXmlParser`)
Standard `xml.etree.ElementTree` and default `defusedxml.ElementTree.fromstring` discard line coordinates. In order to satisfy **Cardinal Axiom 2, Point 6** (concrete evidence with exact line and column coordinates) while preventing XXE attacks, engines must use `LineNumberTreeBuilder` and `LineElement`:

```python
# services/analysis-python/src/parsers/safe_xml.py
from xml.etree.ElementTree import Element, TreeBuilder
import defusedxml.ElementTree as DefusedET
from defusedxml.common import DefusedXmlException, EntitiesForbidden, DTDForbidden
from src.core.exceptions import SecurityViolationError


class LineElement(Element):
    """Element subclass storing exact 1-indexed source line and column coordinates."""
    __slots__ = ("sourceline", "sourcecolumn")

    def __init__(self, tag, attrib):
        super().__init__(tag, attrib)
        self.sourceline: int = 1
        self.sourcecolumn: int = 0


class LineNumberTreeBuilder(TreeBuilder):
    """Custom TreeBuilder that captures expat line and column positions during parsing."""
    def __init__(self, *args, **kwargs):
        super().__init__(element_factory=LineElement, *args, **kwargs)
        self.parser = None

    def start(self, tag, attrs):
        elem = super().start(tag, attrs)
        if self.parser:
            elem.sourceline = self.parser.CurrentLineNumber
            elem.sourcecolumn = self.parser.CurrentColumnNumber
            # Also populate XML attributes for backward-compatible elem.get("line_number")
            elem.set("line_number", str(self.parser.CurrentLineNumber))
            elem.set("column_number", str(self.parser.CurrentColumnNumber))
        return elem


class SafeXmlParser:
    """Defused XML parser preventing XXE/DTD attacks while preserving exact line/column positions."""

    @staticmethod
    def parse_string(xml_text: str) -> LineElement:
        builder = LineNumberTreeBuilder()
        parser = DefusedET.DefusedXMLParser(
            target=builder,
            forbid_dtd=True,
            forbid_entities=True,
            forbid_external=True
        )
        builder.parser = parser.parser

        try:
            parser.feed(xml_text)
            return parser.close()
        except (EntitiesForbidden, DTDForbidden) as e:
            raise SecurityViolationError(f"Malicious XML detected (Entities/DTD forbidden): {str(e)}") from e
        except DefusedXmlException as e:
            raise SecurityViolationError(f"XML parse rejected by defusedxml: {str(e)}") from e
        except Exception as e:
            raise ValueError(f"Invalid XML syntax: {str(e)}") from e
```


---

## 4. Provenance & The 4 Confidence Classes

Every finding emitted by an engine must be classified using the canonical 4-tier confidence hierarchy:

| Confidence Class | Numerical Score | Criterion & Source Qualification | Engine Usage Rule |
|---|---|---|---|
| **`VERIFIED`** | `1.0` | Exact AST node match, direct DOM element match, or verified configuration table entry. Cryptographically validated. | Direct parser matches (e.g. SmartForm XML node detected, direct DB table write in ABAP AST). |
| **`RULE_DERIVED`** | `0.85` | Deterministic domain rule evaluation combining multiple verified facts or deterministic logic trees. | Standard preflight rules (e.g. SPRO node missing corresponding CBC activity in target 2408). |
| **`INFERRED`** | `0.60` | Heuristic correlation, statistical pattern match, or secondary AI explanation assistance. | AI Problem Router suggestions or heuristic transport dependency ordering. **LLMs are capped here.** |
| **`UNKNOWN`** | `0.30` | Incomplete customer export, missing mandatory evidence, ambiguous release family, or unverified rule. | Missing evidence or partial artifact exports. Never claim supported/unsupported without evidence. |

### 4.1 Missing Evidence Demotion Rule
If an engine evaluates a rule but cannot point to a verifiable file location (artifact path, line/column offset, code snippet, and SHA-256 hash), the finding's confidence MUST be demoted to `UNKNOWN` with confidence score capped at `0.30`.

---

## 5. Standardized Finding Codes & Taxonomy

Finding codes must follow the strict namespaced syntax:  
`<ENGINE_TYPE>_<CATEGORY>_<SPECIFIC_DEFECT>`

Examples:
- `OPD_DETERMINATION_STEP_MISSING`
- `CLEAN_CORE_TIER3_DIRECT_DB_MUTATION`
- `FORM_DOCTOR_SMARTFORM_OBSOLETE`
- `ECC2CLOUD_SPRO_CBC_EQUIVALENT_ABSENT`
- `API_CHANGE_GUARD_UNRELEASED_C1_CONTRACT`
- `MFS_BLACKBOX_TELEGRAM_SEQUENCE_GAP`

---

## 6. Cryptographic Evidence Schema & Pointer Resolution

Every finding must encapsulate one or more concrete evidence records conforming to `EvidenceItem`:

```python
# services/analysis-python/src/models/evidence.py
from pydantic import BaseModel, Field
from typing import Optional
from src.models.enums import ConfidenceClass

class EvidenceSourceOffset(BaseModel):
    artifact_path: str
    line_start: Optional[int] = None
    line_end: Optional[int] = None
    column_start: Optional[int] = None
    column_end: Optional[int] = None
    byte_offset_start: Optional[int] = None
    byte_offset_end: Optional[int] = None
    selector_type: Optional[str] = None  # "XPATH", "AST_NODE", "LINE_RANGE", "REGEX"
    selector_query: Optional[str] = None
    snippet: str

class EvidenceItem(BaseModel):
    artifact_path: str
    line_number: int
    column_number: int
    snippet: str
    context_before: Optional[str] = None
    context_after: Optional[str] = None
    sha256: str
    provenance: ConfidenceClass
    trust_score: float = Field(ge=0.0, le=1.0)
    source_type: str  # "XML_DOM", "ABAP_AST", "CONFIG_TABLE", "JSON_KV"
    offset: EvidenceSourceOffset
```

---

## 7. Golden Fixtures & Testing Methodology

### 7.1 Mandatory Fixture Triple
Every engine in `services/analysis-python/tests/fixtures/<engine_name>/` must contain at least three curated fixtures:
1. **Positive Fixture (`clean_*`)**: Compliant SAP artifact that produces exactly zero blocker/critical findings.
2. **Negative Fixture (`defect_*`)**: Known non-compliant SAP artifact designed to trigger specific finding codes with expected line numbers.
3. **Edge-Case Fixture (`malformed_*` / `empty_*`)**: Corrupt, truncated, or boundary input to verify that the engine fails closed without crashing.

### 7.2 Automated Pytest Suite Pattern
```python
# services/analysis-python/tests/engines/test_opd_guard.py
import pytest
from src.engines.opd_guard import OpdGuardEngine, OpdRulePayload
from src.models.enums import Severity, ConfidenceClass

@pytest.mark.asyncio
async def test_opd_guard_clean_fixture():
    engine = OpdGuardEngine()
    with open("tests/fixtures/opd_guard/clean_opd_table.xml", "r") as f:
        content = f.read()
    
    findings = await engine.analyze(OpdRulePayload(
        artifact_path="opd/clean_table.xml",
        target_release="S4HC_2408",
        content=content
    ))
    assert len(findings) == 0

@pytest.mark.asyncio
async def test_opd_guard_missing_printer_step():
    engine = OpdGuardEngine()
    with open("tests/fixtures/opd_guard/defect_missing_printer.xml", "r") as f:
        content = f.read()
    
    findings = await engine.analyze(OpdRulePayload(
        artifact_path="opd/defect_table.xml",
        target_release="S4HC_2408",
        content=content
    ))
    assert len(findings) == 1
    finding = findings[0]
    assert finding.rule_id == "OPD_PRINTER_STEP_MISSING"
    assert finding.severity == Severity.CRITICAL
    assert finding.confidence == ConfidenceClass.RULE_DERIVED
    assert finding.confidence_score == 0.85
    assert len(finding.evidence) == 1
    assert finding.evidence[0].sha256 != ""
```

---

## 8. Python Reference Implementation Architecture

```python
# services/analysis-python/src/engines/opd_guard.py
import hashlib
from typing import List
from pydantic import BaseModel
from src.core.base_engine import BaseEngine
from src.models.enums import EngineType, ArtifactType, Severity, ConfidenceClass
from src.models.finding import Finding
from src.models.evidence import EvidenceItem, EvidenceSourceOffset
from src.parsers.safe_xml import SafeXmlParser
from src.platform.confidence import classify_provenance

class OpdRulePayload(BaseModel):
    artifact_path: str
    target_release: str
    content: str

class OpdGuardEngine(BaseEngine):
    engine_type = EngineType.OPD_GUARD
    name = "Output Parameter Determination Guard"
    description = "Audits BRFplus/OPD decision tables and output channels for S/4HANA Cloud migration."
    version = "2.1.0"
    supported_artifact_types = [ArtifactType.XML]

    async def analyze(self, payload: OpdRulePayload) -> List[Finding]:
        findings: List[Finding] = []
        raw_xml = payload.content

        # Step 1: Parse safely using defusedxml
        root = SafeXmlParser.parse_string(raw_xml)

        # Step 2: Deterministic Rule OPD_001 - Check for missing printer determination
        decision_tables = root.findall(".//DecisionTable")
        for table in decision_tables:
            table_name = table.get("name", "UNKNOWN")
            printer_steps = table.findall(".//Step[@type='PRINTER_DETERMINATION']")
            
            if not printer_steps:
                snippet = f'<DecisionTable name="{table_name}">'
                snippet_hash = hashlib.sha256(snippet.encode("utf-8")).hexdigest()
                
                provenance = classify_provenance(
                    is_exact_parser_or_ast_match=True,
                    is_deterministic_rule=True,
                    has_evidence=True
                )

                # Cardinal Axiom 2, Point 6: Extract exact line and column numbers
                # Both table.sourceline and int(table.get("line_number")) are supported
                line_no = getattr(table, "sourceline", int(table.get("line_number", 1)))
                col_no = getattr(table, "sourcecolumn", int(table.get("column_number", 1)))

                evidence = EvidenceItem(
                    artifact_path=payload.artifact_path,
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet,
                    sha256=snippet_hash,
                    provenance=provenance.confidence,
                    trust_score=0.95,
                    source_type="XML_DOM",
                    offset=EvidenceSourceOffset(
                        artifact_path=payload.artifact_path,
                        selector_type="XPATH",
                        selector_query=f".//DecisionTable[@name='{table_name}']",
                        snippet=snippet
                    )
                )

                findings.append(Finding(
                    rule_id="OPD_PRINTER_STEP_MISSING",
                    engine_type=self.engine_type,
                    severity=Severity.CRITICAL,
                    title=f"Missing Printer Determination Step in Decision Table {table_name}",
                    description="BRFplus OPD decision table lacks printer output channel routing required for S/4HANA Cloud.",
                    remediation="Add PRINTER_DETERMINATION step via app Output Parameter Determination or CBC configuration.",
                    confidence=provenance.confidence,
                    confidence_score=provenance.score,
                    affected_objects=[{"name": table_name, "type": "OPD_TABLE", "tier": "TIER_1_CLOUD"}],
                    evidence=[evidence]
                ))

        return findings
```

---

## 9. Non-Negotiable Engine Invariants

1. **Deterministic Rule Primacy**: Never create an engine that is only an LLM prompt. Deterministic rules are primary; AI is strictly for secondary explanation.
2. **AI Confidence Ceiling**: Findings derived with AI involvement can **never** exceed `INFERRED` (`0.60`) confidence.
3. **Missing Evidence Demotion**: Missing mandatory evidence demotes finding confidence to `UNKNOWN` (`0.30`).
4. **Complete Evidence Pointers**: Every finding must contain exact file path, line number, column, snippet, and cryptographic hash.
5. **Bitwise Reproducibility**: Given identical artifact inputs, target release, and knowledge snapshot, engine outputs must be identical.

### 9.1 Strictly Forbidden Competing Libraries & Patterns (Part 21.42 & AGENTS.md §4.2)
Analysis engine authoring requires pure, deterministic evaluation:
- ❌ **AI Frameworks in Analysis Loops**: `langchain`, `llamaindex`, `crewai`, `autogen`, `semantic-kernel` inside core deterministic analysis loops. Analysis engines must be deterministic AST/DOM/rule machines. AI is strictly isolated in AI Problem Router for secondary explanation.
- ❌ **Schema Validation**: `marshmallow`, `voluptuous`, `cerberus` in Python (Standard: `pydantic` v2); `joi`, `yup` in TS (Standard: `zod` 4).
- ❌ **Unsafe XML Parsers**: Standard unsafe `xml.etree.ElementTree` or `minidom` (Standard: `defusedxml` and `lxml.etree` with line number retention).
- ❌ **Database ORMs in Analysis Service**: Direct database ORM access inside `services/analysis-python/src/engines/` (`prisma`, `drizzle-orm`, `sqlalchemy`). Engines must remain 100% stateless pure functions.
- ❌ **Testing Frameworks**: `unittest` legacy suites, `nose` (Standard: `pytest` + `hypothesis` in Python, `vitest` + `fast-check` in TS).

---

## 10. Forbidden Anti-Patterns

- ❌ **Anti-Pattern**: Catching general exceptions (`except Exception:`) and returning an empty list (`[]`) instead of raising or emitting an engine error finding.  
  *Violation*: Silently hides parser bugs and produces false-positive clean migration certificates.  
  *Correction*: Catch specific known errors, log with context, and emit an engine diagnostic finding if unrecoverable.

- ❌ **Anti-Pattern**: Using an LLM to "look at this ABAP file and list all Clean Core violations".  
  *Violation*: Produces hallucinations, unrepeatable results, and misses line-number cryptographic evidence.  
  *Correction*: Parse ABAP into an AST or token stream, apply deterministic rule checks, and attach exact offsets.

- ❌ **Anti-Pattern**: Hardcoding tenant IDs or client company names into rule definitions.  
  *Violation*: Breaks multi-tenant isolation and rule generalizability.  
  *Correction*: Pass all configuration through engine runtime options.
