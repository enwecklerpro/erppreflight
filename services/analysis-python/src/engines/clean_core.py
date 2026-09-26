"""Clean Core Object Guard Engine (spec 07 §7.4 / §7.5).

Static analysis of custom ABAP against SAP Clean Core / ABAP Cloud rules. Rules are evaluated on the
token stream of :mod:`src.parsers.abap_tokenizer` — string literals, templates and comments are
never inspected, statements are split on '.', chained statements (``DATA: a, b.``) are expanded.

Rule families:
* direct database access to SAP standard tables (reads: CRITICAL; INSERT/UPDATE/MODIFY/DELETE: BLOCKER);
* calls to function modules / classes that are not released for cloud development — objects on the
  curated not-released list (with successor) are VERIFIED, objects simply absent from the released list
  are RULE_DERIVED;
* dynamic targets (``FROM (lv_tab)``, ``CALL FUNCTION lv_fm``, ``CALL METHOD (…)``, ``CREATE OBJECT … TYPE
  (…)``, ``SUBMIT (…)``, ``PERFORM (…)``, ``ASSIGN (…)``) — UNKNOWN: the target cannot be verified statically;
* obsolete / cloud-forbidden statements (TABLES, FORM/PERFORM, datasets, EXEC SQL, kernel calls, …).

Inputs: ABAP source (text), an abapGit repository (ZIP of ``*.abap`` files, all nesting/size limits of
SafeZipReader apply), or an object list JSON ``{"objects": [{"name", "type"}]}`` for release-status lookup.
The released-object knowledge is a versioned, immutable data file (``src/knowledge``).
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pydantic import model_validator

from src.core.base_engine import BaseEngine
from src.core.contracts import (
    ContractModel, InputContract, InputFormat, KnowledgeSource, RuleSpec, insufficient, rule_catalog,
)
from src.core.exceptions import EngineInputError
from src.core.registry import register_engine
from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
    TrustLevel,
)
from src.models.finding import Finding
from src.models.request import AnalysisRequest
from src.models.response import AnalysisMetrics, AnalysisResponse
from src.parsers.abap_tokenizer import (
    LITERAL,
    NATIVE,
    PUNCT,
    TEXT_LITERAL,
    WORD,
    AbapLexError,
    Statement,
    Token,
    looks_like_abap,
    parse_statements,
)
from src.parsers.json_input import parse_json_payload
from src.parsers.safe_zip import ArchiveSecurityError, SafeZipReader, is_zip_bytes
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine

# ==============================================================================
# Knowledge snapshot (versioned, immutable data file)
# ==============================================================================

KNOWLEDGE_FILE = Path(__file__).resolve().parent.parent / "knowledge" / "clean_core_released_objects.v2408.1.json"


@dataclass(frozen=True)
class ReleaseKnowledge:
    snapshot_id: str
    released_fms: frozenset
    released_cds: frozenset
    released_classes: frozenset
    not_released_fms: Dict[str, str]
    not_released_classes: Dict[str, str]
    not_released_tables: Dict[str, str]


@lru_cache(maxsize=1)
def load_release_knowledge() -> ReleaseKnowledge:
    data = json.loads(KNOWLEDGE_FILE.read_text(encoding="utf-8"))
    rel = data["released"]
    nrel = data["not_released"]
    return ReleaseKnowledge(
        snapshot_id=data["snapshot_id"],
        released_fms=frozenset(x.upper() for x in rel["function_modules"]),
        released_cds=frozenset(x.upper() for x in rel["cds_views"]),
        released_classes=frozenset(x.upper() for x in rel["classes"]),
        not_released_fms={k.upper(): v for k, v in nrel["function_modules"].items()},
        not_released_classes={k.upper(): v for k, v in nrel["classes"].items()},
        not_released_tables={k.upper(): v for k, v in nrel["tables"].items()},
    )


# SAP-owned namespaces (objects in these namespaces are SAP standard, not customer code).
SAP_NAMESPACES = ("/SCWM/", "/SAPAPO/", "/SAPSLL/", "/BOBF/", "/IWBEP/", "/IWFND/", "/UI2/", "/SAPTRX/", "/SCMB/")
CDS_NAME = re.compile(r"^[ICAPREX]_[A-Z0-9_]+$")

# Obsolete / cloud-forbidden statements: leading word sequence -> (severity, description, remediation)
OBSOLETE_STATEMENTS: Dict[Tuple[str, ...], Tuple[Severity, str, str]] = {
    ("TABLES",): (
        Severity.CRITICAL, "Obsolete TABLES work area sharing global memory with dynpros.",
        "Declare explicit typed data (DATA ls_x TYPE …) or read through released CDS views.",
    ),
    ("FORM",): (
        Severity.CRITICAL, "Obsolete subroutine definition (FORM).",
        "Refactor subroutines into methods of local or global ABAP Cloud classes.",
    ),
    ("PERFORM",): (
        Severity.CRITICAL, "Obsolete subroutine call (PERFORM).",
        "Replace the PERFORM with a method call.",
    ),
    ("OPEN", "DATASET"): (
        Severity.CRITICAL, "Application-server file access (OPEN DATASET).",
        "File system access is forbidden in ABAP Cloud; use a released API / BTP Object Store.",
    ),
    ("READ", "DATASET"): (
        Severity.CRITICAL, "Application-server file read (READ DATASET).",
        "File system access is forbidden in ABAP Cloud; use a released API / BTP Object Store.",
    ),
    ("TRANSFER",): (
        Severity.CRITICAL, "Application-server file write (TRANSFER).",
        "File system access is forbidden in ABAP Cloud; use a released API / BTP Object Store.",
    ),
    ("CLOSE", "DATASET"): (
        Severity.CRITICAL, "Application-server file handle (CLOSE DATASET).",
        "Remove file handling; not available in ABAP Cloud.",
    ),
    ("DELETE", "DATASET"): (
        Severity.CRITICAL, "Application-server file deletion (DELETE DATASET).",
        "Remove file handling; not available in ABAP Cloud.",
    ),
    ("EXEC", "SQL"): (
        Severity.BLOCKER, "Native SQL (EXEC SQL) bypassing the ABAP SQL layer.",
        "Rewrite with ABAP SQL on released CDS views; native SQL is not permitted in ABAP Cloud.",
    ),
    ("CALL", "TRANSACTION"): (
        Severity.CRITICAL, "Dynpro transaction call / batch input (CALL TRANSACTION).",
        "Use released OData APIs or RAP business objects instead of dynpro transactions.",
    ),
    ("LEAVE", "TO", "TRANSACTION"): (
        Severity.CRITICAL, "Dynpro transaction navigation (LEAVE TO TRANSACTION).",
        "Navigate with Fiori intent-based navigation instead.",
    ),
    ("CALL", "SCREEN"): (
        Severity.CRITICAL, "Classic dynpro screen (CALL SCREEN).",
        "Classic dynpros are not available in ABAP Cloud; build a Fiori Elements UI on RAP.",
    ),
    ("CALL", "DIALOG"): (
        Severity.CRITICAL, "Obsolete dialog module call (CALL DIALOG).",
        "Replace with a Fiori UI on RAP.",
    ),
    ("SUBMIT",): (
        Severity.MAJOR, "Classic report execution (SUBMIT).",
        "Move report logic into an ABAP Cloud class and schedule it as an Application Job (CL_APJ_RT_API).",
    ),
}

# ==============================================================================
# Rule catalog + input contract (Axiom 2 #2, #5, #14)
# ==============================================================================

RULES = rule_catalog(
    RuleSpec(
        "CLEAN_CORE_DIRECT_DB_ACCESS", "Direct read of an SAP standard table", Severity.CRITICAL,
        "Replace the SELECT on the standard table with the released (C1) CDS view named as successor (e.g. "
        "MARA -> I_Product); if none is released, request one via the Customer Influence portal or read via a "
        "released API.", "MIGRATION_CLEAN_CORE",
    ),
    RuleSpec(
        "CLEAN_CORE_DIRECT_DB_MUTATION", "Direct write to an SAP standard table", Severity.BLOCKER,
        "Never INSERT/UPDATE/MODIFY/DELETE SAP tables: use the released RAP business object (EML "
        "MODIFY ENTITIES) or released API of the owning application; direct writes bypass validations and are "
        "blocked in ABAP Cloud.", "MIGRATION_CLEAN_CORE",
    ),
    RuleSpec(
        "CLEAN_CORE_UNRELEASED_API", "Call to a function module not released for cloud development",
        Severity.CRITICAL,
        "Replace the call with the released successor named in the finding (Cloudification Repository). "
        "Function modules absent from the released list must be treated as unreleased until SAP releases them.",
        "MIGRATION_CLEAN_CORE",
    ),
    RuleSpec(
        "CLEAN_CORE_UNRELEASED_CLASS", "Use of a class not released for cloud development", Severity.CRITICAL,
        "Replace the class with the released successor (e.g. CL_BCS -> CL_BCS_MAIL_MESSAGE); SAP GUI / ALV "
        "classes have no ABAP Cloud equivalent and require a Fiori UI.", "MIGRATION_CLEAN_CORE",
    ),
    RuleSpec(
        "CLEAN_CORE_UNRELEASED_OBJECT", "Reference to an object not in the released-object snapshot",
        Severity.MAJOR,
        "Verify the object's release state in ADT (Properties > API State) or the Cloudification Repository; "
        "use the released successor or a custom CDS view on released views.", "MIGRATION_CLEAN_CORE",
    ),
    RuleSpec(
        "CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE", "Dynamic call target cannot be verified", Severity.MAJOR,
        "Dynamic targets (FROM (lv_tab), CALL FUNCTION lv_fm, CALL METHOD (…)) cannot be checked statically. "
        "Replace them with static calls, or restrict the possible values to released objects and document the "
        "allow-list; ABAP Cloud checks dynamic targets only at runtime.", "MIGRATION_CLEAN_CORE",
    ),
    RuleSpec(
        "CLEAN_CORE_OBSOLETE_SYNTAX", "Obsolete or cloud-forbidden ABAP statement", Severity.CRITICAL,
        "Refactor the statement as described in the finding; it is not part of the ABAP Cloud language version.",
        "MIGRATION_CLEAN_CORE",
    ),
    RuleSpec(
        "CLEAN_CORE_OBJECT_RELEASED", "Object is released for cloud development", Severity.INFO,
        "No action: the object is released (C1) in the knowledge snapshot used for this analysis.",
        "MIGRATION_CLEAN_CORE",
    ),
)


class CleanCoreObjectList(ContractModel):
    """Object-list input: {'objects': [{'name': 'MARA', 'type': 'TABL'|'FUNC'|'CLAS'|'DDLS'}]}."""
    objects: Optional[List[Dict[str, Any]]] = None
    name: Optional[str] = None
    type: Optional[str] = None

    @model_validator(mode="after")
    def _require_objects(self) -> "CleanCoreObjectList":
        rows = self.objects or ([{"name": self.name}] if self.name else [])
        if any(isinstance(r, dict) and str(r.get("name") or r.get("object_name") or "").strip() for r in rows):
            return self
        raise insufficient("No objects supplied: provide 'objects': [{'name': …, 'type': …}] or ABAP source.")


def _clean_core_text_check(text: str) -> Optional[str]:
    return looks_like_abap(text)


INPUT_CONTRACT = InputContract(
    formats=(InputFormat.ABAP, InputFormat.ZIP, InputFormat.JSON),
    summary=(
        "Custom ABAP source (report, class, function group include), an abapGit repository ZIP containing "
        "*.abap files, or an object list JSON {'objects': [{'name', 'type': TABL|FUNC|CLAS|DDLS}]} for "
        "release-status lookup."
    ),
    required=("ABAP source with at least one statement, an abapGit ZIP, or an object list",),
    json_model=CleanCoreObjectList,
    json_array_field="objects",
    text_check=_clean_core_text_check,
    notes=("Released-object knowledge snapshot: clean-core-released-objects/2408.1",),
)

# ==============================================================================
# Static analysis on tokens
# ==============================================================================


@dataclass
class RawFinding:
    code: str
    severity: Severity
    confidence: ConfidenceClass
    token: Token
    statement: Statement
    title: str
    description: str
    remediation: str
    affected: List[str]
    details: Dict[str, Any] = field(default_factory=dict)


def _is_customer(name: str) -> bool:
    n = name.upper()
    if n.startswith("/"):
        return not n.startswith(SAP_NAMESPACES)
    return n.startswith(("Z", "Y"))


def _literal_value(tok: Token) -> str:
    v = tok.value
    if len(v) >= 2 and v[0] in "'`" and v[-1] == v[0]:
        return v[1:-1].replace(v[0] * 2, v[0])
    return v.strip("'`")


def _dynamic_target_at(tokens: List[Token], idx: int) -> bool:
    """True for the dynamic operand pattern ``( name )`` starting at idx."""
    return (
        idx + 2 < len(tokens)
        and tokens[idx].is_punct("(")
        and tokens[idx + 1].kind in (WORD, LITERAL, TEXT_LITERAL)
        and tokens[idx + 2].is_punct(")")
    )


class AbapCleanCoreAnalyzer:
    """Evaluates Clean Core rules over tokenized ABAP statements."""

    def __init__(self, knowledge: ReleaseKnowledge):
        self.k = knowledge
        self.rules_evaluated = 0
        self.inventory: Dict[str, set] = {
            "tables": set(), "cds_views": set(), "function_modules": set(), "classes": set(), "dynamic": set(),
        }

    # ---------------------------------------------------------------- helpers
    def _dyn(self, stmt: Statement, tok: Token, what: str, out: List[RawFinding]) -> None:
        self.inventory["dynamic"].add(what)
        out.append(RawFinding(
            "CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE", Severity.MAJOR, ConfidenceClass.UNKNOWN, tok, stmt,
            f"Dynamic {what} cannot be verified",
            f"The {what} target is only known at runtime ('{stmt.text()[:160]}'); static analysis cannot "
            "determine whether it is a released object. This is reported as UNKNOWN, not as compliant.",
            RULES["CLEAN_CORE_DYNAMIC_CALL_UNVERIFIABLE"].remediation,
            [], {"dynamicKind": what},
        ))

    def _db_target(self, stmt: Statement, tok: Token, mutation: bool, out: List[RawFinding]) -> None:
        name = tok.value.split("~")[0]
        n = name.upper()
        if not n or _is_customer(n) or n.startswith("@"):
            return
        if n in self.k.released_cds:
            self.inventory["cds_views"].add(n)
            return
        if CDS_NAME.match(n) and not mutation:
            self.inventory["cds_views"].add(n)
            out.append(RawFinding(
                "CLEAN_CORE_UNRELEASED_OBJECT", Severity.MAJOR, ConfidenceClass.RULE_DERIVED, tok, stmt,
                f"CDS view {n} is not in the released-object snapshot",
                f"'{n}' is read by ABAP SQL but is not listed as released (C1) in snapshot "
                f"{self.k.snapshot_id}; unreleased CDS views may change incompatibly.",
                RULES["CLEAN_CORE_UNRELEASED_OBJECT"].remediation, [n],
                {"object": n, "objectType": "DDLS", "releaseStatus": "NOT_IN_RELEASED_LIST"},
            ))
            return
        self.inventory["tables"].add(n)
        successor = self.k.not_released_tables.get(n)
        if mutation:
            op = stmt.keyword
            out.append(RawFinding(
                "CLEAN_CORE_DIRECT_DB_MUTATION", Severity.BLOCKER, ConfidenceClass.VERIFIED, tok, stmt,
                f"Direct {op} on SAP standard table {n}",
                f"Statement {op} writes directly to SAP table {n}. Direct writes to SAP-owned tables bypass "
                "business logic and are forbidden under Clean Core / ABAP Cloud.",
                RULES["CLEAN_CORE_DIRECT_DB_MUTATION"].remediation
                + (f" Owning business object / successor view: {successor}." if successor else ""),
                [n], {"table": n, "operation": op, "successor": successor},
            ))
        else:
            out.append(RawFinding(
                "CLEAN_CORE_DIRECT_DB_ACCESS", Severity.CRITICAL, ConfidenceClass.VERIFIED, tok, stmt,
                f"Direct Database Access to Classic Table {n}",
                f"SELECT reads SAP table {n} directly. Classic tables must not be accessed in ABAP Cloud; "
                "read the released CDS view instead.",
                (f"Replace direct access to table {n} with released CDS view {successor} (Contract C1)."
                 if successor else RULES["CLEAN_CORE_DIRECT_DB_ACCESS"].remediation),
                [n], {"table": n, "successor": successor},
            ))

    def _fm(self, stmt: Statement, tok: Token, out: List[RawFinding]) -> None:
        fm = _literal_value(tok).upper().strip()
        if not fm:
            return
        self.inventory["function_modules"].add(fm)
        if _is_customer(fm) or fm in self.k.released_fms:
            return
        successor = self.k.not_released_fms.get(fm)
        if successor is not None:
            out.append(RawFinding(
                "CLEAN_CORE_UNRELEASED_API", Severity.CRITICAL, ConfidenceClass.VERIFIED, tok, stmt,
                f"Call to Unreleased Function Module: {fm}",
                f"Function module '{fm}' is classified as not released for cloud development in snapshot "
                f"{self.k.snapshot_id}.",
                f"Migrate function module call '{fm}' to official cloud successor: {successor}.",
                [fm], {"function_module": fm, "releaseStatus": "NOT_RELEASED", "successor": successor},
            ))
        else:
            out.append(RawFinding(
                "CLEAN_CORE_UNRELEASED_API", Severity.CRITICAL, ConfidenceClass.RULE_DERIVED, tok, stmt,
                f"Call to Unreleased Function Module: {fm}",
                f"Function module '{fm}' is not on the released-API list of snapshot {self.k.snapshot_id}; "
                "it is treated as unreleased.",
                RULES["CLEAN_CORE_UNRELEASED_API"].remediation,
                [fm], {"function_module": fm, "releaseStatus": "NOT_IN_RELEASED_LIST"},
            ))

    def _class(self, stmt: Statement, tok: Token, cls_name: str, out: List[RawFinding]) -> None:
        c = cls_name.upper()
        if not c or _is_customer(c) or c.startswith(("LCL_", "LIF_", "LCX_", "ME", "SUPER")):
            return
        self.inventory["classes"].add(c)
        successor = self.k.not_released_classes.get(c)
        if successor is not None:
            out.append(RawFinding(
                "CLEAN_CORE_UNRELEASED_CLASS", Severity.CRITICAL, ConfidenceClass.VERIFIED, tok, stmt,
                f"Use of unreleased class {c}",
                f"Class '{c}' is not released for cloud development (snapshot {self.k.snapshot_id}).",
                f"Replace '{c}' with: {successor}.", [c],
                {"class": c, "releaseStatus": "NOT_RELEASED", "successor": successor},
            ))

    # ------------------------------------------------------------- statements
    def analyze_statement(self, stmt: Statement) -> List[RawFinding]:
        out: List[RawFinding] = []
        toks = stmt.tokens
        if not toks or toks[0].kind != WORD:
            return out
        words = [t.upper if t.kind == WORD else None for t in toks]
        kw = words[0]
        self.rules_evaluated += 6

        # Obsolete statements (leading word sequence)
        for seq, (sev, desc, rem) in OBSOLETE_STATEMENTS.items():
            if tuple(words[: len(seq)]) == seq:
                out.append(RawFinding(
                    "CLEAN_CORE_OBSOLETE_SYNTAX", sev, ConfidenceClass.VERIFIED, toks[0], stmt,
                    f"Obsolete ABAP Syntax Statement: {' '.join(seq)}",
                    f"{desc} Statement: '{stmt.text()[:160]}'.", rem, [" ".join(seq)],
                    {"statement": " ".join(seq)},
                ))
                break

        # Kernel C call: CALL 'SYSTEM' / CALL 'cfunc'
        if kw == "CALL" and len(toks) > 1 and toks[1].kind in (LITERAL, TEXT_LITERAL):
            target = _literal_value(toks[1]).upper()
            out.append(RawFinding(
                "CLEAN_CORE_OBSOLETE_SYNTAX", Severity.BLOCKER, ConfidenceClass.VERIFIED, toks[0], stmt,
                f"Obsolete ABAP Syntax Statement: CALL '{target}'",
                f"Kernel C-function call CALL '{target}'" + (" executes operating system commands." if target == "SYSTEM" else "."),
                "Remove the kernel call; operating-system and kernel access are blocked in ABAP Cloud.",
                [f"CALL '{target}'"], {"statement": f"CALL '{target}'"},
            ))

        # Function modules
        if kw == "CALL" and len(toks) > 2 and words[1] == "FUNCTION":
            t2 = toks[2]
            if t2.kind in (LITERAL, TEXT_LITERAL):
                self._fm(stmt, t2, out)
            else:
                self._dyn(stmt, t2, "function module call", out)

        # Methods / classes
        if kw == "CALL" and len(toks) > 2 and words[1] == "METHOD":
            t2 = toks[2]
            if t2.is_punct("(") or (t2.kind == WORD and t2.value.endswith(("->", "=>"))):
                self._dyn(stmt, t2, "method call", out)
            elif t2.kind == WORD and "=>" in t2.value:
                self._class(stmt, t2, t2.value.split("=>")[0], out)
        if kw == "CREATE" and len(toks) > 1 and words[1] == "OBJECT":
            for k in range(2, len(toks) - 1):
                if words[k] == "TYPE":
                    if toks[k + 1].is_punct("("):
                        self._dyn(stmt, toks[k + 1], "object creation (CREATE OBJECT … TYPE (…))", out)
                    elif toks[k + 1].kind == WORD:
                        self._class(stmt, toks[k + 1], toks[k + 1].value, out)
                    break
        for k, t in enumerate(toks):
            if t.kind == WORD and "=>" in t.value and not t.value.startswith("=>"):
                cls_name = t.value.split("=>")[0]
                if cls_name and kw != "CALL":
                    self._class(stmt, t, cls_name, out)
            if t.kind == WORD and t.upper == "NEW" and k + 1 < len(toks) and toks[k + 1].kind == WORD:
                self._class(stmt, toks[k + 1], toks[k + 1].value, out)
            if (t.kind == WORD and t.upper == "REF" and k + 2 < len(toks) and words[k + 1] == "TO"
                    and toks[k + 2].kind == WORD):
                self._class(stmt, toks[k + 2], toks[k + 2].value, out)

        # Other dynamic targets
        if kw in ("SUBMIT", "PERFORM") and _dynamic_target_at(toks, 1):
            self._dyn(stmt, toks[1], "program call" if kw == "SUBMIT" else "subroutine call", out)
        if kw == "ASSIGN" and _dynamic_target_at(toks, 1):
            self._dyn(stmt, toks[1], "data object assignment (ASSIGN (…))", out)

        # Database access
        if "SELECT" in words:
            self._select_targets(stmt, words, out)
        if kw in ("INSERT", "UPDATE", "MODIFY", "DELETE"):
            self._write_target(stmt, words, out)
        return out

    def _select_targets(self, stmt: Statement, words: List[Optional[str]], out: List[RawFinding]) -> None:
        toks = stmt.tokens
        for k, w in enumerate(words):
            if w not in ("FROM", "JOIN") or k + 1 >= len(toks):
                continue
            nxt = toks[k + 1]
            if nxt.is_punct("@"):
                continue  # FROM @itab (internal table as source)
            if nxt.is_punct("("):
                if _dynamic_target_at(toks, k + 1):
                    self._dyn(stmt, toks[k + 2], "table name in ABAP SQL (FROM (…))", out)
                    continue
                # parenthesised join: FROM ( mara INNER JOIN … )
                if k + 2 < len(toks) and toks[k + 2].kind == WORD:
                    self._db_target(stmt, toks[k + 2], False, out)
                continue
            if nxt.kind == WORD and nxt.upper not in ("TABLE",):
                self._db_target(stmt, nxt, False, out)

    def _write_target(self, stmt: Statement, words: List[Optional[str]], out: List[RawFinding]) -> None:
        toks = stmt.tokens
        kw = words[0]
        n = len(toks)
        target_idx: Optional[int] = None
        if kw == "INSERT":
            # INSERT INTO dbtab VALUES wa | INSERT dbtab FROM wa  (INSERT … INTO TABLE itab is internal)
            if n > 2 and words[1] == "INTO" and words[2] != "TABLE":
                target_idx = 2
            elif n > 2 and words[2] == "FROM" and words[1] not in ("LINES",):
                target_idx = 1
            elif n > 1 and _dynamic_target_at(toks, 1):
                target_idx = 1
        elif kw == "UPDATE":
            target_idx = 1 if n > 1 else None
        elif kw == "MODIFY":
            if n > 1 and words[1] not in ("TABLE", "SCREEN", "LINE", "CURRENT", "ENTITY", "ENTITIES"):
                if "INDEX" not in words and "TRANSPORTING" not in words:
                    target_idx = 1
        elif kw == "DELETE":
            if n > 2 and words[1] == "FROM" and not toks[2].is_punct("@"):
                target_idx = 2
            elif n > 2 and words[2] == "FROM" and words[1] not in ("TABLE", "ADJACENT", "DATASET"):
                if "INDEX" not in words:
                    target_idx = 1
        if target_idx is None or target_idx >= n:
            return
        tok = toks[target_idx]
        if tok.is_punct("("):
            if _dynamic_target_at(toks, target_idx):
                self._dyn(stmt, toks[target_idx + 1], f"table name in {kw}", out)
            return
        if tok.kind != WORD:
            return
        name = tok.upper
        # Internal tables / work areas / field symbols are not database tables.
        if name.startswith(("<", "LT_", "GT_", "MT_", "IT_", "ET_", "CT_", "RT_", "LS_", "GS_", "LV_", "ME->")):
            return
        if "-" in name or "->" in name:
            return
        self._db_target(stmt, tok, True, out)


def analyze_abap_source(source: str, knowledge: ReleaseKnowledge) -> Tuple[List[RawFinding], Dict[str, Any], int]:
    statements, lex = parse_statements(source)
    analyzer = AbapCleanCoreAnalyzer(knowledge)
    findings: List[RawFinding] = []
    violating = 0
    total = 0
    seen: set = set()
    for stmt in statements:
        if not stmt.tokens or stmt.tokens[0].kind == NATIVE:
            continue
        total += 1
        fs = analyzer.analyze_statement(stmt)
        # Chained statements share their prefix token: report each (rule, position, object) once.
        fs = [
            f for f in fs
            if (key := (f.code, f.token.line, f.token.col, tuple(f.affected))) not in seen and not seen.add(key)
        ]
        if fs:
            violating += 1
            findings.extend(fs)
    stats = {
        "total_statements": total,
        "violating_statements": violating,
        "clean_statements": total - violating,
        "lexical_warnings": [{"line": ln, "column": col, "message": msg} for ln, col, msg in lex.errors[:20]],
        "inventory": {k: sorted(v) for k, v in analyzer.inventory.items()},
    }
    return findings, stats, analyzer.rules_evaluated


# ==============================================================================
# Engine
# ==============================================================================


@register_engine
class CleanCoreEngine(BaseEngine):
    """Engine analyzing custom ABAP code against SAP Clean Core principles."""

    engine_type = EngineType.CLEAN_CORE_OBJECT_GUARD
    rule_prefix = "CLEAN_CORE"
    finding_codes = RULES
    input_contract = INPUT_CONTRACT
    knowledge_sources = (
        KnowledgeSource(
            name="Released / not-released object snapshot",
            location="src/knowledge/clean_core_released_objects.v2408.1.json",
            source="Curated subset of the SAP Cloudification Repository (github.com/SAP/abap-atc-cr-cv-s4hc)",
            release="S4HANA_CLOUD_2408",
            verification_status="CURATED_UNVERIFIED",
        ),
    )
    accepts_binary_input = True
    name = "Clean Core Object Guard"
    description = "Token-based ABAP Cloud / Clean Core static analysis and released-object classification"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.ABAP, ArtifactType.ZIP, ArtifactType.TXT, ArtifactType.JSON]

    def engine_health_checks(self):
        k = load_release_knowledge()
        return [(
            "knowledge_snapshot_loaded",
            bool(k.released_cds and k.not_released_tables),
            f"{k.snapshot_id}: {len(k.released_fms) + len(k.released_cds) + len(k.released_classes)} released, "
            f"{len(k.not_released_fms) + len(k.not_released_classes) + len(k.not_released_tables)} not released",
        )]

    @classmethod
    def evaluate(cls, abap_code: str) -> Dict[str, Any]:
        """Deterministic helper returning plain findings (used by harnesses)."""
        raw, stats, _ = analyze_abap_source(abap_code, load_release_knowledge())
        total = stats["total_statements"]
        return {
            "status": "COMPLETED" if total else "FAILED",
            "total_statements": total,
            "clean_statements": stats["clean_statements"],
            "violations_count": len(raw),
            "compliance_percentage": round(stats["clean_statements"] / total * 100, 1) if total else None,
            "findings": [
                {
                    "code": f.code, "severity": f.severity.value, "line": f.token.line, "column": f.token.col,
                    "confidence": f.confidence.value, "statement": f.statement.text(), **f.details,
                }
                for f in raw
            ],
        }

    # ------------------------------------------------------------------ input
    def _collect_sources(self, request: AnalysisRequest) -> Tuple[List[Tuple[str, str]], Optional[Tuple[str, Any]]]:
        """Returns ([(artifact_path, abap_text)], object_list) from raw_content / artifacts / ZIP."""
        prefix = self.rule_prefix
        sources: List[Tuple[str, str]] = []
        object_list: Optional[Tuple[str, Any]] = None
        payloads: List[Tuple[str, Optional[str], Optional[bytes]]] = []
        if request.get_raw_bytes():
            payloads.append((request.artifact_s3_key or "abap/custom_source.abap", request.raw_content,
                             request.get_raw_bytes()))
        for art in request.artifacts:
            if art.get_raw_bytes():
                payloads.append((art.file_name, art.raw_content, art.get_raw_bytes()))
        for path, text, data in payloads:
            if text is None or (data and is_zip_bytes(data)):
                if not data or not is_zip_bytes(data):
                    raise EngineInputError(f"{prefix}_INVALID_INPUT", f"{path}: binary payload is not a ZIP archive.")
                try:
                    with SafeZipReader(data) as zf:
                        for member, content in zf.walk():
                            if member.lower().endswith(".abap"):
                                try:
                                    sources.append((f"{path}!/{member}", content.decode("utf-8")))
                                except UnicodeDecodeError:
                                    raise EngineInputError(
                                        f"{prefix}_INVALID_INPUT", f"{path}!/{member}: ABAP file is not UTF-8."
                                    ) from None
                except ArchiveSecurityError as exc:
                    raise EngineInputError(f"{prefix}_ARCHIVE_REJECTED", f"{path}: {exc}") from None
                continue
            stripped = text.lstrip()
            if not stripped:
                continue
            if stripped[:1] in ("{", "["):
                object_list = (path, parse_json_payload(text, prefix))
                continue
            sources.append((path, text))
        return sources, object_list

    # ----------------------------------------------------------------- engine
    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        knowledge = load_release_knowledge()
        prefix = self.rule_prefix
        sources, object_list = self._collect_sources(request)
        if not sources and object_list is None:
            raise EngineInputError(
                f"{prefix}_INSUFFICIENT_INPUT",
                "No ABAP source, abapGit archive (*.abap members) or object list was supplied.",
            )

        findings: List[Finding] = []
        rules_evaluated = 0
        totals = {"total_statements": 0, "clean_statements": 0, "violating_statements": 0}
        inventory: Dict[str, set] = {}
        lexical: List[Dict[str, Any]] = []

        skipped: List[str] = []
        for path, text in sources:
            problem = looks_like_abap(text)
            if problem is not None:
                if len(sources) == 1 and object_list is None:
                    raise EngineInputError(f"{prefix}_INVALID_INPUT", f"{path}: {problem}")
                skipped.append(path)
                continue
            try:
                raw, stats, n_rules = analyze_abap_source(text, knowledge)
            except AbapLexError as exc:
                raise EngineInputError(f"{prefix}_PARSE_ERROR", f"{path}: {exc}") from None
            rules_evaluated += n_rules
            for key in totals:
                totals[key] += stats[key]
            for key, values in stats["inventory"].items():
                inventory.setdefault(key, set()).update(values)
            lexical.extend({"artifact": path, **w} for w in stats["lexical_warnings"])
            artifact_sha = EvidenceEngine.compute_sha256(text)
            lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
            for rf in raw:
                findings.append(self._to_finding(rf, path, artifact_sha, lines, knowledge))

        if object_list is not None:
            obj_findings, n_rules = self._evaluate_object_list(object_list[0], object_list[1], request, knowledge)
            findings.extend(obj_findings)
            rules_evaluated += n_rules

        if sources and totals["total_statements"] == 0 and object_list is None:
            raise EngineInputError(
                f"{prefix}_INSUFFICIENT_INPUT",
                "The ABAP source contains no statements (only comments / whitespace); no compliance verdict.",
            )

        # Deterministic order: artifact, line, column, code
        findings.sort(key=lambda f: (
            f.evidence[0].artifact_path if f.evidence else "",
            f.evidence[0].line_number or 0 if f.evidence else 0,
            f.evidence[0].column_number or 0 if f.evidence else 0,
            f.rule_id,
        ))
        total = totals["total_statements"]
        unknown = sum(1 for f in findings if f.confidence == ConfidenceClass.UNKNOWN)
        compliance = round(totals["clean_statements"] / total * 100, 1) if total else None
        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=AnalysisMetrics(
                execution_time_ms=int((time.perf_counter() - start_time) * 1000),
                rules_evaluated=max(rules_evaluated, 1),
                artifacts_scanned=max(len(sources), 1),
                additional_metrics={
                    "total_statements": total,
                    "clean_statements": totals["clean_statements"],
                    "violations_count": len(findings),
                    "violating_statements": totals["violating_statements"],
                    "unverifiable_dynamic_calls": unknown,
                    # Compliance is only claimed when no dynamic target remains unverified.
                    "compliance_percentage": compliance,
                    "compliance_verifiable": unknown == 0,
                    "inventory": {k: sorted(v) for k, v in sorted(inventory.items())},
                    "lexical_warnings": lexical[:20],
                    "skipped_non_abap_artifacts": skipped,
                    "knowledgeSnapshot": knowledge.snapshot_id,
                    "analysisMethod": "abap-token-stream",
                    "engine": "clean_core_object_guard",
                },
            ),
        )

    def _to_finding(
        self, rf: RawFinding, path: str, artifact_sha: str, lines: List[str], knowledge: ReleaseKnowledge
    ) -> Finding:
        line_text = lines[rf.token.line - 1] if 0 < rf.token.line <= len(lines) else rf.statement.text()
        evidence = EvidenceEngine.create_evidence(
            artifact_path=path,
            content=b"",
            line_number=rf.token.line,
            column_number=rf.token.col,
            snippet=line_text.strip()[:500],
            provenance=rf.confidence if rf.confidence != ConfidenceClass.UNKNOWN else ConfidenceClass.RULE_DERIVED,
            source_type=TrustLevel.CUSTOMER_EVIDENCE,
        )
        evidence.sha256 = artifact_sha  # artifact-level SHA-256 (Axiom 2 #6)
        finding = Finding(
            rule_id=rf.code,
            severity=rf.severity,
            category="MIGRATION_CLEAN_CORE",
            title=rf.title,
            description=rf.description,
            confidence=rf.confidence,
            confidence_score={
                ConfidenceClass.VERIFIED: 1.0, ConfidenceClass.RULE_DERIVED: 0.85,
                ConfidenceClass.INFERRED: 0.60, ConfidenceClass.UNKNOWN: 0.30,
            }[rf.confidence],
            remediation=rf.remediation,
            evidence=[evidence],
            technical_details={
                "code": rf.code,
                "line": rf.token.line,
                "column": rf.token.col,
                "token": rf.token.value,
                "statement": rf.statement.text()[:500],
                "knowledgeSnapshot": knowledge.snapshot_id,
                **{k: v for k, v in rf.details.items() if v is not None},
            },
            affected_objects=rf.affected,
        )
        return ConfidenceClassifier.classify(finding)

    def _evaluate_object_list(
        self, path: str, data: Any, request: AnalysisRequest, knowledge: ReleaseKnowledge
    ) -> Tuple[List[Finding], int]:
        prefix = self.rule_prefix
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            rows = data.get("objects") or ([data] if data.get("name") else [])
        else:
            rows = []
        rows = [r for r in rows if isinstance(r, dict) and str(r.get("name") or r.get("object_name") or "").strip()]
        if not rows:
            raise EngineInputError(f"{prefix}_INSUFFICIENT_INPUT", "The object list contains no named objects.")
        raw_text = request.raw_content or ""
        for art in request.artifacts:
            if art.file_name == path and art.raw_content:
                raw_text = art.raw_content
        text_lines = raw_text.splitlines()
        artifact_sha = EvidenceEngine.compute_sha256(raw_text)
        out: List[Finding] = []
        for row in rows:
            name = str(row.get("name") or row.get("object_name")).strip().upper()
            otype = str(row.get("type") or row.get("object_type") or "").strip().upper()
            line_no, col_no = 1, 1
            for i, ln in enumerate(text_lines, 1):
                pos = ln.upper().find(f'"{name}"')
                if pos != -1:
                    line_no, col_no = i, pos + 2
                    break
            snippet = text_lines[line_no - 1].strip() if 0 < line_no <= len(text_lines) else name
            if _is_customer(name):
                continue
            code, sev, conf, title, rem, details = self._classify_object(name, otype, knowledge)
            ev = EvidenceEngine.create_evidence(
                artifact_path=path, content=b"", line_number=line_no, column_number=col_no, snippet=snippet,
                provenance=conf, source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            ev.sha256 = artifact_sha
            out.append(ConfidenceClassifier.classify(Finding(
                rule_id=code, severity=sev, category="MIGRATION_CLEAN_CORE", title=title,
                description=f"{title} (knowledge snapshot {knowledge.snapshot_id}).",
                confidence=conf, confidence_score=1.0 if conf == ConfidenceClass.VERIFIED else 0.85,
                remediation=rem, evidence=[ev],
                technical_details={"object": name, "objectType": otype or "UNSPECIFIED",
                                   "knowledgeSnapshot": knowledge.snapshot_id, **details},
                affected_objects=[name],
            )))
        return out, len(rows) * 3

    @staticmethod
    def _classify_object(name: str, otype: str, k: ReleaseKnowledge):
        released = (
            (otype in ("FUNC", "FM", "") and name in k.released_fms)
            or (otype in ("CLAS", "CLASS", "") and name in k.released_classes)
            or (otype in ("DDLS", "CDS", "VIEW", "") and name in k.released_cds)
        )
        if released:
            return ("CLEAN_CORE_OBJECT_RELEASED", Severity.INFO, ConfidenceClass.VERIFIED,
                    f"{name} is released for cloud development", RULES["CLEAN_CORE_OBJECT_RELEASED"].remediation,
                    {"releaseStatus": "RELEASED"})
        if name in k.not_released_fms:
            succ = k.not_released_fms[name]
            return ("CLEAN_CORE_UNRELEASED_API", Severity.CRITICAL, ConfidenceClass.VERIFIED,
                    f"Function module {name} is not released", f"Use the successor: {succ}.",
                    {"releaseStatus": "NOT_RELEASED", "successor": succ})
        if name in k.not_released_classes:
            succ = k.not_released_classes[name]
            return ("CLEAN_CORE_UNRELEASED_CLASS", Severity.CRITICAL, ConfidenceClass.VERIFIED,
                    f"Class {name} is not released", f"Use the successor: {succ}.",
                    {"releaseStatus": "NOT_RELEASED", "successor": succ})
        if name in k.not_released_tables:
            succ = k.not_released_tables[name]
            return ("CLEAN_CORE_UNRELEASED_OBJECT", Severity.CRITICAL, ConfidenceClass.VERIFIED,
                    f"Table {name} is not released for direct access",
                    f"Read the released CDS view {succ} instead.",
                    {"releaseStatus": "NOT_RELEASED", "successor": succ})
        return ("CLEAN_CORE_UNRELEASED_OBJECT", Severity.MAJOR, ConfidenceClass.RULE_DERIVED,
                f"{name} is not in the released-object snapshot",
                RULES["CLEAN_CORE_UNRELEASED_OBJECT"].remediation, {"releaseStatus": "NOT_IN_RELEASED_LIST"})
