import { z } from 'H:/erppreflight/packages/schemas/node_modules/zod';
import * as schemas from '@erppreflight/schemas';

console.log('Is CleanCoreTier a runtime value?', 'CleanCoreTier' in schemas);

// If someone wrote:
// import { CleanCoreTier } from '@erppreflight/schemas';
// z.nativeEnum(CleanCoreTier)
const CleanCoreTier = (schemas as any).CleanCoreTier;

try {
  const schema = z.object({
    targetTier: z.nativeEnum(CleanCoreTier),
  });
  console.log('Schema created successfully');
} catch (err: any) {
  console.log('Error creating schema with z.nativeEnum(CleanCoreTier):', err.message);
}

try {
  console.log('Accessing CleanCoreTier.TIER_1_CLOUD:', CleanCoreTier.TIER_1_CLOUD);
} catch (err: any) {
  console.log('Error accessing CleanCoreTier.TIER_1_CLOUD:', err.message);
}

// What should have been used:
console.log('CleanCoreTierEnum values:', schemas.CleanCoreTierEnum.options);
const correctSchema = z.object({
  targetTier: schemas.CleanCoreTierEnum,
});
console.log('Correct schema created successfully:', correctSchema.parse({ targetTier: 'TIER_1_CLOUD' }));
