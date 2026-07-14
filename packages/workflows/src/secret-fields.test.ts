import { describe, it, expect } from 'vitest';
import {
  AUTH_HEADER_RE,
  isSecretRef,
  mapSecretFields,
  mapSecretFieldsAsync,
  forEachSecretField,
  type SecretFieldRef,
} from './secret-fields';
import { secretRefSchema } from './types';

function sampleDefinition() {
  return {
    nodes: [
      { id: 't1', type: 'trigger', data: { triggerType: 'webhook', path: 'hook', secret: 'sup3r-secret' } },
      {
        id: 'h1',
        type: 'action',
        data: {
          action: 'http-request',
          headers: {
            Authorization: 'Bearer tok',
            'X-Custom-Token': 'ref-me',
            'Content-Type': 'application/json',
            'X-Keep': 'yes',
          },
        },
      },
      // A non-webhook node with a `secret` field must be IGNORED (secret is webhook-only).
      { id: 'n1', type: 'action', data: { action: 'log', secret: 'not-a-secret-field' } },
    ],
    edges: [],
  };
}

describe('AUTH_HEADER_RE', () => {
  it('matches auth-bearing header keys (case-insensitive)', () => {
    for (const k of ['authorization', 'Authorization', 'proxy-authorization', 'cookie', 'x-api-key', 'X-Custom-Token', 'x-refresh-token']) {
      expect(AUTH_HEADER_RE.test(k)).toBe(true);
    }
  });
  it('ignores non-secret headers', () => {
    for (const k of ['content-type', 'accept', 'x-keep', 'user-agent']) {
      expect(AUTH_HEADER_RE.test(k)).toBe(false);
    }
  });
});

describe('isSecretRef', () => {
  it('is true for a well-formed ref', () => {
    expect(isSecretRef({ secretRef: 'x' })).toBe(true);
  });
  it('is false for a plaintext string / {} / null / wrong-typed ref', () => {
    expect(isSecretRef('plaintext')).toBe(false);
    expect(isSecretRef({})).toBe(false);
    expect(isSecretRef(null)).toBe(false);
    expect(isSecretRef(undefined)).toBe(false);
    expect(isSecretRef({ secretRef: 1 })).toBe(false);
  });
});

describe('forEachSecretField', () => {
  it('finds the webhook secret + auth headers, ignores everything else', () => {
    const paths: string[] = [];
    const values: unknown[] = [];
    forEachSecretField(sampleDefinition(), (f) => { paths.push(f.path); values.push(f.value); });

    expect(paths).toEqual([
      't1.data.secret',
      'h1.data.headers.Authorization',
      'h1.data.headers.X-Custom-Token',
    ]);
    expect(values).toEqual(['sup3r-secret', 'Bearer tok', 'ref-me']);
    // The non-secret header and the non-webhook `secret` are absent.
    expect(paths).not.toContain('h1.data.headers.Content-Type');
    expect(paths).not.toContain('h1.data.headers.X-Keep');
    expect(paths).not.toContain('n1.data.secret');
  });

  it('does not mutate the input', () => {
    const def = sampleDefinition();
    const snapshot = structuredClone(def);
    forEachSecretField(def, () => {});
    expect(def).toEqual(snapshot);
  });

  it('handles a definition with no nodes / non-object safely', () => {
    expect(() => forEachSecretField(null, () => { throw new Error('should not be called'); })).not.toThrow();
    expect(() => forEachSecretField({}, () => { throw new Error('should not be called'); })).not.toThrow();
    expect(() => forEachSecretField({ nodes: 'nope' }, () => { throw new Error('should not be called'); })).not.toThrow();
  });
});

