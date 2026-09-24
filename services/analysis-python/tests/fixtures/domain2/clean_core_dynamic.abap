CLASS zcl_dynamic_reader DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS execute_dynamic_query
      IMPORTING
        iv_table TYPE tabname
        iv_fields TYPE string
      RETURNING
        VALUE(rv_count) TYPE i.
ENDCLASS.

CLASS zcl_dynamic_reader IMPLEMENTATION.
  METHOD execute_dynamic_query.
    FIELD-SYMBOLS: <lt_table> TYPE ANY TABLE.
    SELECT (iv_fields) FROM (iv_table) INTO TABLE @<lt_table>.

    EXEC SQL.
      COMMIT WORK;
    ENDEXEC.

    CALL FUNCTION 'RFC_READ_TABLE'
      EXPORTING
        query_table = iv_table.
  ENDMETHOD.
ENDCLASS.
