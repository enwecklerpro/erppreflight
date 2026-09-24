import xml.etree.ElementTree as ET
import defusedxml.ElementTree as DET
from defusedxml.common import DefusedXmlException, EntitiesForbidden, DTDForbidden

class LineElement(ET.Element):
    __slots__ = ('sourceline', 'sourcecolumn')

class LineNumberTreeBuilder(ET.TreeBuilder):
    def __init__(self, *args, **kwargs):
        super().__init__(element_factory=LineElement, *args, **kwargs)
        self.parser = None

    def start(self, tag, attrs):
        elem = super().start(tag, attrs)
        if self.parser:
            elem.sourceline = self.parser.CurrentLineNumber
            elem.sourcecolumn = self.parser.CurrentColumnNumber
            elem.set("line_number", str(self.parser.CurrentLineNumber))
            elem.set("column_number", str(self.parser.CurrentColumnNumber))
        return elem

class SafeLineNumberXmlParser:
    """Defused XML parser that records exact line and column numbers on every Element."""

    @staticmethod
    def parse_string(xml_text: str) -> LineElement:
        builder = LineNumberTreeBuilder()
        parser = DET.DefusedXMLParser(
            target=builder,
            forbid_dtd=True,
            forbid_entities=True,
            forbid_external=True
        )
        builder.parser = parser.parser
        parser.feed(xml_text)
        return parser.close()

# Test 1: Normal XML line tracking
xml_data = """<root>
    <DecisionTable name="T1">
        <Step type="OTHER"/>
    </DecisionTable>
    <DecisionTable name="T2">
        <Step type="PRINTER_DETERMINATION"/>
    </DecisionTable>
</root>"""
root = SafeLineNumberXmlParser.parse_string(xml_data)
for table in root.findall(".//DecisionTable"):
    print(f"Table name={table.get('name')}, sourceline={table.sourceline}, sourcecol={table.sourcecolumn}, get('line_number')={table.get('line_number')}")

# Test 2: DTD attack rejection
dtd_attack = """<!DOCTYPE foo [<!ELEMENT foo ANY ><!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>"""
try:
    SafeLineNumberXmlParser.parse_string(dtd_attack)
    print("FAIL: DTD attack was NOT blocked!")
except DTDForbidden:
    print("PASS: DTD attack successfully blocked with DTDForbidden!")

# Test 3: Entity expansion rejection
entity_attack = """<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ELEMENT lolz (#PCDATA)>
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
]>
<lolz>&lol1;</lolz>"""
try:
    SafeLineNumberXmlParser.parse_string(entity_attack)
    print("FAIL: Entity attack was NOT blocked!")
except (DTDForbidden, EntitiesForbidden):
    print("PASS: Entity attack successfully blocked!")
