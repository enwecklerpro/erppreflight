import { CleanCoreTierEnum } from '@erppreflight/schemas';
// In packages/schemas, what is exported?
import * as schemas from '@erppreflight/schemas';

console.log('Schemas exports:', Object.keys(schemas));
console.log('CleanCoreTierEnum:', schemas.CleanCoreTierEnum);
console.log('CleanCoreTier value:', (schemas as any).CleanCoreTier);
