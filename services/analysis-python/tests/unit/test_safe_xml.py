import pytest
from src.parsers.safe_xml import SafeXmlParser
from src.core.exceptions import SecurityViolationError


def test_safe_xml_parses_valid_xml():
    xml_content = "<root><item id='1'>Value</item></root>"
    root = SafeXmlParser.parse_string(xml_content)
    assert root.tag == "root"
    assert root.find("item").text == "Value"


def test_safe_xml_blocks_xxe_entity():
    malicious_xml = """<?xml version="1.0"?>
    <!DOCTYPE root [
      <!ENTITY xxe SYSTEM "file:///etc/passwd">
    ]>
    <root>&xxe;</root>"""

    with pytest.raises(SecurityViolationError):
        SafeXmlParser.parse_string(malicious_xml)
