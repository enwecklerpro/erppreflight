"""
ERP Preflight — Domain 1 Golden Fixtures Provisioner
Generates all 12 curated test fixtures under services/analysis-python/tests/fixtures/domain1/
"""

import sys
from pathlib import Path

# Resolve destination directory
FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "services" / "analysis-python" / "tests" / "fixtures" / "domain1"

FIXTURE_DATA = {
    "opd_decision_table.csv": (
        "Step,COND_DocumentType,COND_PurchasingOrg,COND_CompanyCode,COND_Supplier,COND_Channel,RESULT\n"
        "Output Type,NB,*,*,*,*,PURCHASE_ORDER\n"
        "Output Type,FO,*,*,*,*,BLANKET_ORDER\n"
        "Output Type,*,*,*,*,*,STANDARD_ORDER\n"
        "Receiver,NB,*,*,*,*,SUPPLIER_100045\n"
        "Receiver,FO,*,*,*,*,SUPPLIER_DEFAULT\n"
        "Receiver,*,*,*,*,*,SUPPLIER_DEFAULT\n"
        "Channel,NB,*,*,*,*,EMAIL\n"
        "Channel,FO,*,*,*,*,PRINT\n"
        "Channel,*,*,*,*,*,PRINT\n"
        "Printer,NB,*,*,*,PRINT,LP01\n"
        "Printer,*,*,*,*,PRINT,DEFAULT_QUEUE\n"
        "Email Recipient,*,DE01,*,100045,*,orders@supplier45.de\n"
        "Email Recipient,*,1010,*,100045,*,orders-us@supplier45.de\n"
        "Email Sender,*,*,1000,*,*,procurement@acme.corp\n"
        "Email Sender,*,*,*,*,*,no-reply@acme.corp\n"
        "Form Template,NB,*,*,*,*,MM_PURCHASE_ORDER_DEFAULT\n"
        "Form Template,FO,*,*,*,*,MM_PURCHASE_ORDER_DEFAULT\n"
        "Form Template,*,*,*,*,*,MM_PURCHASE_ORDER_DEFAULT\n"
        "Output Relevance,NB,*,*,*,*,TRUE\n"
        "Output Relevance,FO,*,*,*,*,TRUE\n"
        "Output Relevance,*,*,*,*,*,TRUE\n"
    ),
    "opd_scenario_valid.json": '''{
  "scenario": {
    "DocumentType": "NB",
    "CompanyCode": "1000",
    "PurchasingOrg": "DE01",
    "Supplier": "100045",
    "Currency": "EUR",
    "DispatchTime": "1"
  },
  "target_release": "S4HC_2408",
  "expected_determination": {
    "Output Type": "PURCHASE_ORDER",
    "Receiver": "SUPPLIER_100045",
    "Channel": "EMAIL",
    "Printer": "LP01",
    "Email Recipient": "orders@supplier45.de",
    "Email Sender": "procurement@acme.corp",
    "Form Template": "MM_PURCHASE_ORDER_DEFAULT",
    "Output Relevance": "TRUE"
  }
}''',
    "opd_scenario_shadowed.json": '''{
  "scenario": {
    "DocumentType": "NB",
    "CompanyCode": "1000",
    "PurchasingOrg": "DE01",
    "Supplier": "100045"
  },
  "tables": {
    "Channel": [
      {
        "row_number": 1,
        "COND_DocumentType": "*",
        "RESULT": "PRINT"
      },
      {
        "row_number": 2,
        "COND_DocumentType": "NB",
        "RESULT": "EMAIL"
      },
      {
        "row_number": 3,
        "COND_DocumentType": "FO",
        "RESULT": "EDI"
      }
    ]
  }
}''',
    "opd_scenario_missing_channel.json": '''{
  "scenario": {
    "DocumentType": "NB",
    "CompanyCode": "1000",
    "PurchasingOrg": "US01",
    "Supplier": "999999",
    "Currency": "USD"
  },
  "tables": {
    "Output Type": [
      { "COND_DocumentType": "NB", "RESULT": "PURCHASE_ORDER" }
    ],
    "Receiver": [
      { "COND_DocumentType": "NB", "RESULT": "SUPPLIER_999999" }
    ],
    "Channel": [
      { "COND_DocumentType": "NB", "RESULT": "EMAIL" }
    ],
    "Printer": [
      { "COND_DocumentType": "NB", "RESULT": "LP01" }
    ],
    "Email Recipient": [
      { "COND_PurchasingOrg": "DE01", "COND_Supplier": "100045", "RESULT": "orders@supplier45.de" }
    ],
    "Email Sender": [
      { "COND_CompanyCode": "1000", "RESULT": "procurement@acme.corp" }
    ],
    "Form Template": [
      { "COND_DocumentType": "NB", "RESULT": "MM_PURCHASE_ORDER_DEFAULT" }
    ],
    "Output Relevance": [
      { "COND_DocumentType": "NB", "RESULT": "TRUE" }
    ]
  }
}''',
    "form_data_valid.xml": '''<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
    <Header>
        <InvoiceID>90001234</InvoiceID>
        <InvoiceDate>2026-09-24</InvoiceDate>
        <Supplier>
            <ID>100045</ID>
            <Name>Bosch Rexroth AG</Name>
            <TaxNumber>DE123456789</TaxNumber>
        </Supplier>
        <TotalAmount Currency="EUR">14250.00</TotalAmount>
        <PaymentTerms>NT30</PaymentTerms>
    </Header>
    <Items>
        <Item>
            <LineNumber>10</LineNumber>
            <ProductDescription>Hydraulic Directional Valve</ProductDescription>
            <Quantity>5</Quantity>
            <NetPrice>2850.00</NetPrice>
        </Item>
    </Items>
</Invoice>''',
    "form_template_xdp.xml": '''<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
    <template>
        <subform name="InvoiceForm" dataRef="$.Invoice">
            <field name="InvoiceNum">
                <bind match="dataRef" ref="$.Header.InvoiceID"/>
            </field>
            <field name="SupplierTax">
                <bind match="dataRef" ref="$.Header.Supplier.TaxNumber"/>
            </field>
            <field name="TotalAmt">
                <bind match="dataRef" ref="$.Header.TotalAmount"/>
            </field>
            <field name="ItemDescription">
                <bind match="dataRef" ref="$.Items.Item.ProductDescription"/>
            </field>
        </subform>
    </template>
</xdp:xdp>''',
    "form_data_missing_field.xml": '''<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
    <Header>
        <InvoiceID>90001234</InvoiceID>
        <InvoiceDate>2026-09-24</InvoiceDate>
        <Supplier>
            <ID>100045</ID>
            <Name>Bosch Rexroth AG</Name>
        </Supplier>
        <TotalAmount Currency="EUR">14250.00</TotalAmount>
        <PaymentTerms>NT30</PaymentTerms>
    </Header>
    <Items>
        <Item>
            <LineNumber>10</LineNumber>
            <ProductDescription>Hydraulic Directional Valve</ProductDescription>
            <Quantity>5</Quantity>
            <NetPrice>2850.00</NetPrice>
        </Item>
    </Items>
</Invoice>''',
    "form_legacy_smartform.xml": '''<?xml version="1.0" encoding="UTF-8"?>
<SMARTFORM name="/1BCDWB/SF00000042">
    <HEADER>
        <FORMNAME>Z_PURCHASE_ORDER_LEGACY</FORMNAME>
        <DEVCLASS>Z_MM_FORMS</DEVCLASS>
        <ORIGLANG>D</ORIGLANG>
    </HEADER>
    <PAGES>
        <PAGE name="FIRST">
            <WINDOWS>
                <WINDOW name="MAIN" type="MAIN">
                    <TEXT>
                        <T_LINES>
                            <LINE>/E ITEM_LINE</LINE>
                            <LINE>* Material: &amp;EKPO-MATNR&amp;</LINE>
                            <LINE>* Quantity: &amp;EKPO-MENGE&amp; &amp;EKPO-MEINS&amp;</LINE>
                        </T_LINES>
                    </TEXT>
                </WINDOW>
                <WINDOW name="HEADER_LOGO" type="GRAPHIC"/>
            </WINDOWS>
        </PAGE>
    </PAGES>
</SMARTFORM>''',
    "custom_field_registry.json": '''{
  "field_name": "YY1_PROJECT_CODE",
  "data_type": "CHAR",
  "length": 20,
  "business_contexts": [
    "MM_PURCHASE_ORDER_ITEM",
    "MM_SUPPLIER_INVOICE_ITEM",
    "FI_JOURNAL_ENTRY_ITEM"
  ],
  "hops": [
    {
      "source_context": "MM_PURCHASE_ORDER_ITEM",
      "target_context": "MM_SUPPLIER_INVOICE_ITEM",
      "extension_scenario": "MM_PO_TO_INVOICE",
      "expected_status": "SUPPORTED"
    },
    {
      "source_context": "MM_SUPPLIER_INVOICE_ITEM",
      "target_context": "FI_JOURNAL_ENTRY_ITEM",
      "extension_scenario": "INVOICE_TO_JOURNAL_ENTRY",
      "expected_status": "CUSTOM_LOGIC",
      "required_badi": "BADI_FINS_ACDOC_EXT_PERSISTENCE"
    }
  ],
  "field_definitions": {
    "MM_PURCHASE_ORDER_ITEM": { "type": "CHAR", "length": 20 },
    "MM_SUPPLIER_INVOICE_ITEM": { "type": "CHAR", "length": 20 },
    "FI_JOURNAL_ENTRY_ITEM": { "type": "CHAR", "length": 20 }
  }
}''',
    "custom_field_type_mismatch.json": '''{
  "field_name": "YY1_LONG_DESC",
  "hops": [
    {
      "source_context": "MM_PURCHASE_ORDER_ITEM",
      "target_context": "MM_SUPPLIER_INVOICE_ITEM"
    }
  ],
  "field_definitions": {
    "MM_PURCHASE_ORDER_ITEM": {
      "type": "CHAR",
      "length": 50
    },
    "MM_SUPPLIER_INVOICE_ITEM": {
      "type": "CHAR",
      "length": 20
    }
  }
}''',
    "extension_manifest.json": '''{
  "project_id": "proj-demo-domain1",
  "extensions": [
    {
      "object_name": "YY1_PROJECT_CODE",
      "object_type": "CUSTOM_FIELD",
      "business_context": "MM_PURCHASE_ORDER_ITEM",
      "status": "ACTIVE"
    },
    {
      "object_name": "YY1_UNUSED_OBSOLETE_FIELD",
      "object_type": "CUSTOM_FIELD",
      "business_context": "SD_SALES_ORDER_ITEM",
      "status": "INACTIVE"
    },
    {
      "object_name": "CDS_PURCHASE_ORDERS",
      "object_type": "CDS_VIEW",
      "status": "ACTIVE"
    },
    {
      "object_name": "FORM_PURCHASE_ORDER",
      "object_type": "FORM_TEMPLATE",
      "status": "ACTIVE"
    },
    {
      "object_name": "API_PURCHASING_ANALYTICS",
      "object_type": "ODATA_API",
      "status": "ACTIVE"
    }
  ],
  "dependencies": {
    "YY1_PROJECT_CODE": [
      "CDS_PURCHASE_ORDERS",
      "FORM_PURCHASE_ORDER"
    ],
    "CDS_PURCHASE_ORDERS": [
      "API_PURCHASING_ANALYTICS"
    ],
    "FORM_PURCHASE_ORDER": [],
    "API_PURCHASING_ANALYTICS": [],
    "YY1_UNUSED_OBSOLETE_FIELD": []
  }
}''',
    "extension_cycle.json": '''{
  "project_id": "proj-cycle-domain1",
  "dependencies": {
    "CDS_VIEW_HEADER": [
      "CDS_VIEW_ITEMS"
    ],
    "CDS_VIEW_ITEMS": [
      "CDS_VIEW_BILLING"
    ],
    "CDS_VIEW_BILLING": [
      "CDS_VIEW_HEADER"
    ],
    "API_EXTERNAL_REPORTING": [
      "CDS_VIEW_HEADER"
    ]
  }
}'''
}


def provision_fixtures():
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for filename, content in FIXTURE_DATA.items():
        file_path = FIXTURES_DIR / filename
        file_path.write_text(content, encoding="utf-8")
        count += 1
        print(f"[{count}/12] Provisioned fixture: {file_path}")
    print(f"\nSuccessfully provisioned all {count} Domain 1 test fixtures under {FIXTURES_DIR}")


if __name__ == "__main__":
    provision_fixtures()
