const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const skillsDir = 'H:/erppreflight/.agents/skills';
const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));

let totalBlocks = 0;
let errors = 0;

files.forEach(file => {
  const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
  const codeBlockRegex = /```(tsx?|typescript|javascript)\n([\s\S]*?)```/g;
  let match;
  let blockIndex = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    blockIndex++;
    totalBlocks++;
    const lang = match[1];
    const code = match[2];

    try {
      const result = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
        reportDiagnostics: true
      });

      const diags = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
      if (diags.length > 0) {
        console.error(`ERROR in ${file} block #${blockIndex} (${lang}):`);
        diags.forEach(d => {
          console.error(`  ${typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText}`);
        });
        errors++;
      } else {
        console.log(`PASS: ${file} block #${blockIndex} (${lang})`);
      }
    } catch (e) {
      console.error(`PARSE EXCEPTION in ${file} block #${blockIndex}:`, e.message);
      errors++;
    }
  }
});

console.log(`TypeScript Syntax Check Complete: ${totalBlocks} code blocks checked, ${errors} errors.`);
process.exit(errors > 0 ? 1 : 0);
