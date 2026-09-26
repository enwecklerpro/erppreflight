import pytest
from hypothesis import given, settings, strategies as st

from src.tools.xml_field_check import MAX_XML_BYTES, PathSyntaxError, check_xml_field, parse_path

FORM_DATA = """<?xml version="1.0" encoding="UTF-8"?>
<data xmlns:po="urn:sap:po">
  <po:Header>
    <po:PurchaseOrder>4500000017</po:PurchaseOrder>
    <po:Supplier id="S1">ACME Corp</po:Supplier>
  </po:Header>
  <Items>
    <Item pos="10"><Material>MAT-1</Material></Item>
    <Item pos="20"><Material>MAT-2</Material><Note/></Item>
  </Items>
</data>"""


def test_absolute_path_with_value_and_position():
    r = check_xml_field(FORM_DATA, "/data/Items/Item[2]/Material")
    assert r["wellFormed"] is True
    assert r["exists"] is True
    assert r["matchCount"] == 1
    m = r["matches"][0]
    assert m["value"] == "MAT-2"
    assert m["path"] == "/data[1]/Items[1]/Item[2]/Material[1]"
    assert m["line"] == 9


def test_descendant_path_matches_all():
    r = check_xml_field(FORM_DATA, "//Material")
    assert r["matchCount"] == 2
    assert [m["value"] for m in r["matches"]] == ["MAT-1", "MAT-2"]


def test_attribute_step():
    r = check_xml_field(FORM_DATA, "/data/Items/Item/@pos")
    assert [m["value"] for m in r["matches"]] == ["10", "20"]
    assert all(m["kind"] == "attribute" for m in r["matches"])


def test_prefixed_path_resolves_document_namespace():
    r = check_xml_field(FORM_DATA, "/data/po:Header/po:PurchaseOrder")
    assert r["exists"] is True
    assert r["matches"][0]["namespaceUri"] == "urn:sap:po"
    assert r["matches"][0]["value"] == "4500000017"
    assert not [i for i in r["issues"] if i["severity"] == "ERROR"]


def test_unprefixed_step_in_namespace_is_flagged():
    r = check_xml_field(FORM_DATA, "/data/Header/PurchaseOrder")
    assert r["exists"] is True
    codes = {i["code"] for i in r["issues"]}
    assert "UNPREFIXED_STEP_IN_NAMESPACE" in codes


def test_namespace_mismatch_via_user_map():
    r = check_xml_field(FORM_DATA, "/data/x:Header", {"x": "urn:other"})
    assert r["exists"] is False
    codes = {i["code"] for i in r["issues"]}
    assert "NAMESPACE_MISMATCH" in codes
    assert "PREFIX_DIFFERS_FROM_DOCUMENT" not in codes


def test_undeclared_prefix_is_error_but_matches_local_name():
    r = check_xml_field(FORM_DATA, "/data/zz:Items")
    assert r["exists"] is True
    assert any(i["code"] == "UNDECLARED_PREFIX" and i["severity"] == "ERROR" for i in r["issues"])


def test_missing_path_and_empty_value():
    r = check_xml_field(FORM_DATA, "/data/Items/Item/Missing")
    assert r["exists"] is False
    assert any(i["code"] == "PATH_NOT_FOUND" for i in r["issues"])
    r2 = check_xml_field(FORM_DATA, "//Note")
    assert r2["exists"] is True
    assert any(i["code"] == "EMPTY_VALUE" for i in r2["issues"])


def test_xxe_and_dtd_rejected():
    xxe = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>'
    r = check_xml_field(xxe, "/r")
    assert r["wellFormed"] is False
    assert r["rejected"] == "DTD_OR_ENTITY_FORBIDDEN"
    bomb = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><l>&b;</l>'
    assert check_xml_field(bomb, "/l")["rejected"] == "DTD_OR_ENTITY_FORBIDDEN"


def test_malformed_and_limits():
    r = check_xml_field("<a><b></a>", "/a")
    assert r["wellFormed"] is False and r["rejected"] == "NOT_WELL_FORMED"
    assert "line 1" in r["error"]
    deep = "<a>" * 200 + "</a>" * 200
    assert check_xml_field(deep, "/a")["rejected"] == "LIMIT_EXCEEDED"
    big = "<a>" + "x" * (MAX_XML_BYTES + 1) + "</a>"
    assert check_xml_field(big, "/a")["rejected"] == "TOO_LARGE"


@pytest.mark.parametrize("bad", ["", "a/b", "/a//", "/a/@x/b", "/a[0]", "/a[b]", "//@x", "/a/b c", "/" + "a/" * 40 + "b"])
def test_invalid_paths(bad):
    with pytest.raises(PathSyntaxError):
        parse_path(bad)


def test_deterministic():
    assert check_xml_field(FORM_DATA, "//Item/@pos") == check_xml_field(FORM_DATA, "//Item/@pos")


@settings(max_examples=150, deadline=None)
@given(st.text(max_size=400), st.text(max_size=60))
def test_never_raises_on_hostile_input(xml, path):
    try:
        r = check_xml_field(xml, "/" + path)
    except PathSyntaxError:
        return
    assert isinstance(r["wellFormed"], bool)
    assert len(r["matches"]) <= 50


def test_endpoint(client):
    res = client.post("/api/v1/tools/xml-field-check", json={"xml": FORM_DATA, "path": "//Material"})
    assert res.status_code == 200
    assert res.json()["matchCount"] == 2
    bad = client.post("/api/v1/tools/xml-field-check", json={"xml": FORM_DATA, "path": "no-slash"})
    assert bad.status_code == 422
    extra = client.post("/api/v1/tools/xml-field-check", json={"xml": FORM_DATA, "path": "/a", "store": True})
    assert extra.status_code == 422
