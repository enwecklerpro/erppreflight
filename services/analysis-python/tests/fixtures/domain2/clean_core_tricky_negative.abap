CLASS zcl_clean_core_negative DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.

CLASS zcl_clean_core_negative IMPLEMENTATION.
  METHOD run.
* Golden NEGATIVE fixture: nothing here may be flagged.
*   SELECT * FROM mara.            <- full-line comment
    DATA lv_text TYPE string VALUE 'SELECT * FROM mara'. " UPDATE bseg SET x = 1.
    WRITE 'SELECT FROM MARA'.
    lv_text = |INSERT INTO t001 { lv_text } DELETE FROM bkpf|.
    lv_text = `CALL FUNCTION 'RFC_READ_TABLE'`.
    DATA lt_items TYPE STANDARD TABLE OF zcustom_items WITH EMPTY KEY.
    SELECT * FROM zcustom_items INTO TABLE @lt_items.
    SELECT * FROM I_Product INTO TABLE @DATA(lt_products).
    INSERT ls_item INTO TABLE lt_items.
    MODIFY lt_items FROM ls_item INDEX 1.
    DELETE lt_items WHERE item = 'X'.
    UPDATE zcustom_items SET status = 'X' WHERE id = 1.
    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'.
    CALL FUNCTION 'Z_OWN_FUNCTION'.
    DATA(lo_mail) = cl_bcs_mail_message=>create_instance( ).
  ENDMETHOD.
ENDCLASS.
