const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { execSync } = require('child_process');

const SKILLS_DIR = path.resolve('H:/erppreflight/.agents/skills');
const AGENTS_MD_PATH = path.resolve('H:/erppreflight/AGENTS.md');

const EXPECTED_PLAYBOOKS = [
  'frontend-design-system.md',
  'data-table-and-large-list.md',
  'dependency-graph.md',
  'engine-authoring.md',
  'sap-evidence.md',
  'release-aware-knowledge.md',
  'secure-file-parser.md',
  'multi-tenant-security.md'
];

const results = {
  playbooksPresent: {},
  structuralElements: {},
  syntaxChecks: {
    typescript: [],
    python: [],
    json: []
  },
  agentsMdChecks: {},
  issues: []
};

// 1. Check all 8 playbooks exist
for (const file of EXPECTED_PLAYBOOKS) {
  const fullPath = path.join(SKILLS_DIR, file);
  const exists = fs.existsSync(fullPath);
  results.playbooksPresent[file] = exists;
  if (!exists) {
    results.issues.push(`Missing expected playbook: ${file}`);
  }
}

// Helper to extract code blocks from markdown
function extractCodeBlocks(markdown) {
  const codeBlockRegex = /```([a-zA-Z0-9_\-\+]+)?\r?\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    blocks.push({
      lang: (match[1] || '').trim().toLowerCase(),
      code: match[2],
      index: match.index
    });
  }
  return blocks;
}

// 2. Check each playbook structure and extract snippets
for (const file of EXPECTED_PLAYBOOKS) {
  const fullPath = path.join(SKILLS_DIR, file);
  if (!fs.existsSync(fullPath)) continue;

  const content = fs.readFileSync(fullPath, 'utf8');
  const lower = content.toLowerCase();

  const hasTriggers = lower.includes('trigger');
  const hasInvariants = lower.includes('invariant');
  const hasAntiPatterns = lower.includes('anti-pattern');

  results.structuralElements[file] = {
    hasTriggers,
    hasInvariants,
    hasAntiPatterns,
    lineCount: content.split('\n').length
  };

  if (!hasTriggers) results.issues.push(`${file} is missing trigger conditions`);
  if (!hasInvariants) results.issues.push(`${file} is missing invariants section`);
  if (!hasAntiPatterns) results.issues.push(`${file} is missing anti-patterns section`);

  const blocks = extractCodeBlocks(content);
  for (let i = 0; i < blocks.length; i++) {
    const { lang, code } = blocks[i];

    if (['ts', 'tsx', 'typescript', 'javascript', 'js'].includes(lang)) {
      const scriptKind = (lang === 'tsx' || lang === 'jsx' || code.includes('<') && code.includes('>')) 
        ? ts.ScriptKind.TSX 
        : ts.ScriptKind.TS;

      const sourceFile = ts.createSourceFile(
        `${file}_block_${i}.${lang.includes('x') ? 'tsx' : 'ts'}`,
        code,
        ts.ScriptTarget.Latest,
        true,
        scriptKind
      );

      // Extract parse diagnostics
      const diagnostics = sourceFile.parseDiagnostics || [];
      if (diagnostics.length > 0) {
        const errors = diagnostics.map(d => {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(d.start);
          const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
          return `Line ${line + 1}, col ${character + 1}: ${message}`;
        });
        results.syntaxChecks.typescript.push({
          file,
          blockIndex: i,
          lang,
          valid: false,
          errors,
          codePreview: code.slice(0, 100)
        });
        results.issues.push(`TypeScript syntax error in ${file} block ${i} (${lang}): ${errors.join('; ')}`);
      } else {
        results.syntaxChecks.typescript.push({
          file,
          blockIndex: i,
          lang,
          valid: true
        });
      }
    } else if (lang === 'python' || lang === 'py') {
      // Collect for python check
      results.syntaxChecks.python.push({
        file,
        blockIndex: i,
        code
      });
    } else if (lang === 'json') {
      try {
        JSON.parse(code);
        results.syntaxChecks.json.push({
          file,
          blockIndex: i,
          valid: true
        });
      } catch (err) {
        results.syntaxChecks.json.push({
          file,
          blockIndex: i,
          valid: false,
          error: err.message,
          codePreview: code.slice(0, 100)
        });
        results.issues.push(`JSON parse error in ${file} block ${i}: ${err.message}`);
      }
    }
  }
}

// 3. Check Python snippets via py.exe
const pythonBlocksFile = path.resolve('H:/erppreflight/.agents/challenger_m1_1/temp_py_blocks.json');
fs.writeFileSync(pythonBlocksFile, JSON.stringify(results.syntaxChecks.python, null, 2), 'utf8');

const pythonVerifier = `
import json, ast, sys

with open(r"${pythonBlocksFile.replace(/\\/g, '\\\\')}", "r", encoding="utf-8") as f:
    blocks = json.load(f)

py_results = []
issues = []
for b in blocks:
    code = b["code"]
    file = b["file"]
    idx = b["blockIndex"]
    try:
        ast.parse(code)
        py_results.append({"file": file, "blockIndex": idx, "valid": True})
    except SyntaxError as e:
        err = f"Line {e.lineno}, col {e.offset}: {e.msg}"
        py_results.append({"file": file, "blockIndex": idx, "valid": False, "error": err, "code": code[:100]})
        issues.append(f"Python syntax error in {file} block {idx}: {err}")

with open(r"${path.resolve('H:/erppreflight/.agents/challenger_m1_1/temp_py_results.json').replace(/\\/g, '\\\\')}", "w", encoding="utf-8") as f:
    json.dump({"results": py_results, "issues": issues}, f, indent=2)
`;

fs.writeFileSync(path.resolve('H:/erppreflight/.agents/challenger_m1_1/temp_verify_py.py'), pythonVerifier, 'utf8');

try {
  execSync('py H:/erppreflight/.agents/challenger_m1_1/temp_verify_py.py', { encoding: 'utf8' });
  const pyOut = JSON.parse(fs.readFileSync(path.resolve('H:/erppreflight/.agents/challenger_m1_1/temp_py_results.json'), 'utf8'));
  results.syntaxChecks.python = pyOut.results;
  results.issues.push(...pyOut.issues);
} catch (e) {
  results.issues.push(`Failed to run Python verification: ${e.message}`);
}

// Clean up temp files
try {
  fs.unlinkSync(pythonBlocksFile);
  fs.unlinkSync(path.resolve('H:/erppreflight/.agents/challenger_m1_1/temp_verify_py.py'));
  fs.unlinkSync(path.resolve('H:/erppreflight/.agents/challenger_m1_1/temp_py_results.json'));
} catch (e) {}

// 4. Check AGENTS.md
if (fs.existsSync(AGENTS_MD_PATH)) {
  const agentsContent = fs.readFileSync(AGENTS_MD_PATH, 'utf8');
  results.agentsMdChecks.hasAxiom1 = agentsContent.includes('A page that renders is not a completed feature');
  results.agentsMdChecks.hasAxiom2 = agentsContent.includes('An engine without deterministic logic/evidence/fixtures is not complete');
  results.agentsMdChecks.has14Points = [
    'Metadata', 'Input Schema', 'Deterministic Parser', 'Pure Rule Evaluation',
    'Standard Finding Taxonomy', 'Cryptographic Evidence Chains',
    'Epistemic Confidence Classification', 'Curated Test Fixtures',
    'Automated Test Suite', 'Property-Based Testing', 'Telemetry & Metrics',
    'Report Serialization', 'Admin Visibility', 'Remediation Documentation'
  ].every(pt => agentsContent.includes(pt));

  // Check all referenced playbooks in AGENTS.md
  const playbookRefRegex = /`([a-z0-9\-_]+\.md)`/g;
  let match;
  const referencedPlaybooks = new Set();
  while ((match = playbookRefRegex.exec(agentsContent)) !== null) {
    referencedPlaybooks.add(match[1]);
  }

  results.agentsMdChecks.referencedPlaybooks = Array.from(referencedPlaybooks);
  for (const ref of referencedPlaybooks) {
    const pPath = path.join(SKILLS_DIR, ref);
    if (!fs.existsSync(pPath)) {
      results.issues.push(`AGENTS.md references non-existent playbook: ${ref}`);
    }
  }
} else {
  results.issues.push('AGENTS.md does not exist at root');
}

fs.writeFileSync(
  path.resolve('H:/erppreflight/.agents/challenger_m1_1/verification_output.json'),
  JSON.stringify(results, null, 2),
  'utf8'
);

console.log('Verification completed. Issues count:', results.issues.length);
if (results.issues.length > 0) {
  console.log('Issues found:\n' + results.issues.join('\n'));
} else {
  console.log('All checks passed cleanly!');
}
