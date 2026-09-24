import xml.etree.ElementTree as ET

xml_data = """<root>
    <DecisionTable name="T1">
        <Step type="OTHER"/>
    </DecisionTable>
</root>"""

root = ET.fromstring(xml_data)
table = root.find(".//DecisionTable")
print("table.attrib:", table.attrib)
print("table.get('line_number'):", table.get("line_number"))
print("has sourceline?", hasattr(table, "sourceline"))
