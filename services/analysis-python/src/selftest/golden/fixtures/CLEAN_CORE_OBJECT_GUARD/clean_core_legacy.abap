REPORT zr_legacy_stock_export.

TABLES: mara, vbak.

DATA: lt_mara TYPE TABLE OF mara,
      ls_mara TYPE mara,
      lv_file TYPE string VALUE '/usr/sap/trans/data/stock.txt',
      lv_cmd  TYPE string VALUE 'rm -rf /tmp/scratch'.

START-OF-SELECTION.
  PERFORM fetch_materials.
  PERFORM export_to_file.

FORM fetch_materials.
  SELECT * FROM mara INTO TABLE lt_mara WHERE mtart = 'FERT'.
  SELECT vbeln, erdat FROM vbak INTO (mara-matnr, mara-ersda).
  ENDSELECT.
ENDFORM.

FORM export_to_file.
  OPEN DATASET lv_file FOR OUTPUT IN TEXT MODE ENCODING DEFAULT.
  LOOP AT lt_mara INTO ls_mara.
    TRANSFER ls_mara-matnr TO lv_file.
  ENDLOOP.
  CLOSE DATASET lv_file.
  CALL 'SYSTEM' ID 'COMMAND' FIELD lv_cmd.
ENDFORM.
