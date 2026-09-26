"""
ERP Preflight — Safe XML Parser with Line Number Retention
Defused XML parser preventing XXE, Billion Laughs, and DTD expansion while preserving coordinates.
Element nesting is bounded (MAX_XML_DEPTH) so hostile documents cannot exhaust recursive consumers.
"""

from xml.etree.ElementTree import Element, TreeBuilder
from xml.parsers.expat import ExpatError
import defusedxml.ElementTree as DefusedET
from defusedxml.common import DefusedXmlException, EntitiesForbidden, DTDForbidden
from src.core.exceptions import SecurityViolationError

MAX_XML_DEPTH = 256


class XmlDepthExceeded(ValueError):
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
    def __init__(self, *args, max_depth: int = MAX_XML_DEPTH, **kwargs):
        super().__init__(element_factory=LineElement, *args, **kwargs)
        self.parser = None
        self.max_depth = max_depth
        self.depth = 0

    def start(self, tag, attrs):
        self.depth += 1
        if self.depth > self.max_depth:
            raise XmlDepthExceeded(f"XML element nesting exceeds the supported depth of {self.max_depth} levels.")
        elem = super().start(tag, attrs)
        if self.parser:
            elem.sourceline = self.parser.CurrentLineNumber
            elem.sourcecolumn = self.parser.CurrentColumnNumber
            elem.set("line_number", str(self.parser.CurrentLineNumber))
            elem.set("column_number", str(self.parser.CurrentColumnNumber))
        return elem

    def end(self, tag):
        self.depth -= 1
        return super().end(tag)


class SafeXmlParser:
    """Defused XML parser preventing XXE/DTD attacks while preserving exact line/column positions."""

    @staticmethod
    def parse_string(xml_text: str, max_depth: int = MAX_XML_DEPTH) -> LineElement:
        builder = LineNumberTreeBuilder(max_depth=max_depth)
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
        except XmlDepthExceeded as e:
            raise ValueError(str(e)) from e
        except (ExpatError, SyntaxError) as e:
            # Expat messages are position-only ("mismatched tag: line 1, column 10"); no input echo.
            raise ValueError(f"Invalid XML syntax: {str(e)}") from e
        except Exception as e:  # noqa: BLE001 — never surface interpreter internals
            raise ValueError("Invalid XML syntax: document could not be parsed.") from e
