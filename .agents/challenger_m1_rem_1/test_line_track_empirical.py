from xml.etree.ElementTree import Element, TreeBuilder
import defusedxml.ElementTree as DefusedET
from defusedxml.common import DefusedXmlException, EntitiesForbidden, DTDForbidden

class SecurityViolationError(Exception):
    pass

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

# Test 1: Normal XML with line numbers
sample_xml = """<root>
    <DecisionTable name="TABLE_1">
        <Step type="PRINTER_DETERMINATION" />
    </DecisionTable>
    <DecisionTable name="TABLE_2">
        <!-- Defective table missing printer step -->
    </DecisionTable>
</root>"""

root = SafeXmlParser.parse_string(sample_xml)
print("Root tag:", root.tag, "line:", root.sourceline)
tables = root.findall(".//DecisionTable")
for t in tables:
    print(f"DecisionTable name={t.get('name')}: sourceline={t.sourceline}, sourcecol={t.sourcecolumn}, line_number attr={t.get('line_number')}")

assert tables[0].sourceline == 2, f"Expected line 2, got {tables[0].sourceline}"
assert tables[1].sourceline == 5, f"Expected line 5, got {tables[1].sourceline}"
assert tables[0].get("line_number") == "2"
assert tables[1].get("line_number") == "5"

# Test 2: Malicious DTD XML
malicious_dtd = """<?xml version="1.0"?>
<!DOCTYPE root [<!ENTITY test "attack">]>
<root>&test;</root>"""

try:
    SafeXmlParser.parse_string(malicious_dtd)
    assert False, "Should have failed on DTD"
except SecurityViolationError as e:
    print("Successfully blocked DTD attack:", e)

# Test 3: Malicious Entity XML
malicious_entity = """<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
]>
<lolz>&lol2;</lolz>"""

try:
    SafeXmlParser.parse_string(malicious_entity)
    assert False, "Should have failed on Entity"
except SecurityViolationError as e:
    print("Successfully blocked Entity expansion attack:", e)

print("ALL XML TESTS PASSED!")
