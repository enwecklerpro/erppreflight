import { describe, it, expect } from 'vitest';
import { companionFileNameKey } from '../src/modules/jobs/analysis-executor';

describe('P7: FormDoctor companion artifacts carry their uploaded file name', () => {
  it('maps *_content configuration keys to *_file_name keys', () => {
    expect(companionFileNameKey('xdp_content')).toBe('xdp_file_name');
    expect(companionFileNameKey('xml_content')).toBe('xml_file_name');
  });

  it('ignores keys that are not companion content keys', () => {
    expect(companionFileNameKey('bindings')).toBeNull();
    expect(companionFileNameKey('XDP_CONTENT')).toBeNull();
    expect(companionFileNameKey('__proto___content')).toBeNull();
  });
});
