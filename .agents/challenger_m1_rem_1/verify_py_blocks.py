import json
import ast
import os

with open("H:/erppreflight/.agents/challenger_m1_rem_1/py_blocks.json", "r", encoding="utf-8") as f:
    blocks = json.load(f)

failures = []
for b in blocks:
    code = b["code"]
    try:
        ast.parse(code)
    except SyntaxError as e:
        failures.append({
            "file": b["file"],
            "blockIndex": b["blockIndex"],
            "error": f"Line {e.lineno}, Col {e.offset}: {e.msg}"
        })

if failures:
    print(f"Found {len(failures)} Python syntax errors:")
    for f in failures:
        print(f"[{f['file']}] Block #{f['blockIndex']}: {f['error']}")
else:
    print(f"SUCCESS: All {len(blocks)} Python code blocks passed ast.parse() with 0 syntax errors!")
