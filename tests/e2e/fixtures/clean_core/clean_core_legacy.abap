REPORT zlegacy_order_report.

TABLES: mara, vbak.

DATA: lt_mara TYPE TABLE OF mara.

START-OF-SELECTION.
  PERFORM get_materials.

FORM get_materials.
  SELECT * FROM mara INTO TABLE lt_mara WHERE mtart = 'ROH'.
  CALL 'SYSTEM' ID 'COMMAND' FIELD 'ls -la'.
ENDFORM.