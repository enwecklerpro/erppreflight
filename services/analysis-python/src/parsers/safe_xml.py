"""
ERP Preflight — Safe XML Parser with Line Number Retention
Defused XML parser preventing XXE, Billion Laughs, and DTD expansion while preserving coordinates.
"""

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
