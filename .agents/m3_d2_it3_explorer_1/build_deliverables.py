"""
Script to generate proposed_ecc2cloud.py and proposed_test_fix.py
"""

from pathlib import Path

# Paths
root = Path(__file__).resolve().parent.parent.parent
ecc_path = root / "services" / "analysis-python" / "src" / "engines" / "ecc2cloud.py"
test_path = root / ".agents" / "m3_d2_challenger_1" / "test_adversarial_spro_ecc.py"
out_ecc = Path(__file__).resolve().parent / "proposed_ecc2cloud.py"
out_test = Path(__file__).resolve().parent / "proposed_test_fix.py"

print(f"Reading original ecc2cloud from {ecc_path}...")
with open(ecc_path, "r", encoding="utf-8") as f:
    ecc_lines = f.readlines()

print(f"Total lines in original ecc2cloud: {len(ecc_lines)}")

# Verify line 564 (1-indexed, so index 563)
assert "Case 2: Delimited CSV / TSV" in ecc_lines[563], f"Line 564 mismatch: {ecc_lines[563]}"
# Verify line 643 (index 642)
assert "else:" in ecc_lines[642], f"Line 643 mismatch: {ecc_lines[642]}"

# Slices:
# ecc_lines[:563] is lines 1 to 563
# replacement block
# ecc_lines[642:] is lines 643 to end

replacement_block = [
    '        # Case 2: Delimited CSV / TSV\n',
    '        sample_line = next((l for l in clean.splitlines() if not l.strip().startswith("#") and l.strip()), (clean.splitlines()[0] if clean.splitlines() else ""))\n',
    '        delimiter = "\\t" if "\\t" in sample_line else ("," if "," in sample_line else None)\n',
    '        lines = content.splitlines()\n',
    '\n',
    '        if delimiter:\n',
    '            reader = csv.reader(io.StringIO(content), delimiter=delimiter)\n',
    '            header: Optional[List[str]] = None\n',
    '            name_idx, type_idx, exec_idx, resp_idx, user_idx = 0, -1, -1, -1, -1\n',
    '\n',
    '            for line_idx, row in enumerate(reader, start=1):\n',
    '                if not row or all(not cell.strip() for cell in row):\n',
    '                    continue\n',
    '                if row[0].strip().startswith("#"):\n',
    '                    continue\n',
    '                snippet = lines[line_idx - 1] if line_idx <= len(lines) else ",".join(row)\n',
    '\n',
    '                # Header detection\n',
    '                if header is None and any(term in "".join(row).lower() for term in ["tcode", "transaction", "object_name", "object_type", "interface_name", "execution_count", "dialog_steps"]):\n',
    '                    header = [c.strip().lower() for c in row]\n',
    '                    for col_idx, col_name in enumerate(header):\n',
    '                        if any(k in col_name for k in ["user_count", "users", "user"]):\n',
    '                            user_idx = col_idx\n',
    '                        elif any(k in col_name for k in ["object_type", "type"]):\n',
    '                            type_idx = col_idx\n',
    '                        elif any(k in col_name for k in ["tcode", "transaction", "object_name", "interface_name", "name"]) or col_name == "object":\n',
    '                            name_idx = col_idx\n',
    '                        elif any(k in col_name for k in ["executions", "steps", "dialog_steps", "usage"]) or col_name == "count" or "exec" in col_name:\n',
    '                            exec_idx = col_idx\n',
    '                        elif any(k in col_name for k in ["response_time", "resp_time", "resptime", "responsetime", "response"]):\n',
    '                            resp_idx = col_idx\n',
    '                    continue\n',
    '\n',
    '                # Data row\n',
    '                name = row[name_idx].strip() if 0 <= name_idx < len(row) else ""\n',
    '                obj_type = row[type_idx].strip().upper() if 0 <= type_idx < len(row) else ""\n',
    '                \n',
    '                # Infer object type if not explicit\n',
    '                if not obj_type:\n',
    '                    if name.startswith("BAPI_"):\n',
    '                        obj_type = "BAPI"\n',
    '                    elif name.startswith("RFC_") or "RFC" in name:\n',
    '                        obj_type = "RFC"\n',
    '                    elif any(name.startswith(p) for p in ["ORDERS", "INVOIC", "DESADV", "DEBMAS", "CREMAS", "MATMAS"]):\n',
    '                        obj_type = "IDOC"\n',
    '                    else:\n',
    '                        obj_type = "TCODE"\n',
    '\n',
    '                exec_val = 1\n',
    '                if 0 <= exec_idx < len(row):\n',
    '                    try:\n',
    '                        clean_num = "".join(ch for ch in row[exec_idx] if ch.isdigit() or ch == ".")\n',
    '                        exec_val = int(float(clean_num)) if clean_num else 1\n',
    '                    except Exception:\n',
    '                        exec_val = 1\n',
    '                elif header is None and len(row) > 1:\n',
    '                    try:\n',
    '                        clean_num = "".join(ch for ch in row[1] if ch.isdigit() or ch == ".")\n',
    '                        if clean_num:\n',
    '                            exec_val = int(float(clean_num))\n',
    '                    except Exception:\n',
    '                        pass\n',
    '\n',
    '                resp_val = None\n',
    '                if 0 <= resp_idx < len(row):\n',
    '                    try:\n',
    '                        resp_val = float(row[resp_idx].strip())\n',
    '                    except Exception:\n',
    '                        pass\n',
    '                elif header is None and len(row) > 2:\n',
    '                    try:\n',
    '                        resp_val = float(row[2].strip())\n',
    '                    except Exception:\n',
    '                        pass\n',
    '\n',
    '                user_val = None\n',
    '                if 0 <= user_idx < len(row):\n',
    '                    try:\n',
    '                        user_val = int(row[user_idx].strip())\n',
    '                    except Exception:\n',
    '                        pass\n',
    '                elif header is None and len(row) > 3:\n',
    '                    try:\n',
    '                        user_val = int(row[3].strip())\n',
    '                    except Exception:\n',
    '                        pass\n',
    '\n',
    '                if name:\n',
    '                    items.append(EccUsageItem(\n',
    '                        object_name=name,\n',
    '                        object_type=obj_type,\n',
    '                        executions=max(0, exec_val),\n',
    '                        response_time_ms=resp_val,\n',
    '                        user_count=user_val,\n',
    '                        line_number=line_idx,\n',
    '                        column_number=1,\n',
    '                        raw_snippet=snippet,\n',
    '                        artifact_path=artifact_path,\n',
    '                    ))\n',
]

new_ecc_lines = ecc_lines[:563] + replacement_block + ecc_lines[642:]

with open(out_ecc, "w", encoding="utf-8") as f:
    f.writelines(new_ecc_lines)

print(f"Successfully generated {out_ecc} ({len(new_ecc_lines)} lines).")
