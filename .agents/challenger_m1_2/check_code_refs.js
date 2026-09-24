const fs = require('fs');
const path = require('path');

const SKILLS_DIR = 'H:/erppreflight/.agents/skills';
const AGENTS_MD_PATH = 'H:/erppreflight/AGENTS.md';

const filesToCheck = [
  ...fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md')).map(f => path.join(SKILLS_DIR, f))
];

const codePathRegex = /(?:\/\/|#|--)\s*([a-zA-Z0-9_\-\.\/]+\.(?:ts|tsx|py|json|css|sql))/g;

const codeRefs = [];

for (const filePath of filesToCheck) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let m;
  while ((m = codePathRegex.exec(content)) !== null) {
    codeRefs.push({
      playbook: path.basename(filePath),
      referencedFile: m[1]
    });
  }
}

console.log('Code references count:', codeRefs.length);
fs.writeFileSync('H:/erppreflight/.agents/challenger_m1_2/code_refs.json', JSON.stringify(codeRefs, null, 2));
