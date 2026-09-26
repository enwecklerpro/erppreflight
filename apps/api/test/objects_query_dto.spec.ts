import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { QueryObjectsDto } from '../src/modules/objects/dto/object.dto';

/**
 * GET /projects/:id/objects receives page/pageSize as query strings. The DTO must
 * convert them before validation (the web inventory requests pageSize=1000).
 */
describe('QueryObjectsDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = { type: 'query' as const, metatype: QueryObjectsDto, data: '' };

  it('accepts numeric query strings and converts them', async () => {
    const out = (await pipe.transform({ page: '1', pageSize: '1000' }, meta)) as QueryObjectsDto;
    expect(out.page).toBe(1);
    expect(out.pageSize).toBe(1000);
  });

  it('rejects out-of-range or non-numeric paging', async () => {
    await expect(pipe.transform({ page: '0' }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ pageSize: '5000' }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ pageSize: 'abc' }, meta)).rejects.toBeDefined();
  });
});
