import xml.etree.ElementTree as ET

xml_data = '<root><DecisionTable name="T1"><Step type="PRINTER_DETERMINATION"/></DecisionTable></root>'
root = ET.fromstring(xml_data)
steps = root.findall(".//Step[@type='PRINTER_DETERMINATION']")
print('Found steps:', len(steps))
