import os
import ast
import re

skills_dir = 'H:/erppreflight/.agents/skills'
files = [f for f in os.listdir(skills_dir) if f.endswith('.md')]

total_blocks = 0
errors = 0

code_block_regex = re.compile(r'```python\n([\s\S]*?)```')

for file_name in files:
    file_path = os.path.join(skills_dir, file_name)
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    blocks = code_block_regex.findall(content)
    for i, code in enumerate(blocks, 1):
        total_blocks += 1
        try:
            ast.parse(code)
            print(f"PASS: {file_name} python block #{i}")
        except Exception as e:
            print(f"ERROR in {file_name} python block #{i}: {e}")
            errors += 1

print(f"\nPython Syntax Check Complete: {total_blocks} code blocks checked, {errors} errors.")
exit(1 if errors > 0 else 0)
