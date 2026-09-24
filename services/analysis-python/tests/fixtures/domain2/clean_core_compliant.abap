CLASS zcl_product_processor DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    TYPES: tt_product TYPE STANDARD TABLE OF I_Product WITH EMPTY KEY.
    METHODS get_active_products
      IMPORTING
        iv_type TYPE I_Product-ProductType
      RETURNING
        VALUE(rt_products) TYPE tt_product.
ENDCLASS.

CLASS zcl_product_processor IMPLEMENTATION.
  METHOD get_active_products.
    SELECT Product, ProductType, BaseUnit, CreationDateTime
      FROM I_Product
      WHERE ProductType = @iv_type
      INTO CORRESPONDING FIELDS OF TABLE @rt_products.
  ENDMETHOD.

  METHOD if_oo_adt_classrun~main.
    DATA(lt_prod) = get_active_products( 'FERT' ).
    out->write( |Fetched { lines( lt_prod ) } active products| ).
  ENDMETHOD.
ENDCLASS.
