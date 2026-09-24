const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = 'H:/erppreflight';
const skillsDir = path.join(repoRoot, '.agents', 'skills');
const playbooks = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));

const files = [
  path.join(repoRoot, 'AGENTS.md'),
  ...playbooks.map(p => path.join(skillsDir, p))
];

let totalBlocks = 0;
let tsBlocks = 0;
let pyBlocks = 0;
let jsonBlocks = 0;
const failures = [];

const pyScripts = [];

for (const file of files) {
  const relFile = path.relative(repoRoot, file);
  const content = fs.readFileSync(file, 'utf-8');
  
  // Regex to extract fenced code blocks
  const codeBlockRegex = /```([a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/g;
  let match;
  let blockIndex = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    blockIndex++;
    totalBlocks++;
    const lang = (match[1] || '').toLowerCase().trim();
    const code = match[2];

    if (['typescript', 'ts', 'tsx', 'javascript', 'js'].includes(lang)) {
      tsBlocks++;
      try {
        const sourceFile = ts.createSourceFile(
          `block_${blockIndex}.${lang.includes('x') ? 'tsx' : 'ts'}`,
          code,
          ts.ScriptTarget.Latest,
          true,
          lang.includes('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        );

        // Check for syntactic diagnostics
        const diagnostics = sourceFile.parseDiagnostics || [];
        if (diagnostics.length > 0) {
          const errors = diagnostics.map(d => {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(d.start);
            return `Line ${line + 1}, Col ${character + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
          });
          failures.push({
            file: relFile,
            blockIndex,
            lang,
            errors
          });
        }
      } catch (err) {
        failures.push({
          file: relFile,
          blockIndex,
          lang,
          errors: [err.message]
        });
      }
    } else if (['python', 'py'].includes(lang)) {
      pyBlocks++;
      pyScripts.push({
        file: relFile,
        blockIndex,
        code
      });
    } else if (lang === 'json') {
      jsonBlocks++;
      try {
        JSON.parse(code);
      } catch (err) {
        // Some json code blocks might have comments or placeholders, let's record
        failures.push({
          file: relFile,
          blockIndex,
          lang,
          errors: [err.message]
        });
      }
    }
  }
}

// Dump Python blocks to a temp json so python can parse them
fs.writeFileSync(
  path.join(__dirname, 'py_blocks.json'),
  JSON.stringify(pyScripts, null, 2),
  'utf-8'
);

console.log(`Extracted: Total=${totalBlocks}, TS/TSX=${tsBlocks}, Python=${pyBlocks}, JSON=${jsonBlocks}`);
if (failures.length > 0) {
  console.log(`Found ${failures.length} syntax failures in TS/JSON:`);
  for (const f of failures) {
    console.log(`[${f.file}] Block #${f.blockIndex} (${f.lang}):`);
    for (const e of f.errors) {
      console.log(`   - ${e}`);
    }
  }
} else {
  console.log('SUCCESS: All TypeScript, TSX, JS, and JSON code blocks passed AST parsing without syntax errors!');
}