describe('mapSecretFields', () => {
  it('does NOT mutate the input and returns a new definition', () => {
    const def = sampleDefinition();
    const snapshot = structuredClone(def);
    const out = mapSecretFields(def, (f) => f.set('***')) as ReturnType<typeof sampleDefinition>;

    // Input untouched.
    expect(def).toEqual(snapshot);
    expect(out).not.toBe(def);
    // Output has masked values.
    expect(out.nodes[0].data.secret).toBe('***');
    expect((out.nodes[1].data.headers as Record<string, string>).Authorization).toBe('***');
    expect((out.nodes[1].data.headers as Record<string, string>)['X-Custom-Token']).toBe('***');
    // Non-secret fields preserved.
    expect(out.nodes[0].data.path).toBe('hook');
    expect((out.nodes[1].data.headers as Record<string, string>)['X-Keep']).toBe('yes');
    expect((out.nodes[1].data.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('set(undefined) deletes the field in the clone only', () => {
    const def = sampleDefinition();
    const out = mapSecretFields(def, (f) => f.set(undefined)) as ReturnType<typeof sampleDefinition>;

    expect('secret' in out.nodes[0].data).toBe(false);
    const headers = out.nodes[1].data.headers as Record<string, string>;
    expect('Authorization' in headers).toBe(false);
    expect('X-Custom-Token' in headers).toBe(false);
    // Input still has them.
    expect(def.nodes[0].data.secret).toBe('sup3r-secret');
    expect((def.nodes[1].data.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('can write a {secretRef} value', () => {
    const def = sampleDefinition();
    const out = mapSecretFields(def, (f: SecretFieldRef) => f.set({ secretRef: 'sec-1' })) as ReturnType<typeof sampleDefinition>;
    expect(out.nodes[0].data.secret).toEqual({ secretRef: 'sec-1' });
    expect(isSecretRef(out.nodes[0].data.secret)).toBe(true);
  });

  it('leaves an existing {secretRef} value intact when told to', () => {
    const def = {
      nodes: [{ id: 't1', type: 'webhook', data: { secret: { secretRef: 'sec-1' } } }],
      edges: [],
    };
    const out = mapSecretFields(def, (f) => { if (!isSecretRef(f.value)) f.set('***'); }) as typeof def;
    expect(out.nodes[0].data.secret).toEqual({ secretRef: 'sec-1' });
  });

  it('recognises the plain `webhook` node type too', () => {
    const def = { nodes: [{ id: 'w', type: 'webhook', data: { secret: 'shh' } }], edges: [] };
    const paths: string[] = [];
    forEachSecretField(def, (f) => paths.push(f.path));
    expect(paths).toEqual(['w.data.secret']);
  });
});

describe('mapSecretFieldsAsync', () => {
  it('awaits fn and writes into the clone without mutating input', async () => {
    const def = sampleDefinition();
    const snapshot = structuredClone(def);
    const seen: string[] = [];
    const out = await mapSecretFieldsAsync(def, async (f) => {
      await Promise.resolve();
      seen.push(f.path);
      f.set({ secretRef: `sec-${seen.length}` });
    }) as ReturnType<typeof sampleDefinition>;

    expect(seen).toEqual(['t1.data.secret', 'h1.data.headers.Authorization', 'h1.data.headers.X-Custom-Token']);
    expect(def).toEqual(snapshot); // input untouched
    expect(out.nodes[0].data.secret).toEqual({ secretRef: 'sec-1' });
    expect((out.nodes[1].data.headers as Record<string, unknown>).Authorization).toEqual({ secretRef: 'sec-2' });
  });
});

describe('secretRefSchema', () => {
  it('accepts a well-formed ref', () => {
    expect(secretRefSchema.parse({ secretRef: 'x' })).toEqual({ secretRef: 'x' });
  });
  it('rejects a numeric secretRef, a missing secretRef, and extra keys', () => {
    expect(secretRefSchema.safeParse({ secretRef: 1 }).success).toBe(false);
    expect(secretRefSchema.safeParse({}).success).toBe(false);
    expect(secretRefSchema.safeParse({ secretRef: 'x', extra: 1 }).success).toBe(false);
  });
});
