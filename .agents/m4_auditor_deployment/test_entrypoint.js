const fs = require('fs');

const content = fs.readFileSync('infra/docker/api-entrypoint.sh', 'utf8');
const lines = content.split('\n');
const nodeLines = [];
let inNode = false;

for (const line of lines) {
  if (line.includes('node -e "')) {
    inNode = true;
    continue;
  }
  if (inNode && line.trim() === '"') {
    inNode = false;
    break;
  }
  if (inNode) {
    nodeLines.push(line);
  }
}

const jsCode = nodeLines.join('\n');
console.log('Extracted lines:', nodeLines.length);

try {
  new Function(jsCode);
  console.log('SYNTAX VALIDATION: SUCCESS (No JS syntax errors)');
} catch (err) {
  console.error('SYNTAX VALIDATION: FAILED', err);
  process.exit(1);
}
