CLASS zcl_clean_order DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_clean_order IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    SELECT product, producttype
      FROM i_product
      WHERE product = 'MAT01'
      INTO TABLE @DATA(lt_products).
    out->write( lt_products ).
  ENDMETHOD.
ENDCLASS.