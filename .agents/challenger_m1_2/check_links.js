const fs = require('fs');
const path = require('path');

const SKILLS_DIR = 'H:/erppreflight/.agents/skills';
const AGENTS_MD_PATH = 'H:/erppreflight/AGENTS.md';

const filesToCheck = [
  AGENTS_MD_PATH,
  ...fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md')).map(f => path.join(SKILLS_DIR, f))
];

const fileRefRegex = /(?:`|\()([a-zA-Z0-9_\-\.\/]+\.(?:md|ts|tsx|py|json|css|sql|worker\.ts))(?:`|\))/g;

const foundRefs = [];

for (const filePath of filesToCheck) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let m;
  while ((m = fileRefRegex.exec(content)) !== null) {
    foundRefs.push({
      source: path.basename(filePath),
      ref: m[1]
    });
  }
}

// Check markdown file references specifically
const mdRefs = foundRefs.filter(r => r.ref.endsWith('.md'));
const invalidMdRefs = [];

for (const r of mdRefs) {
  const normalized = path.basename(r.ref);
  const existsInSkills = fs.existsSync(path.join(SKILLS_DIR, normalized));
  const existsInRoot = fs.existsSync(path.join('H:/erppreflight', normalized));
  const existsInAgents = fs.existsSync(path.join('H:/erppreflight/.agents', normalized));
  
  if (!existsInSkills && !existsInRoot && !existsInAgents) {
    invalidMdRefs.push({ ...r, normalized });
  }
}

console.log('Invalid MD references:', JSON.stringify(invalidMdRefs, null, 2));
fs.writeFileSync('H:/erppreflight/.agents/challenger_m1_2/invalid_md_refs.json', JSON.stringify(invalidMdRefs, null, 2));
