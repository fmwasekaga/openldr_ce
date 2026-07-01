import { describe, it, expect } from 'vitest';
import { mergeEnv } from './env-merge.mjs';

describe('mergeEnv', () => {
  it('updates existing keys in place, appends new ones, preserves comments/secrets/order', () => {
    const existing = [
      '# secrets below',
      'POSTGRES_PASSWORD=s3cret',
      'SERVER_NAME=localhost',
      '',
      '# trailing note',
    ].join('\n');
    const out = mergeEnv(existing, { SERVER_NAME: 'lab.example.org', PUBLIC_ORIGIN: 'https://lab.example.org' });
    expect(out).toContain('POSTGRES_PASSWORD=s3cret');       // secret preserved
    expect(out).toContain('SERVER_NAME=lab.example.org');    // updated in place
    expect(out).not.toContain('SERVER_NAME=localhost');
    expect(out).toContain('PUBLIC_ORIGIN=https://lab.example.org'); // appended
    expect(out).toContain('# trailing note');                // comment preserved
  });
  it('preserves the relative order of untouched lines and updates in place (not append) for existing keys', () => {
    const existing = 'A=1\nB=2\nC=3';
    const out = mergeEnv(existing, { B: '20' });
    // B updated where it was, A and C unchanged, no B appended at the end
    expect(out.split('\n').filter((l) => l.startsWith('B='))).toEqual(['B=20']);
    const lines = out.trim().split('\n');
    expect(lines[0]).toBe('A=1');
    expect(lines[1]).toBe('B=20');
    expect(lines[2]).toBe('C=3');
  });
  it('handles empty existing text by writing all keys', () => {
    const out = mergeEnv('', { X: '1', Y: '2' });
    expect(out.trim().split('\n')).toEqual(['X=1', 'Y=2']);
  });
});
