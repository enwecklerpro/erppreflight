import math
import random
import re
import string

def entropy(s: str) -> float:
    freqs = {}
    for c in s:
        freqs[c] = freqs.get(c, 0) + 1
    return -sum((cnt / len(s)) * math.log2(cnt / len(s)) for cnt in freqs.values())

sap_identifiers = [
    'MARA', 'SWWWIHEAD', 'ZCUSTOM_TABLE_01', 'Z_MIGRATION_RULE_ENGINE',
    'I_PRODUCT_SALES_DELIVERY', 'ZCL_PREFLIGHT_CONTROLLER_V2',
    '/COMPANY/ERP_MIGRATION_TOOL', '/SDF/RBE_METRIC_COLLECTOR',
    'CONFIGURATION_PARAMETER_NOT_FOUND', 'InternalServerErrorException',
    'ACCOUNT_DETERMINATION_OBYC_RULES', 'CL_REST_HTTP_CLIENT_FACTORY',
    'SELECT_SINGLE_FOR_UPDATE', 'ASSIGN_COMPONENT_TO_FIELD_SYMBOL',
    'ZPREFLIGHT_MIGRATION_RUNNER_IMPL', 'SWWLOGHIST', 'AGR_USERS', 'T030K',
    'RFCDES', '/ERP/CORE_TRANS_DATA', 'CL_ABAP_TYPEDESCR',
    'BAPI_SALESORDER_CREATEFROMDAT2', 'ZCX_CUSTOM_EXCEPTION_HANDLER',
    'ZCL_EXT_IMPACT_GUARD_HELPER', 'C_SALESORDERITEMQUERY',
    'I_PURCHASEORDERITEM_API01', '/CORP/FIN_RECONCILIATION_V2',
    'Z_SAP_CLEAN_CORE_AUDITOR_RUN', 'DD04L_STRUCTURE_CHECK'
]

# Formulas to test:
def strategy_stepped_simple(L, h, is_hex):
    # As mentioned in prompt: length 16-23 threshold 3.80; length >= 24 threshold 4.50
    if is_hex and L >= 32 and h >= 3.2:
        return True
    if 16 <= L <= 23 and h >= 3.80:
        return True
    if L >= 24 and h >= 4.50:
        return True
    return False

def strategy_stepped_calibrated(L, h, is_hex):
    # Length-calibrated stepped:
    # 16-19: 3.75
    # 20-23: 3.80
    # 24-31: 4.10
    # >=32: 4.30
    if is_hex:
        if L >= 32 and h >= 3.2:
            return True
        if 16 <= L < 32 and h >= 3.0:
            return True
        return False
    if 16 <= L <= 19 and h >= 3.75:
        return True
    if 20 <= L <= 23 and h >= 3.80:
        return True
    if 24 <= L <= 31 and h >= 4.10:
        return True
    if L >= 32 and h >= 4.30:
        return True
    return False

def strategy_ratio_pure(L, h, is_hex):
    # Normalized ratio H / log2(L) >= 0.85
    if is_hex:
        return (L >= 32 and h >= 3.2) or (16 <= L < 32 and h >= 3.0)
    max_h = math.log2(L)
    return (h / max_h) >= 0.85

def strategy_hybrid_adaptive(L, h, is_hex):
    # Adaptive: min(4.30, 0.84 * log2(L)) for L >= 16
    if is_hex:
        return (L >= 32 and h >= 3.2) or (16 <= L < 32 and h >= 3.0)
    th = min(4.30, 0.84 * math.log2(L))
    return h >= th

strategies = [
    ('Stepped Simple (Prompt)', strategy_stepped_simple),
    ('Stepped Calibrated (16-19:3.75, 20-23:3.80, 24-31:4.10, >=32:4.30)', strategy_stepped_calibrated),
    ('Normalized Ratio (0.85)', strategy_ratio_pure),
    ('Adaptive min(4.30, 0.84*log2(L))', strategy_hybrid_adaptive)
]

print('=== FALSE POSITIVES ON SAP IDENTIFIERS (without allowlist check) ===')
for name, strat in strategies:
    fps = []
    for s in sap_identifiers:
        clean = s.strip("'\"`,;:()[]{}")
        if len(clean) < 16:
            continue
        is_hex = bool(re.match(r'^[0-9a-fA-F]+$', clean))
        h = entropy(clean)
        if strat(len(clean), h, is_hex):
            fps.append((clean, len(clean), h))
    print(f'{name:60s}: {len(fps)} false positives')
    for fp in fps:
        print(f'   -> {fp[0]} (L={fp[1]}, H={fp[2]:.2f})')

random.seed(42)
print('\n=== TRUE POSITIVES (DETECTION RATE %) ON RANDOM SECRETS ===')
for name, strat in strategies:
    print(f'\n-- {name} --')
    for L in [16, 20, 22, 24, 32, 64]:
        line = f'  L={L:2d}: '
        for kind, chars in [
            ('Hex', '0123456789abcdef'),
            ('Alnum', string.ascii_letters + string.digits),
            ('Base64', string.ascii_letters + string.digits + '+/=')
        ]:
            tokens = [''.join(random.choices(chars, k=L)) for _ in range(500)]
            det = sum(1 for t in tokens if strat(L, entropy(t), kind == 'Hex')) / len(tokens) * 100
            line += f'{kind}={det:5.1f}% | '
        print(line)
