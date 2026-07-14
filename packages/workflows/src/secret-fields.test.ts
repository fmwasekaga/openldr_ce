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
          config: {
            url: 'https://example.com',
            headers: { Authorization: 'Bearer tok', 'X-Keep': 'yes' },
          },
        },
      },
      // A non-webhook node with a `secret` field must be IGNORED (secret is webhook-only).
      { id: 'n1', type: 'action', data: { action: 'log', secret: 'not-a-secret-field' } },
    ],
    edges: [],
  };
}

/** Wrap a bare `config.headers` value in a minimal HTTP-node definition. */
function withHeaders(headers: unknown) {
  return { nodes: [{ id: 'h', type: 'action', data: { config: { headers } } }], edges: [] };
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
  it('finds the webhook secret + the HTTP headers blob, ignores everything else', () => {
    const seen: Array<{ value: unknown; path: string }> = [];
    forEachSecretField(sampleDefinition(), (f) => seen.push(f));

    expect(seen.map((s) => s.path)).toEqual(['t1.data.secret', 'h1.data.config.headers']);
    // The headers field surfaces the WHOLE blob, not per-key.
    expect(seen[0].value).toBe('sup3r-secret');
    expect(seen[1].value).toEqual({ Authorization: 'Bearer tok', 'X-Keep': 'yes' });
    // The non-webhook `secret` is absent.
    expect(seen.map((s) => s.path)).not.toContain('n1.data.secret');
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

describe('config.headers blob detection', () => {
  it('surfaces an OBJECT headers blob containing an auth header (whole value)', () => {
    const seen: Array<{ value: unknown; path: string }> = [];
    forEachSecretField(withHeaders({ Authorization: 'Bearer x', 'X-Keep': 'y' }), (f) => seen.push(f));
    expect(seen).toEqual([{ path: 'h.data.config.headers', value: { Authorization: 'Bearer x', 'X-Keep': 'y' } }]);
  });

  it('surfaces a JSON-STRING headers blob containing an auth header (whole string)', () => {
    const json = JSON.stringify({ 'X-Api-Key': 'k', Accept: 'json' });
    const seen: Array<{ value: unknown; path: string }> = [];
    forEachSecretField(withHeaders(json), (f) => seen.push(f));
    expect(seen).toEqual([{ path: 'h.data.config.headers', value: json }]);
  });

  it('surfaces an already-sealed {secretRef} headers blob (so it round-trips)', () => {
    const seen: Array<{ value: unknown; path: string }> = [];
    forEachSecretField(withHeaders({ secretRef: 'sec-9' }), (f) => seen.push(f));
    expect(seen).toEqual([{ path: 'h.data.config.headers', value: { secretRef: 'sec-9' } }]);
  });

  it('skips a headers blob with only non-auth headers (object)', () => {
    const seen: string[] = [];
    forEachSecretField(withHeaders({ 'Content-Type': 'application/json', Accept: '*/*' }), (f) => seen.push(f.path));
    expect(seen).toEqual([]);
  });

  it('skips a headers blob with only non-auth headers (JSON string)', () => {
    const seen: string[] = [];
    forEachSecretField(withHeaders(JSON.stringify({ 'Content-Type': 'application/json' })), (f) => seen.push(f.path));
    expect(seen).toEqual([]);
  });

  it('skips a non-JSON / template headers string without crashing', () => {
    const seen: string[] = [];
    expect(() => forEachSecretField(withHeaders('{{ $node.headers }}'), (f) => seen.push(f.path))).not.toThrow();
    expect(seen).toEqual([]);
  });

  it('set replaces the WHOLE config.headers blob (clone only)', () => {
    const def = withHeaders({ Authorization: 'Bearer x' });
    const out = mapSecretFields(def, (f) => f.set({ secretRef: 'sec-1' })) as typeof def;
    expect(out.nodes[0].data.config.headers).toEqual({ secretRef: 'sec-1' });
    // Input untouched.
    expect(def.nodes[0].data.config.headers).toEqual({ Authorization: 'Bearer x' });
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
    // Output has masked values (headers blob replaced whole).
    expect(out.nodes[0].data.secret).toBe('***');
    expect(out.nodes[1].data.config!.headers).toBe('***');
    // Non-secret fields preserved.
    expect(out.nodes[0].data.path).toBe('hook');
    expect(out.nodes[1].data.config!.url).toBe('https://example.com');
  });

  it('set(undefined) deletes the field in the clone only', () => {
    const def = sampleDefinition();
    const out = mapSecretFields(def, (f) => f.set(undefined)) as ReturnType<typeof sampleDefinition>;

    expect('secret' in out.nodes[0].data).toBe(false);
    expect('headers' in out.nodes[1].data.config!).toBe(false);
    // Input still has them.
    expect(def.nodes[0].data.secret).toBe('sup3r-secret');
    expect(def.nodes[1].data.config!.headers).toBeDefined();
  });

  it('can write a {secretRef} value', () => {
    const def = sampleDefinition();
    const out = mapSecretFields(def, (f: SecretFieldRef) => f.set({ secretRef: 'sec-1' })) as ReturnType<typeof sampleDefinition>;
    expect(out.nodes[0].data.secret).toEqual({ secretRef: 'sec-1' });
    expect(out.nodes[1].data.config!.headers).toEqual({ secretRef: 'sec-1' });
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

    expect(seen).toEqual(['t1.data.secret', 'h1.data.config.headers']);
    expect(def).toEqual(snapshot); // input untouched
    expect(out.nodes[0].data.secret).toEqual({ secretRef: 'sec-1' });
    expect(out.nodes[1].data.config!.headers).toEqual({ secretRef: 'sec-2' });
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
