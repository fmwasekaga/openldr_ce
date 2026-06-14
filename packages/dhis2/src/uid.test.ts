import { describe, it, expect } from 'vitest';
import { dhis2Uid } from './uid';

describe('dhis2Uid', () => {
  it('is 11 chars, leading letter, alphanumeric', () => {
    const u = dhis2Uid('amr-to-dhis2-demo:obs-1');
    expect(u).toMatch(/^[A-Za-z][A-Za-z0-9]{10}$/);
  });
  it('is deterministic', () => expect(dhis2Uid('x:y')).toBe(dhis2Uid('x:y')));
  it('differs by seed', () => expect(dhis2Uid('a')).not.toBe(dhis2Uid('b')));
});
