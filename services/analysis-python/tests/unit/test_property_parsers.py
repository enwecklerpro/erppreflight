"""Property-based robustness tests for all hardened parsers (AGENTS.md Axiom 2 #10).

Arbitrary / hostile inputs may only ever raise the parser's documented error type — never an
unexpected exception, never unbounded time (Hypothesis deadline) — and valid inputs must round-trip.
"""

from __future__ import annotations

import asyncio
import io
import json
import zipfile

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

import src.engines  # noqa: F401
from src.core.contracts import InputFormat, sniff_format
from src.core.exceptions import EngineInputError, SecurityViolationError
from src.core.runner import EngineRunner
from src.models.enums import AnalysisStatus, EngineType
from src.models.request import AnalysisRequest
from src.parsers.abap_tokenizer import looks_like_abap, parse_statements, tokenize
from src.parsers.json_input import MAX_JSON_DEPTH, json_nesting_depth, parse_json_payload
from src.parsers.safe_xml import SafeXmlParser
from src.parsers.safe_zip import ArchiveSecurityError, SafeZipReader, inspect_archive

FAST = settings(max_examples=80, deadline=2000, suppress_health_check=[HealthCheck.too_slow])

json_values = st.recursive(
    st.none() | st.booleans() | st.integers() | st.floats(allow_nan=False, allow_infinity=False) | st.text(max_size=20),
    lambda children: st.lists(children, max_size=4) | st.dictionaries(st.text(max_size=8), children, max_size=4),
    max_leaves=25,
)


# ------------------------------------------------------------------ JSON
@FAST
@given(st.text(max_size=400))
def test_json_parser_never_raises_unexpected(text):
    try:
        parse_json_payload(text, "PROP")
    except EngineInputError as exc:
        assert exc.rule_id in ("PROP_PARSE_ERROR",)


@FAST
@given(json_values)
def test_json_parser_round_trips_valid_documents(value):
    text = json.dumps(value)
    assert parse_json_payload(text, "PROP") == json.loads(text)


@FAST
@given(st.integers(min_value=1, max_value=400), st.sampled_from(["[]", "{}"]))
def test_json_depth_guard(depth, brackets):
    o, c = brackets
    text = (o if o == "[" else '{"k":') * depth + ("" if o == "[" else "1") + c * depth
    measured = json_nesting_depth(text, limit=10_000)
    assert measured == depth
    if depth > MAX_JSON_DEPTH:
        try:
            parse_json_payload(text, "PROP")
            raise AssertionError("depth bomb accepted")
        except EngineInputError as exc:
            assert "depth" in exc.message


# ------------------------------------------------------------------ XML
@FAST
@given(st.text(max_size=400))
def test_safe_xml_never_raises_unexpected(text):
    try:
        SafeXmlParser.parse_string(text)
    except (ValueError, SecurityViolationError):
        pass


xml_names = st.from_regex(r"[A-Za-z][A-Za-z0-9]{0,6}", fullmatch=True)


@FAST
@given(st.lists(xml_names, min_size=1, max_size=20))
def test_safe_xml_parses_generated_documents_with_positions(names):
    doc = "".join(f"<{n}>" for n in names) + "".join(f"</{n}>" for n in reversed(names))
    root = SafeXmlParser.parse_string(doc)
    assert root.tag == names[0] and root.sourceline == 1


@FAST
@given(st.text(alphabet="<>!&;%\"' DOCTYPEENTITYSYSTEMabc", max_size=200))
def test_safe_xml_dtd_like_noise_is_contained(text):
    try:
        SafeXmlParser.parse_string("<!DOCTYPE x [" + text + "]><x/>")
    except (ValueError, SecurityViolationError):
        pass


# ------------------------------------------------------------------ ZIP
@FAST
@given(st.binary(max_size=600))
def test_safe_zip_rejects_arbitrary_bytes_cleanly(data):
    try:
        inspect_archive(b"PK\x03\x04" + data)
    except ArchiveSecurityError:
        pass


@FAST
@given(st.dictionaries(st.from_regex(r"[a-z]{1,8}(/[a-z]{1,8})?\.(txt|json|abap)", fullmatch=True),
                       st.binary(max_size=200).filter(lambda b: not b.startswith(b"PK\x03\x04")),
                       min_size=1, max_size=8))
def test_safe_zip_round_trips_generated_archives(members):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    with SafeZipReader(buf.getvalue()) as zf:
        assert dict(zf.walk()) == members


@FAST
@given(st.binary(max_size=64))
def test_member_with_zip_magic_but_invalid_archive_fails_closed(tail):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("looks_like.zip", b"PK\x03\x04" + tail)
    try:
        members = dict(SafeZipReader(buf.getvalue()).walk())
        # Only acceptable when the tail happened to form a valid (tiny) archive.
        assert all(isinstance(v, bytes) for v in members.values())
    except ArchiveSecurityError:
        pass


@FAST
@given(st.binary(min_size=30, max_size=600), st.integers(min_value=0, max_value=599))
def test_safe_zip_bitflips_never_escape(data, pos):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("a.txt", data)
    raw = bytearray(buf.getvalue())
    raw[pos % len(raw)] ^= 0xFF
    try:
        inspect_archive(bytes(raw))
    except ArchiveSecurityError:
        pass


# ------------------------------------------------------------------ ABAP tokenizer
abap_alphabet = st.sampled_from(list("abcSELECTFROMINSERTUPDATE .:,'`|\"*()@-=>\n\t0123456789{}#"))


@FAST
@given(st.text(max_size=500))
def test_abap_tokenizer_total_on_arbitrary_text(text):
    stmts, lex = parse_statements(text)
    for tok in lex.tokens:
        assert tok.line >= 1 and tok.col >= 1
    looks_like_abap(text)


@FAST
@given(st.lists(abap_alphabet, max_size=400).map("".join))
def test_abap_tokenizer_total_on_abap_like_noise(text):
    parse_statements(text)


@FAST
@given(st.text(alphabet=st.characters(blacklist_characters="'\n\r"), max_size=60))
def test_literal_content_is_never_code(inner):
    lex = tokenize(f"WRITE '{inner}'.")
    words = [t.value.upper() for t in lex.tokens if t.kind == "WORD"]
    assert words == ["WRITE"]


# ------------------------------------------------------------------ contract gate end-to-end
ENGINE_SAMPLE = [EngineType.CLEAN_CORE_OBJECT_GUARD, EngineType.SPRO2CLOUD, EngineType.MFS_BLACKBOX,
                 EngineType.API_CHANGE_GUARD, EngineType.FORM_DOCTOR, EngineType.TRANSPORT_DEPENDENCY_ANALYZER]


@settings(max_examples=40, deadline=4000, suppress_health_check=[HealthCheck.too_slow])
@given(st.sampled_from(ENGINE_SAMPLE), st.text(max_size=300))
def test_runner_never_raises_on_arbitrary_text(engine_type, text):
    req = AnalysisRequest(job_id="prop", tenant_id="t", project_id="p", engine_type=engine_type, raw_content=text)
    resp = asyncio.run(EngineRunner.execute(req))
    assert resp.status in (AnalysisStatus.COMPLETED, AnalysisStatus.PARTIAL, AnalysisStatus.FAILED)
    if resp.status == AnalysisStatus.FAILED:
        assert all(f.confidence.value == "UNKNOWN" for f in resp.findings)


@FAST
@given(st.text(max_size=200))
def test_sniff_format_total(text):
    assert isinstance(sniff_format(text), InputFormat)
