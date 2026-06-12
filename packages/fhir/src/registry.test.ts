import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { registerResource, getResourceSchema, listResourceTypes } from './registry';

describe('registry', () => {
  it('registers and retrieves a schema by resourceType', () => {
    const schema = z.object({ resourceType: z.literal('Demo') });
    registerResource('Demo', schema);
    expect(getResourceSchema('Demo')).toBe(schema);
    expect(getResourceSchema('Missing')).toBeUndefined();
    expect(listResourceTypes()).toContain('Demo');
  });
});
