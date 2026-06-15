import { describe, it, expect } from 'vitest';
import { resolveSeedPublisherId } from './seed-publishers';

describe('resolveSeedPublisherId', () => {
  it('maps loinc → pub-loinc and unknown → pub-system', () => {
    expect(resolveSeedPublisherId('http://loinc.org')).toBe('pub-loinc');
    expect(resolveSeedPublisherId('http://example.org/x')).toBe('pub-system');
  });
});
