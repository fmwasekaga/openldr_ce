import { describe, expect, it } from 'vitest';
import { INDEX_SCHEMA_VERSION, ROOT_CODE } from './types';

describe('ontology types', () => {
  it('defines the shared root code and index schema version', () => {
    expect(ROOT_CODE).toBe('__ROOT__');
    expect(INDEX_SCHEMA_VERSION).toBe(1);
  });
});
