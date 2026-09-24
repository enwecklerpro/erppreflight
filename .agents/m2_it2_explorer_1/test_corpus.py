import math
import random
import re
import string

def entropy(s: str) -> float:
    freqs = {}
    for c in s:
        freqs[c] = freqs.get(c, 0) + 1
    return -sum((cnt / len(s)) * math.log2(cnt / len(s)) for cnt in freqs.values())

sap_large_corpus = [
    # Tables & Views
    'MARA', 'MARC', 'MARD', 'VBAK', 'VBAP', 'VBEP', 'VBKD', 'BKPF', 'BSEG',
    'BSIS', 'BSAS', 'BSIK', 'BSAK', 'BSID', 'BSAD', 'KNA1', 'KNB1', 'KNVV',
    'LFA1', 'LFB1', 'LFM1', 'EKKO', 'EKPO', 'EKET', 'EKKN', 'MKPF', 'MSEG',
    'SWWWIHEAD', 'SWWLOGHIST', 'SWW_WI2OBJ', 'SWETYPV', 'SWZAI', 'E070', 'E071',
    'E071K', 'E070A', 'E07T', 'BD61', 'BD50', 'BD52', 'BDCP', 'BDCPS', 'BDCP2',
    'CDHDR', 'CDPOS', 'DD02L', 'DD03L', 'DD04L', 'DD08L', 'USR02', 'USR04',
    'TBTCO', 'TBTCP', 'RFCDES', 'AGR_1251', 'AGR_AGRS', 'AGR_USERS', 'AGR_DEFINE',
    'AGR_FLAGS', 'AGR_TCODES', 'T030', 'T030K', 'VKOA', 'OBYC', 'FBKP', 'T001',
    'T001W', 'T005', 'TCURR', 'T003', 'TVKO', 'TVAK', 'TVAP', 'INOB', 'AUSP',
    'CABN', 'CAWN', 'TADIR', 'PROGDIR', 'TRDIR', 'TFDIR', 'ENLFDIR', 'STXH',
    'STXL', 'STXB', 'USOBT', 'USOBX', 'USOBHASH', 'S_START', 'S_SERVICE',
    'D010INC', 'D010TAB', 'ST03N', 'USMM', 'EDIDC', 'EDID4', 'BDLS',
    # S/4HANA CDS Views
    'I_PRODUCT_SALES_DELIVERY', 'C_SALESORDERITEMQUERY', 'I_PURCHASEORDERITEM_API01',
    'I_JOURNALENTRYITEM', 'I_BILLINGDOCUMENTITEM', 'C_FINANCIALSTATEMENTQUERY',
    'I_CUSTOMERPAYMENT', 'I_SUPPLIERINVOICEAPI01', 'I_MATERIALDOCUMENTHEADER',
    # ABAP Classes, Interfaces, BAPIs
    'CL_REST_HTTP_CLIENT_FACTORY', 'ZCL_PREFLIGHT_CONTROLLER_V2',
    'ZCX_CUSTOM_EXCEPTION_HANDLER', 'ZCL_EXT_IMPACT_GUARD_HELPER',
    'IF_HTTP_EXTENSION', 'IF_REST_APPLICATION', 'CL_ABAP_TYPEDESCR',
    'BAPI_SALESORDER_CREATEFROMDAT2', 'BAPI_MATERIAL_SAVEDATA',
    'BAPI_TRANSACTION_COMMIT', 'BAPI_CUSTOMER_GETINTNUMBER',
    # Namespaces & Packages
    '/COMPANY/ERP_MIGRATION_TOOL', '/SDF/RBE_METRIC_COLLECTOR',
    '/ERP/CORE_TRANS_DATA', '/CORP/FIN_RECONCILIATION_V2',
    '/UI5/SAP_LIB_CORE', '/SCWM/MFS_TELEGRAM_QUEUE',
    'Z_MIGRATION_RULE_ENGINE', 'Z_SAP_CLEAN_CORE_AUDITOR_RUN',
    'ZCUSTOM_TABLE_01', 'ZCUSTOM_FIELD_EXT_01',
    # Code words & log messages
    'CONFIGURATION_PARAMETER_NOT_FOUND', 'InternalServerErrorException',
    'ACCOUNT_DETERMINATION_OBYC_RULES', 'SELECT_SINGLE_FOR_UPDATE',
    'ASSIGN_COMPONENT_TO_FIELD_SYMBOL', 'FIELD-SYMBOLS', 'CLASS-METHODS'
]

results = []
for s in sap_large_corpus:
    clean = s.strip("'\"`,;:()[]{}")
    h = entropy(clean)
    max_h = math.log2(len(clean)) if len(clean) > 0 else 1.0
    results.append((h, len(clean), clean, h/max_h))

results.sort(reverse=True)
print(f"Top 10 highest entropy SAP objects across {len(sap_large_corpus)} objects:")
for h, length, obj, ratio in results[:10]:
    print(f"{obj:35s} | len={length:2d} | H={h:.4f} | maxH={math.log2(length):.4f} | ratio={ratio:.4f}")
