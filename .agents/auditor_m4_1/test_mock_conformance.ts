import { SapObjectSchema } from '../../packages/schemas/src/sap-object';
import { generateMockSapObjects } from '../../apps/web/src/components/objects/types';

console.log('Generating sample of 1,000 objects from generateMockSapObjects and validating with SapObjectSchema...');

const sample = generateMockSapObjects(1000);
let valid = 0;
let errors: any[] = [];

for (let i = 0; i < sample.length; i++) {
  const parseRes = SapObjectSchema.safeParse(sample[i]);
  if (parseRes.success) {
    valid++;
  } else {
    errors.push({ index: i, error: parseRes.error.format() });
  }
}

console.log(`Validated ${valid} of ${sample.length} objects.`);
if (errors.length > 0) {
  console.error('Validation errors found:', JSON.stringify(errors.slice(0, 3), null, 2));
  process.exit(1);
} else {
  console.log('ALL generated SAP objects strictly conform to SapObjectSchema!');
}
