import math
import random
import string

def entropy(s: str) -> float:
    if not s:
        return 0.0
    freqs = {}
    for c in s:
        freqs[c] = freqs.get(c, 0) + 1
    return -sum((cnt / len(s)) * math.log2(cnt / len(s)) for cnt in freqs.values())

sap_examples = [
    'MARA',
    'SWWWIHEAD',
    'ZCUSTOM_TABLE_01',
    'Z_MIGRATION_RULE_ENGINE',
    'I_PRODUCT_SALES_DELIVERY',
    'ZCL_PREFLIGHT_CONTROLLER_V2',
    '/COMPANY/ERP_MIGRATION_TOOL',
    '/SDF/RBE_METRIC_COLLECTOR',
    'CONFIGURATION_PARAMETER_NOT_FOUND',
    'InternalServerErrorException',
    'ACCOUNT_DETERMINATION_OBYC_RULES',
    'CL_REST_HTTP_CLIENT_FACTORY',
    'SELECT_SINGLE_FOR_UPDATE',
    'ASSIGN_COMPONENT_TO_FIELD_SYMBOL',
    'ZPREFLIGHT_MIGRATION_RUNNER_IMPL',
    'SWWLOGHIST',
    'AGR_USERS',
    'T030K',
    'RFCDES',
    '/ERP/CORE_TRANS_DATA',
    'CL_ABAP_TYPEDESCR',
    'BAPI_SALESORDER_CREATEFROMDAT2',
    'ZCX_CUSTOM_EXCEPTION_HANDLER',
]

print("=== SAP / NATURAL IDENTIFIERS ===")
for s in sap_examples:
    clean = s.strip("'\"`,;:()[]{}")
    h = entropy(clean)
    max_h = math.log2(len(clean)) if len(clean) > 0 else 1.0
    ratio = h / max_h
    print(f"{clean:35s} | len={len(clean):2d} | H={h:.4f} | maxH={max_h:.4f} | ratio={ratio:.4f}")

random.seed(42)
print("\n=== RANDOM SECRETS (SIMULATED: 500 samples per bucket) ===")
for L in [16, 20, 22, 24, 32, 64]:
    for kind, chars in [
        ('Hex', '0123456789abcdef'),
        ('Alphanumeric', string.ascii_letters + string.digits),
        ('Base64', string.ascii_letters + string.digits + '+/=')
    ]:
        samples = []
        for _ in range(500):
            token = ''.join(random.choices(chars, k=L))
            h = entropy(token)
            samples.append(h)
        avg_h = sum(samples) / len(samples)
        min_h = min(samples)
        max_h = max(samples)
        theoretical_max = math.log2(L)
        avg_ratio = avg_h / theoretical_max
        min_ratio = min_h / theoretical_max
        print(f"{kind:12s} L={L:2d} | avg_H={avg_h:.3f} | min_H={min_h:.3f} | max_H={max_h:.3f} | theo_max={theoretical_max:.3f} | min_ratio={min_ratio:.3f} | avg_ratio={avg_ratio:.3f}")
