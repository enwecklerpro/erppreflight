"""
ERP Preflight — Basic form/XML field checker (public free tool, Part 01 §1.11).

Deterministic answer to "does this field path exist in my form data / XML file,
what is its value and are there namespace problems?" for a pasted XML document.

Security & privacy
  * Parsing uses defusedxml with DTDs, entity declarations and external
    references forbidden (no XXE, no billion laughs) and bounded nesting depth.
  * The document is processed in memory only: nothing is stored or logged.
  * Size, depth, element-count and result limits keep the request bounded.

Path language (a small, documented XPath subset)
  /root/child/grandchild      absolute path from the document element
  //child                      any element named ``child`` at any depth
  /root/item[2]                2nd ``item`` child among matching siblings (1-based)
  /root/*/value                any element name for one step
  /ns:root/ns:child            prefixed steps; prefixes resolve through the caller's
                               namespace map first, then the document's declarations
  /root/item/@id               attribute of the matched element(s)

An unprefixed step matches by local name in any namespace (like ``local-name()``)
and the result reports when the matched element is namespaced, because that is
the most common reason why form bindings or XPath expressions in SAP Adobe
Forms / interfaces do not resolve.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from xml.etree.ElementTree import Element, TreeBuilder
from xml.parsers.expat import ExpatError

import defusedxml.ElementTree as DefusedET
from defusedxml.common import DefusedXmlException, DTDForbidden, EntitiesForbidden, ExternalReferenceForbidden

MAX_XML_BYTES = 512 * 1024
MAX_DEPTH = 128
MAX_ELEMENTS = 100_000
MAX_MATCHES_RETURNED = 50
MAX_VALUE_CHARS = 500
MAX_PATH_CHARS = 300
MAX_STEPS = 32

_NAME = r"[A-Za-z_][\w.\-]*"
_STEP_RE = re.compile(rf"^(?:(?P<prefix>{_NAME}):)?(?P<local>{_NAME}|\*)(?:\[(?P<index>[1-9]\d{{0,5}})\])?$")
_ATTR_RE = re.compile(rf"^@(?:(?P<prefix>{_NAME}):)?(?P<local>{_NAME})$")
_URI_RE = re.compile(r"^[^\s<>\"]{1,500}$")


class PathSyntaxError(ValueError):
    """The field path is not part of the supported path subset."""


class _Limit(ValueError):
    pass


@dataclass(frozen=True)
class Step:
    prefix: Optional[str]
    local: str
    index: Optional[int]
    descendant: bool


@dataclass(frozen=True)
class ParsedPath:
    steps: Tuple[Step, ...]
    attribute: Optional[Tuple[Optional[str], str]]
    normalized: str


def parse_path(path: str) -> ParsedPath:
    raw = (path or "").strip()
    if not raw:
        raise PathSyntaxError("The field path is empty.")
    if len(raw) > MAX_PATH_CHARS:
        raise PathSyntaxError(f"The field path is longer than {MAX_PATH_CHARS} characters.")
    if not raw.startswith("/"):
        raise PathSyntaxError("The field path must start with '/' (absolute) or '//' (any depth).")

    tokens: List[Tuple[bool, str]] = []
    i = 0
    while i < len(raw):
        descendant = raw.startswith("//", i)
        i += 2 if descendant else 1
        j = raw.find("/", i)
        seg = raw[i:] if j == -1 else raw[i:j]
        if not seg:
            raise PathSyntaxError("The field path contains an empty step ('///' or a trailing '/').")
        tokens.append((descendant, seg))
        i = len(raw) if j == -1 else j

    attribute = None
    if tokens and tokens[-1][1].startswith("@"):
        descendant, seg = tokens.pop()
        if descendant:
            raise PathSyntaxError("An attribute step cannot use '//'.")
        m = _ATTR_RE.match(seg)
        if not m:
            raise PathSyntaxError(f"Invalid attribute step '{seg}'.")
        attribute = (m.group("prefix"), m.group("local"))
    if not tokens:
        raise PathSyntaxError("The field path needs at least one element step.")
    if len(tokens) > MAX_STEPS:
        raise PathSyntaxError(f"The field path has more than {MAX_STEPS} steps.")

    steps: List[Step] = []
    for descendant, seg in tokens:
        if seg.startswith("@"):
            raise PathSyntaxError("Attribute steps are only allowed at the end of the path.")
        m = _STEP_RE.match(seg)
        if not m:
            raise PathSyntaxError(
                f"Unsupported step '{seg}'. Use element names, 'prefix:name', '*' and an optional [n] position."
            )
        steps.append(
            Step(
                prefix=m.group("prefix"),
                local=m.group("local"),
                index=int(m.group("index")) if m.group("index") else None,
                descendant=descendant,
            )
        )

    normalized = "".join(
        ("//" if s.descendant else "/")
        + (f"{s.prefix}:" if s.prefix else "")
        + s.local
        + (f"[{s.index}]" if s.index else "")
        for s in steps
    )
    if attribute:
        normalized += "/@" + (f"{attribute[0]}:" if attribute[0] else "") + attribute[1]
    return ParsedPath(tuple(steps), attribute, normalized)


class _PosElement(Element):
    __slots__ = ("line", "column", "parent_ref")

    def __init__(self, tag, attrib):
        super().__init__(tag, attrib)
        self.line = 0
        self.column = 0
        self.parent_ref = None


class _Builder(TreeBuilder):
    """TreeBuilder recording positions, namespace declarations and hard limits."""

    def __init__(self):
        super().__init__(element_factory=_PosElement)
        self.parser = None
        self.depth = 0
        self.max_depth_seen = 0
        self.count = 0
        self.namespaces: List[Tuple[str, str, int]] = []
        self._stack: List[_PosElement] = []

    def start_ns(self, prefix, uri):
        line = self.parser.CurrentLineNumber if self.parser else 0
        self.namespaces.append((prefix or "", uri, line))

    def start(self, tag, attrs):
        self.depth += 1
        self.count += 1
        if self.depth > MAX_DEPTH:
            raise _Limit(f"The document nests elements deeper than {MAX_DEPTH} levels.")
        if self.count > MAX_ELEMENTS:
            raise _Limit(f"The document has more than {MAX_ELEMENTS} elements.")
        self.max_depth_seen = max(self.max_depth_seen, self.depth)
        elem = super().start(tag, attrs)
        if self.parser:
            elem.line = self.parser.CurrentLineNumber
            elem.column = self.parser.CurrentColumnNumber + 1
        elem.parent_ref = self._stack[-1] if self._stack else None
        self._stack.append(elem)
        return elem

    def end(self, tag):
        self.depth -= 1
        self._stack.pop()
        return super().end(tag)


def _split(tag: str) -> Tuple[Optional[str], str]:
    if tag.startswith("{"):
        uri, _, local = tag[1:].partition("}")
        return uri, local
    return None, tag


@dataclass
class Issue:
    code: str
    severity: str
    message: str
    step: Optional[str] = None

    def as_dict(self):
        return {"code": self.code, "severity": self.severity, "message": self.message, "step": self.step}


@dataclass
class _Ctx:
    ns_map: Dict[str, str]
    issues: List[Issue] = field(default_factory=list)
    flagged: set = field(default_factory=set)

    def add(self, issue: Issue):
        key = (issue.code, issue.step)
        if key not in self.flagged:
            self.flagged.add(key)
            self.issues.append(issue)


def _step_label(s: Step) -> str:
    return (f"{s.prefix}:" if s.prefix else "") + s.local + (f"[{s.index}]" if s.index else "")


def _iter_desc(el: Element):
    for child in el:
        yield child
        yield from _iter_desc(child)


def _match_step(candidates: List[Element], step: Step, ctx: _Ctx) -> List[Element]:
    label = _step_label(step)
    want_uri: Optional[str] = None
    prefix_ok = True
    if step.prefix:
        if step.prefix in ctx.ns_map:
            want_uri = ctx.ns_map[step.prefix]
        else:
            prefix_ok = False
            ctx.add(
                Issue(
                    "UNDECLARED_PREFIX",
                    "ERROR",
                    f"The prefix '{step.prefix}' is neither declared in the document nor in the namespace map; "
                    "the step was matched by local name only.",
                    label,
                )
            )

    def name_ok(el: Element, strict_ns: bool) -> bool:
        uri, local = _split(el.tag)
        if step.local != "*" and local != step.local:
            return False
        if step.prefix and prefix_ok and strict_ns:
            return uri == want_uri
        return True

    matched: List[Element] = []
    loose: List[Element] = []
    for parent in candidates:
        pool = list(_iter_desc(parent)) if step.descendant else list(parent)
        # Positions count among matching siblings of the same parent (XPath semantics for child steps).
        group: Dict[int, List[Element]] = {}
        for el in pool:
            if name_ok(el, True):
                key = id(getattr(el, "parent_ref", None)) if step.descendant else id(parent)
                group.setdefault(key, []).append(el)
            elif name_ok(el, False):
                loose.append(el)
        for items in group.values():
            if step.index is not None:
                if len(items) >= step.index:
                    matched.append(items[step.index - 1])
            else:
                matched.extend(items)

    if not matched and loose and step.prefix and prefix_ok:
        found = sorted({(_split(e.tag)[0] or "(no namespace)") for e in loose})
        ctx.add(
            Issue(
                "NAMESPACE_MISMATCH",
                "ERROR",
                f"'{step.local}' exists, but in namespace {', '.join(found)} instead of '{want_uri}' "
                f"(prefix '{step.prefix}').",
                label,
            )
        )
    if not step.prefix:
        namespaced = sorted({_split(e.tag)[0] for e in matched if _split(e.tag)[0]})
        if namespaced:
            ctx.add(
                Issue(
                    "UNPREFIXED_STEP_IN_NAMESPACE",
                    "WARNING",
                    f"'{step.local}' is in namespace {', '.join(namespaced)}. A namespace-aware XPath or form "
                    "binding needs a prefix bound to this namespace; this checker matched by local name.",
                    label,
                )
            )
    # Stable document order, duplicates removed (descendant steps can reach an element twice).
    seen = set()
    out = []
    for el in matched:
        if id(el) not in seen:
            seen.add(id(el))
            out.append(el)
    return out


def _abs_path(el: Element) -> str:
    parts = []
    node = el
    while node is not None:
        parent = getattr(node, "parent_ref", None)
        _, local = _split(node.tag)
        if parent is None:
            parts.append(f"{local}[1]")
        else:
            same = [c for c in parent if c.tag == node.tag]
            parts.append(f"{local}[{same.index(node) + 1}]")
        node = parent
    return "/" + "/".join(reversed(parts))


def _value(text: Optional[str]) -> Tuple[Optional[str], bool]:
    if text is None:
        return None, False
    v = " ".join(text.split())
    if len(v) > MAX_VALUE_CHARS:
        return v[:MAX_VALUE_CHARS], True
    return v, False


def check_xml_field(xml_text: str, path: str, namespaces: Optional[Dict[str, str]] = None) -> dict:
    """Pure function: identical input produces an identical result."""
    parsed = parse_path(path)  # PathSyntaxError propagates → HTTP 422
    user_ns = {}
    for prefix, uri in (namespaces or {}).items():
        if not re.match(rf"^{_NAME}$", prefix or "") or not _URI_RE.match(uri or ""):
            raise PathSyntaxError(f"Invalid namespace map entry '{prefix}'.")
        user_ns[prefix] = uri

    data = xml_text.encode("utf-8")
    base = {"path": parsed.normalized, "bytes": len(data)}
    if len(data) > MAX_XML_BYTES:
        return {**base, "wellFormed": False, "rejected": "TOO_LARGE",
                "error": f"The document is larger than {MAX_XML_BYTES // 1024} KB.", "exists": False,
                "matchCount": 0, "matches": [], "issues": [], "document": None}

    builder = _Builder()
    parser = DefusedET.DefusedXMLParser(target=builder, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    builder.parser = parser.parser
    try:
        parser.feed(xml_text)
        root = parser.close()
    except (DTDForbidden, EntitiesForbidden, ExternalReferenceForbidden, DefusedXmlException):
        return {**base, "wellFormed": False, "rejected": "DTD_OR_ENTITY_FORBIDDEN",
                "error": "Document type declarations, entity declarations and external references are not accepted.",
                "exists": False, "matchCount": 0, "matches": [], "issues": [], "document": None}
    except _Limit as e:
        return {**base, "wellFormed": False, "rejected": "LIMIT_EXCEEDED", "error": str(e), "exists": False,
                "matchCount": 0, "matches": [], "issues": [], "document": None}
    except (ExpatError, SyntaxError) as e:
        # Expat messages carry only the position (e.g. "mismatched tag: line 3, column 2"): no input echo.
        return {**base, "wellFormed": False, "rejected": "NOT_WELL_FORMED", "error": f"Invalid XML: {e}",
                "exists": False, "matchCount": 0, "matches": [], "issues": [], "document": None}
    except Exception:  # noqa: BLE001 — never surface interpreter internals
        return {**base, "wellFormed": False, "rejected": "NOT_WELL_FORMED",
                "error": "Invalid XML: the document could not be parsed.", "exists": False,
                "matchCount": 0, "matches": [], "issues": [], "document": None}

    doc_ns: Dict[str, str] = {}
    ctx = _Ctx(ns_map={})
    for prefix, uri, line in builder.namespaces:
        if prefix and prefix in doc_ns and doc_ns[prefix] != uri:
            ctx.add(Issue("PREFIX_REBOUND", "WARNING",
                          f"The prefix '{prefix}' is bound to different namespaces in this document "
                          f"(also at line {line}); results use the first declaration.", None))
            continue
        doc_ns.setdefault(prefix, uri)
    ctx.ns_map = {**{p: u for p, u in doc_ns.items() if p}, **user_ns}
    for prefix, uri in user_ns.items():
        if prefix in doc_ns and doc_ns[prefix] != uri:
            ctx.add(Issue("PREFIX_DIFFERS_FROM_DOCUMENT", "INFO",
                          f"Your namespace map binds '{prefix}' to '{uri}', the document binds it to "
                          f"'{doc_ns[prefix]}'. Your mapping was used.", None))

    first = parsed.steps[0]
    wrapper = Element("__wrapper__")
    wrapper.append(root)
    current = _match_step([wrapper], first, ctx)
    for step in parsed.steps[1:]:
        if not current:
            break
        current = _match_step(current, step, ctx)

    matches = []
    if parsed.attribute and current:
        a_prefix, a_local = parsed.attribute
        a_uri = None
        if a_prefix:
            if a_prefix in ctx.ns_map:
                a_uri = ctx.ns_map[a_prefix]
            else:
                ctx.add(Issue("UNDECLARED_PREFIX", "ERROR",
                              f"The attribute prefix '{a_prefix}' is not declared; matched by local name only.",
                              f"@{a_prefix}:{a_local}"))
        for el in current:
            for key, val in el.attrib.items():
                uri, local = _split(key)
                if local != a_local:
                    continue
                if a_prefix and a_uri is not None and uri != a_uri:
                    continue
                if not a_prefix and uri:
                    ctx.add(Issue("UNPREFIXED_STEP_IN_NAMESPACE", "WARNING",
                                  f"Attribute '{a_local}' is in namespace {uri}; matched by local name.", f"@{a_local}"))
                value, truncated = _value(val)
                matches.append({"kind": "attribute", "path": f"{_abs_path(el)}/@{a_local}",
                                "localName": a_local, "namespaceUri": uri, "line": el.line, "column": el.column,
                                "value": value, "valueTruncated": truncated, "childElementCount": 0})
    elif not parsed.attribute:
        for el in current:
            uri, local = _split(el.tag)
            value, truncated = _value(el.text)
            matches.append({"kind": "element", "path": _abs_path(el), "localName": local, "namespaceUri": uri,
                            "line": el.line, "column": el.column,
                            "value": value if value else None, "valueTruncated": truncated,
                            "childElementCount": len(el)})

    matches.sort(key=lambda m: (m["line"], m["column"], m["path"]))
    if not matches:
        ctx.add(Issue("PATH_NOT_FOUND", "INFO", "No element or attribute matches the path.", None))
    empty = [m for m in matches if m["kind"] == "element" and m["value"] is None and m["childElementCount"] == 0]
    if empty:
        ctx.add(Issue("EMPTY_VALUE", "WARNING",
                      f"{len(empty)} matching element(s) exist but carry no value — a form field bound to this "
                      "path prints empty.", None))

    root_uri, root_local = _split(root.tag)
    return {
        **base,
        "wellFormed": True,
        "rejected": None,
        "error": None,
        "exists": bool(matches),
        "matchCount": len(matches),
        "matches": matches[:MAX_MATCHES_RETURNED],
        "issues": [i.as_dict() for i in ctx.issues],
        "document": {
            "rootLocalName": root_local,
            "rootNamespaceUri": root_uri,
            "namespaces": [{"prefix": p, "uri": u, "line": ln} for p, u, ln in builder.namespaces][:50],
            "elementCount": builder.count,
            "maxDepth": builder.max_depth_seen,
        },
    }
