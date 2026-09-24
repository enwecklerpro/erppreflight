const fs = require('fs');
const path = require('path');

const SKILLS_DIR = 'H:/erppreflight/.agents/skills';
const AGENTS_MD_PATH = 'H:/erppreflight/AGENTS.md';

const noDepSoupRules = [
  { concern: 'Headless UI Primitives', approved: 'Base UI', forbidden: ['Radix UI', 'Ark UI', 'Chakra UI', 'MUI', 'Ant Design'] },
  { concern: 'Form Management', approved: 'TanStack Form', forbidden: ['React Hook Form', 'Formik'] },
  { concern: 'Server State & Caching', approved: 'TanStack Query', forbidden: ['RTK Query', 'SWR', 'Apollo Client'] },
  { concern: 'Client State Management', approved: 'URL Parameters', forbidden: ['Redux', 'MobX', 'Recoil'] },
  { concern: 'Application Router', approved: 'Next.js App Router', forbidden: ['TanStack Router', 'TanStack Start'] },
  { concern: 'Database ORM', approved: 'Drizzle ORM', forbidden: ['Prisma', 'TypeORM', 'Sequelize'] },
  { concern: 'Interactive Graph Canvas', approved: '@xyflow/react', forbidden: ['Cytoscape', 'Vis.js', 'mxGraph'] },
  { concern: 'Analytics & Charts', approved: 'Apache ECharts', forbidden: ['Chart.js', 'Recharts', 'Victory'] },
  { concern: 'Job Queue & Background Tasks', approved: 'BullMQ', forbidden: ['Kue', 'Bee-Queue', 'Celery'] },
  { concern: 'Runtime Validation', approved: 'Zod 4', forbidden: ['Joi', 'Yup'] }
];

const playbooks = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));

const analysis = {};

for (const rule of noDepSoupRules) {
  analysis[rule.concern] = {
    approved: rule.approved,
    forbidden: rule.forbidden,
    mentionedInPlaybooks: []
  };

  for (const pb of playbooks) {
    const content = fs.readFileSync(path.join(SKILLS_DIR, pb), 'utf-8');
    const approvedFound = new RegExp(rule.approved.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i').test(content);
    const forbiddenMatches = rule.forbidden.filter(f => new RegExp(f.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i').test(content));

    if (approvedFound || forbiddenMatches.length > 0) {
      analysis[rule.concern].mentionedInPlaybooks.push({
        playbook: pb,
        approvedFound,
        forbiddenMatches
      });
    }
  }
}

fs.writeFileSync('H:/erppreflight/.agents/challenger_m1_2/no_dependency_soup_analysis.json', JSON.stringify(analysis, null, 2));
console.log('Analysis written to no_dependency_soup_analysis.json');
