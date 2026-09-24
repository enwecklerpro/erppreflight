import math

def entropy(s: str) -> float:
    freqs = {}
    for c in s:
        freqs[c] = freqs.get(c, 0) + 1
    return -sum((cnt / len(s)) * math.log2(cnt / len(s)) for cnt in freqs.values())

vectors = [
    # Length 16
    ("Hex 16", "4f9b8c2e1d0a3f5b", 16, True),
    ("Alnum 16", "k9Z1mP4vL8wQ2xR7", 16, False),
    ("Base64 16", "dGVzdF9zZWNyZXRf", 16, False),

    # Length 20
    ("Hex 20", "4f9b8c2e1d0a3f5b7c8e", 20, True),
    ("Alnum 20 (Unique)", "abcdefghijklmnopqrst", 20, False),
    ("Alnum 20 (Realistic)", "k9Z1mP4vL8wQ2xR7jA3b", 20, False),
    ("Base64 20", "c2VjcmV0X3Rva2VuXzEy", 20, False),

    # Length 22
    ("Hex 22", "4f9b8c2e1d0a3f5b7c8e9d", 22, True),
    ("Alnum 22 (Unique)", "abcdefghijklmnopqrstuv", 22, False),
    ("Alnum 22 (Realistic)", "k9Z1mP4vL8wQ2xR7jA3bC5", 22, False),
    ("Base64 22", "YWJjZGVmZ2hpamtsbW5vcA", 22, False),

    # Length 24
    ("Hex 24", "4f9b8c2e1d0a3f5b7c8e9d0a", 24, True),
    ("Alnum 24 (Unique)", "abcdefghijklmnopqrstuvwx", 24, False),
    ("Alnum 24 (Realistic)", "k9Z1mP4vL8wQ2xR7jA3bC5dE", 24, False),
    ("Base64 24", "ZXhwZWN0ZWRfc2VjcmV0XzI0", 24, False),

    # Length 32
    ("Hex 32", "4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e", 32, True),
    ("Alnum 32", "k9Z1mP4vL8wQ2xR7jA3bC5dEfG8hI0jK", 32, False),
    ("Base64 32", "dGVzdF9zZWNyZXRfdG9rZW5fMzJfYnl0", 32, False),

    # Length 64
    ("Hex 64", "4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c", 64, True),
    ("Alnum 64", "k9Z1mP4vL8wQ2xR7jA3bC5dEfG8hI0jKlMnOpQrStUvWxYz0123456789AbCdEfGh", 64, False),
    ("Base64 64", "dGVzdF9zZWNyZXRfdG9rZW5fNjRfYnl0ZXNfZm9yX2VudHJvcHlfdmFsaWRhdGlvbg==", 64, False),
]

print(f"{'Category':24s} | {'Len':3s} | {'Entropy':7s} | {'Max log2(L)':11s} | {'Ratio':6s} | {'Prompt Stepped':14s} | {'Calibrated Stepped':18s}")
print("-" * 105)

for cat, token, L, is_hex in vectors:
    h = entropy(token)
    max_h = math.log2(L)
    ratio = h / max_h
    # Prompt stepped: 16-23: 3.80 (non-hex), >=24: 4.50 (non-hex), hex: L>=32 & h>=3.2
    if is_hex:
        p_step = (L >= 32 and h >= 3.2)
        c_step = (L >= 32 and h >= 3.2) or (16 <= L < 32 and h >= 3.0)
    else:
        p_step = (16 <= L <= 23 and h >= 3.80) or (L >= 24 and h >= 4.50)
        c_step = (16 <= L <= 19 and h >= 3.75) or (20 <= L <= 23 and h >= 3.80) or (24 <= L <= 31 and h >= 4.00) or (L >= 32 and h >= 4.30)

    p_str = "PASS (REDACT)" if p_step else "FAIL (LEAK)"
    c_str = "PASS (REDACT)" if c_step else "FAIL (LEAK)"
    print(f"{cat:24s} | {L:3d} | {h:7.4f} | {max_h:11.4f} | {ratio:6.4f} | {p_str:14s} | {c_str:18s}")
