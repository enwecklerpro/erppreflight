REPORT zr_clean_core_tricky.
* Golden POSITIVE fixture: every statement below must be flagged exactly as documented in
* tests/unit/test_clean_core_tokenizer.py (line / column evidence is asserted).
DATA ls_t001 TYPE t001.
INSERT INTO t001 VALUES ls_t001.
SELECT * FROM (lv_tab) INTO TABLE @DATA(lt_dyn).
CALL FUNCTION 'SO_NEW_DOCUMENT_ATT_SEND_API1' EXPORTING document_data = ls_doc.
CALL FUNCTION 'SOME_STANDARD_FUNCTION'.
CALL FUNCTION lv_fm_name.
CALL METHOD (lv_class)=>(lv_method).
UPDATE bseg SET sgtxt = 'x' WHERE belnr = lv_belnr.
MODIFY vbak FROM ls_vbak.
DELETE FROM mara WHERE matnr = lv_matnr.
SELECT matnr
  FROM mara
  INTO TABLE @DATA(lt_mara).
TABLES: kna1, lfa1.
CALL 'SYSTEM' ID 'COMMAND' FIELD lv_cmd.
CREATE OBJECT lo_any TYPE (lv_type).
DATA(lo_frontend) = NEW cl_gui_frontend_services( ).
