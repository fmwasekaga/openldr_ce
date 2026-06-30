# Slice B — Tier-2 Format/Codec Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up 6 "Coming soon" format/codec workflow nodes — `crypto`, `jwt`, `xml`, `markdown`, `html-extract`, `html` — each a CPU-only host handler backed by a parsing library, no DB/network/egress.

**Architecture:** Same host-node pattern as Slice A: each node is a `NodeHandler` registered in `node-handlers/index.ts` `ACTION_HANDLERS`, plus a `HOST_NODE_DESCRIPTORS` entry (so `DeclarativeNodeForm` auto-renders its config) and its id in `IMPLEMENTED_TEMPLATE_IDS` with a palette default config. `crypto` uses the `node:crypto` builtin; `jwt` uses `jose` (already in the monorepo); `xml`/`markdown`/`html-extract`/`html` add `fast-xml-parser`/`marked`+`turndown`/`cheerio`.

**Tech Stack:** TypeScript, Vitest, `@openldr/workflows` engine, `node:crypto`, `jose`, `fast-xml-parser`, `marked`, `turndown`, `cheerio`.

**Out of scope:** Tier-3 binary/file nodes (read-pdf, spreadsheet, etc.), all connectors, engine control-flow.

---

## Key facts (verified, carried from Slice A)

- **Handler signature** (`packages/workflows/src/engine/node-handlers/types.ts`): `(node: RunnerNode, ctx: ExecutionContext, input: WorkflowItem[]) => Promise<WorkflowItem[]> | WorkflowItem[]`. `RunnerNode = { id, type, data: Record<string,unknown> }`. `WorkflowItem = { json: Record<string,unknown> }`.
- **Dispatch**: action nodes route via `ACTION_HANDLERS[node.data.action]` in `node-handlers/index.ts`. The `node()` factory in `constants.ts` sets `defaultData.action = id` (no subtitle passed), so each node id is its action key.
- **Config UI**: any unregistered action node falls through to `DeclarativeNodeForm`, which fetches `HOST_NODE_DESCRIPTORS` and renders the descriptor whose `id === node.data.action`. So each node needs a descriptor with `config[]`.
- **CRITICAL gotcha (broke Slice A's typecheck):** `WorkflowConfigField.required` is a NON-optional boolean (z.infer; `.default(false)` does NOT make it optional). **Every** descriptor config field object MUST include `required: true | false` or `tsc` fails TS2741.
- **`WorkflowConfigField`** = `{ key, label, type, required, default?, options?: {value,label}[], optionsSource?, detailSource? }`; `type ∈ text|number|boolean|select|multiselect|file|json`. Use `json` for structured config (e.g. html-extract rules).
- **No server changes**: the registry serves `HOST_NODE_DESCRIPTORS` at `/api/workflows/nodes` automatically.
- **Palette entries already exist** in `constants.ts`: `crypto` (Files & Storage category), `html`/`html-extract`/`markdown`/`xml`/`jwt` (Data Transformation). Each is `action` type. We replace each with a version carrying a default `config`, and add its id to `IMPLEMENTED_TEMPLATE_IDS`.
- Handlers run host-side (NOT sandboxed). These are pure transforms with no egress. `fast-xml-parser` does not resolve external entities by default (no XXE). Library output strings (e.g. marked HTML) are data only — not rendered by the host.

## Library API notes (confirm against installed versions during Task 1)

- **jose v5**: `import { SignJWT, jwtVerify, decodeJwt } from 'jose'`. Secret is a `Uint8Array` (`new TextEncoder().encode(secret)`). Sign: `await new SignJWT(payload).setProtectedHeader({ alg }).sign(key)`. Verify: `const { payload } = await jwtVerify(token, key)`. Decode (no verify): `decodeJwt(token)`.
- **fast-xml-parser v4**: `import { XMLParser, XMLBuilder } from 'fast-xml-parser'`. `new XMLParser().parse(xmlString)` → object; `new XMLBuilder().build(obj)` → string.
- **marked v12+**: `import { marked } from 'marked'`. `marked.parse(md)` returns a string in sync mode (default). Cast `as string`.
- **turndown v7**: CommonJS default export. `import TurndownService from 'turndown'`; `new TurndownService().turndown(html)`. Needs dev dep `@types/turndown`.
- **cheerio v1**: `import * as cheerio from 'cheerio'`. `const $ = cheerio.load(html); $(sel).text() / .html() / .attr(name)`.

> **Implementer note for every library node:** if the installed version's import shape or method differs from the above, adjust the import/usage to match the installed version and make `tsc` pass — the API patterns here are the intent, not a version contract. `tsc --noEmit` is the gate.

## Test command

Single file: `pnpm -C packages/workflows exec vitest run <path>`
Typecheck: `pnpm -C packages/workflows exec tsc --noEmit` (MUST be exit 0 before reporting any task done).

## File structure

- **Modify**: `packages/workflows/package.json` (deps), `packages/workflows/src/engine/node-handlers/index.ts` (register 6 handlers), `packages/workflows/src/host-nodes.ts` (6 descriptors), `apps/web/src/workflows/constants.ts` (6 ids + default configs).
- **Create** (handlers + tests): `packages/workflows/src/engine/node-handlers/{crypto,jwt,xml,markdown,html-extract,html}.ts` + `.test.ts` each.

---

## Task 1: Add dependencies

**Files:** Modify `packages/workflows/package.json`.

- [ ] **Step 1: Add runtime + type dependencies.** Edit `packages/workflows/package.json`. Add to `dependencies` (keep alphabetical-ish; versions: match `jose` to the repo's existing `^5.9.6`, others latest stable major shown):

```jsonc
  "dependencies": {
    "@openldr/db": "workspace:*",
    "@openldr/marketplace": "workspace:*",
    "@openldr/ports": "workspace:*",
    "cheerio": "^1.0.0",
    "cron-parser": "^4.9.0",
    "fast-xml-parser": "^4.5.0",
    "jose": "^5.9.6",
    "kysely": "^0.27.5",
    "marked": "^14.1.0",
    "turndown": "^7.2.0",
    "zod": "3.24.0"
  },
```

And add to `devDependencies`:

```jsonc
  "devDependencies": {
    "@types/turndown": "^5.0.5",
    "pg-mem": "^3.0.14",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
```

- [ ] **Step 2: Install from the repo root.**

Run: `pnpm install`
Expected: resolves and links the new packages; exit 0. (If a listed version is unresolvable, pick the nearest existing stable major and note it.)

- [ ] **Step 3: Confirm imports resolve.** Create a throwaway check (do NOT commit it) to confirm the install + import shapes:

Run: `pnpm -C packages/workflows exec node -e "import('jose').then(m=>console.log('jose',!!m.SignJWT)); import('fast-xml-parser').then(m=>console.log('fxp',!!m.XMLParser)); import('marked').then(m=>console.log('marked',!!m.marked)); import('cheerio').then(m=>console.log('cheerio',!!m.load)); import('turndown').then(m=>console.log('turndown',!!(m.default))); "`
Expected: each prints `true`. If `turndown` prints false under `.default`, note the actual export shape for Task 5.

- [ ] **Step 4: Confirm the package still typechecks + tests green.**

Run: `pnpm -C packages/workflows exec tsc --noEmit && pnpm -C packages/workflows test`
Expected: tsc exit 0; all existing tests pass (228 baseline).

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/package.json pnpm-lock.yaml
git commit -m "build(workflows): add jose/fast-xml-parser/marked/turndown/cheerio deps for codec nodes"
```

---

## Task 2: `crypto` node (node:crypto, no dep)

Hash or HMAC a field value. Output hex/base64 digest into `outputField`.

**Files:** Create `crypto.ts` + `crypto.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import nodeCrypto from 'node:crypto';
import { cryptoHandler } from './crypto';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'cy1', type: 'action', data: { action: 'crypto', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('cryptoHandler', () => {
  it('hashes a field with sha256 hex by default', async () => {
    const expected = nodeCrypto.createHash('sha256').update('hello').digest('hex');
    const result = await cryptoHandler(node({ operation: 'hash', algorithm: 'sha256', field: 'v', outputField: 'digest', encoding: 'hex' }), ctx(), [{ json: { v: 'hello' } }]);
    expect((result[0].json as Record<string, unknown>).digest).toBe(expected);
  });

  it('computes an hmac with a secret', async () => {
    const expected = nodeCrypto.createHmac('sha256', 'k').update('hello').digest('hex');
    const result = await cryptoHandler(node({ operation: 'hmac', algorithm: 'sha256', secret: 'k', field: 'v', outputField: 'sig', encoding: 'hex' }), ctx(), [{ json: { v: 'hello' } }]);
    expect((result[0].json as Record<string, unknown>).sig).toBe(expected);
  });

  it('supports base64 encoding', async () => {
    const expected = nodeCrypto.createHash('sha256').update('x').digest('base64');
    const result = await cryptoHandler(node({ operation: 'hash', algorithm: 'sha256', field: 'v', outputField: 'd', encoding: 'base64' }), ctx(), [{ json: { v: 'x' } }]);
    expect((result[0].json as Record<string, unknown>).d).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/crypto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/crypto.ts`:

```typescript
import nodeCrypto from 'node:crypto';
import type { NodeHandler } from './types';

/** Hash or HMAC a field value into outputField. Pure CPU; no key-pair management. */
export const cryptoHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'hash';
  const algorithm = (config.algorithm as string) || 'sha256';
  const field = (config.field as string) ?? '';
  const outputField = (config.outputField as string) || 'digest';
  const encoding = ((config.encoding as string) || 'hex') as 'hex' | 'base64';
  const secret = (config.secret as string) ?? '';

  return input.map((item) => {
    const value = String(item.json[field] ?? '');
    const digest = operation === 'hmac'
      ? nodeCrypto.createHmac(algorithm, secret).update(value).digest(encoding)
      : nodeCrypto.createHash(algorithm).update(value).digest(encoding);
    return { json: { ...item.json, [outputField]: digest } };
  });
};
```

- [ ] **Step 4: Register handler.** In `index.ts` add the import and the `ACTION_HANDLERS` entry:

```typescript
import { cryptoHandler } from './crypto';
```
```typescript
  'crypto': cryptoHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts` Transforms block add (every field has `required`):

```typescript
  { id: 'crypto', source: 'host', label: 'Crypto', kind: 'transform', description: 'Hash or HMAC a value.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'hash', label: 'Hash' }, { value: 'hmac', label: 'HMAC' }] }, { key: 'algorithm', label: 'Algorithm', type: 'select', required: false, options: [{ value: 'sha256', label: 'SHA-256' }, { value: 'sha512', label: 'SHA-512' }, { value: 'sha1', label: 'SHA-1' }, { value: 'md5', label: 'MD5' }] }, { key: 'field', label: 'Input field', type: 'text', required: true }, { key: 'secret', label: 'Secret (HMAC only)', type: 'text', required: false }, { key: 'encoding', label: 'Output encoding', type: 'select', required: false, options: [{ value: 'hex', label: 'Hex' }, { value: 'base64', label: 'Base64' }] }, { key: 'outputField', label: 'Output field', type: 'text', required: false }] },
```

- [ ] **Step 6: Config default + enable.** In `constants.ts` replace the `crypto` palette entry (Files & Storage category):

```typescript
      node('crypto', 'action', 'Crypto', 'KeyRound', 'Hash, HMAC', {
        data: { config: { operation: 'hash', algorithm: 'sha256', field: '', secret: '', encoding: 'hex', outputField: 'digest' } },
      }),
```

Add a `// codecs (slice B)` line to `IMPLEMENTED_TEMPLATE_IDS` (add the full set now; later tasks only add handler/descriptor):

```typescript
  // codecs (slice B)
  'crypto', 'jwt', 'xml', 'markdown', 'html-extract', 'html',
```

> Note: this enables all 6 ids up front for one clean edit. If you prefer strict per-task isolation, add only `'crypto'` here and one id per subsequent task.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/crypto.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/crypto.ts packages/workflows/src/engine/node-handlers/crypto.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement crypto node (hash/hmac)"
```

---

## Task 3: `jwt` node (jose)

Sign, verify, or decode a JWT (HS256 family, shared secret).

**Files:** Create `jwt.ts` + `jwt.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/jwt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { jwtHandler } from './jwt';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'jw1', type: 'action', data: { action: 'jwt', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('jwtHandler', () => {
  it('signs then verifies a payload round-trip', async () => {
    const signed = await jwtHandler(
      node({ operation: 'sign', secret: 's3cr3t', algorithm: 'HS256', payloadField: 'claims', outputField: 'token' }),
      ctx(),
      [{ json: { claims: { sub: 'u1', role: 'admin' } } }],
    );
    const token = (signed[0].json as Record<string, unknown>).token as string;
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const verified = await jwtHandler(
      node({ operation: 'verify', secret: 's3cr3t', tokenField: 'token', outputField: 'payload' }),
      ctx(),
      [{ json: { token } }],
    );
    const out = verified[0].json as Record<string, unknown>;
    expect(out.valid).toBe(true);
    expect((out.payload as Record<string, unknown>).sub).toBe('u1');
  });

  it('marks an invalid signature as not valid', async () => {
    const signed = await jwtHandler(
      node({ operation: 'sign', secret: 'right', payloadField: 'claims', outputField: 'token' }),
      ctx(),
      [{ json: { claims: { a: 1 } } }],
    );
    const token = (signed[0].json as Record<string, unknown>).token as string;
    const verified = await jwtHandler(
      node({ operation: 'verify', secret: 'wrong', tokenField: 'token', outputField: 'payload' }),
      ctx(),
      [{ json: { token } }],
    );
    expect((verified[0].json as Record<string, unknown>).valid).toBe(false);
  });

  it('decodes without verifying', async () => {
    const signed = await jwtHandler(
      node({ operation: 'sign', secret: 's', payloadField: 'claims', outputField: 'token' }),
      ctx(),
      [{ json: { claims: { hello: 'world' } } }],
    );
    const token = (signed[0].json as Record<string, unknown>).token as string;
    const decoded = await jwtHandler(
      node({ operation: 'decode', tokenField: 'token', outputField: 'payload' }),
      ctx(),
      [{ json: { token } }],
    );
    expect(((decoded[0].json as Record<string, unknown>).payload as Record<string, unknown>).hello).toBe('world');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/jwt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/jwt.ts`:

```typescript
import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/**
 * Sign / verify / decode JWTs (HS* shared-secret algorithms).
 *  - sign:   payloadField (object) → signed token in outputField
 *  - verify: tokenField → { [outputField]: payload, valid: boolean }
 *  - decode: tokenField → { [outputField]: payload } (no signature check)
 */
export const jwtHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'sign';
  const secret = (config.secret as string) ?? '';
  const algorithm = (config.algorithm as string) || 'HS256';
  const payloadField = (config.payloadField as string) ?? '';
  const tokenField = (config.tokenField as string) || 'token';
  const outputField = (config.outputField as string) || (operation === 'sign' ? 'token' : 'payload');
  const key = new TextEncoder().encode(secret);

  const out: WorkflowItem[] = [];
  for (const item of input) {
    if (operation === 'sign') {
      const payload = (payloadField ? item.json[payloadField] : item.json) as Record<string, unknown>;
      const token = await new SignJWT(payload ?? {}).setProtectedHeader({ alg: algorithm }).sign(key);
      out.push({ json: { ...item.json, [outputField]: token } });
    } else if (operation === 'verify') {
      const token = String(item.json[tokenField] ?? '');
      try {
        const { payload } = await jwtVerify(token, key);
        out.push({ json: { ...item.json, [outputField]: payload, valid: true } });
      } catch {
        out.push({ json: { ...item.json, [outputField]: null, valid: false } });
      }
    } else {
      const token = String(item.json[tokenField] ?? '');
      try {
        out.push({ json: { ...item.json, [outputField]: decodeJwt(token) } });
      } catch {
        out.push({ json: { ...item.json, [outputField]: null } });
      }
    }
  }
  return out;
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { jwtHandler } from './jwt';
```
```typescript
  'jwt': jwtHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'jwt', source: 'host', label: 'JWT', kind: 'transform', description: 'Sign, verify, or decode JSON Web Tokens.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'sign', label: 'Sign' }, { value: 'verify', label: 'Verify' }, { value: 'decode', label: 'Decode (no verify)' }] }, { key: 'secret', label: 'Secret (HS*)', type: 'text', required: false }, { key: 'algorithm', label: 'Algorithm', type: 'select', required: false, options: [{ value: 'HS256', label: 'HS256' }, { value: 'HS384', label: 'HS384' }, { value: 'HS512', label: 'HS512' }] }, { key: 'payloadField', label: 'Payload field (sign; blank = whole item)', type: 'text', required: false }, { key: 'tokenField', label: 'Token field (verify/decode)', type: 'text', required: false }, { key: 'outputField', label: 'Output field', type: 'text', required: false }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `jwt` entry:

```typescript
      node('jwt', 'action', 'JWT', 'KeyRound', 'Sign / verify JSON Web Tokens', {
        data: { config: { operation: 'sign', secret: '', algorithm: 'HS256', payloadField: '', tokenField: 'token', outputField: 'token' } },
      }),
```

(`'jwt'` already enabled via Task 2's codecs line.)

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/jwt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/jwt.ts packages/workflows/src/engine/node-handlers/jwt.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement jwt node (sign/verify/decode)"
```

---

## Task 4: `xml` node (fast-xml-parser)

Parse an XML string to JSON, or build an XML string from a JSON object.

**Files:** Create `xml.ts` + `xml.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/xml.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { xmlHandler } from './xml';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'xm1', type: 'action', data: { action: 'xml', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('xmlHandler', () => {
  it('parses XML into a JSON object', async () => {
    const result = await xmlHandler(
      node({ operation: 'parse', field: 'xml', outputField: 'data' }),
      ctx(),
      [{ json: { xml: '<root><a>1</a><b>two</b></root>' } }],
    );
    const data = (result[0].json as Record<string, unknown>).data as Record<string, unknown>;
    expect((data.root as Record<string, unknown>).a).toBe(1);
    expect((data.root as Record<string, unknown>).b).toBe('two');
  });

  it('builds XML from a JSON object', async () => {
    const result = await xmlHandler(
      node({ operation: 'build', field: 'obj', outputField: 'xml' }),
      ctx(),
      [{ json: { obj: { root: { a: 1 } } } }],
    );
    expect((result[0].json as Record<string, unknown>).xml).toContain('<root>');
    expect((result[0].json as Record<string, unknown>).xml).toContain('<a>1</a>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/xml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/xml.ts`:

```typescript
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { NodeHandler } from './types';

/** Parse XML→JSON or build JSON→XML. fast-xml-parser does not resolve external entities (no XXE). */
export const xmlHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'parse';
  const field = (config.field as string) || (operation === 'parse' ? 'xml' : 'data');
  const outputField = (config.outputField as string) || (operation === 'parse' ? 'data' : 'xml');

  return input.map((item) => {
    const value = item.json[field];
    if (operation === 'build') {
      const xml = new XMLBuilder().build(value);
      return { json: { ...item.json, [outputField]: xml } };
    }
    const parsed = new XMLParser().parse(String(value ?? ''));
    return { json: { ...item.json, [outputField]: parsed } };
  });
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { xmlHandler } from './xml';
```
```typescript
  'xml': xmlHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'xml', source: 'host', label: 'XML', kind: 'transform', description: 'Parse or build XML.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'parse', label: 'Parse (XML → JSON)' }, { value: 'build', label: 'Build (JSON → XML)' }] }, { key: 'field', label: 'Input field', type: 'text', required: false }, { key: 'outputField', label: 'Output field', type: 'text', required: false }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `xml` entry:

```typescript
      node('xml', 'action', 'XML', 'FileCode', 'Parse & build XML', {
        data: { config: { operation: 'parse', field: 'xml', outputField: 'data' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/xml.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/xml.ts packages/workflows/src/engine/node-handlers/xml.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement xml node (parse/build)"
```

---

## Task 5: `markdown` node (marked + turndown)

Convert Markdown→HTML or HTML→Markdown.

**Files:** Create `markdown.ts` + `markdown.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/markdown.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { markdownHandler } from './markdown';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'md1', type: 'action', data: { action: 'markdown', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('markdownHandler', () => {
  it('converts markdown to html', async () => {
    const result = await markdownHandler(
      node({ operation: 'markdownToHtml', field: 'md', outputField: 'html' }),
      ctx(),
      [{ json: { md: '# Title' } }],
    );
    expect((result[0].json as Record<string, unknown>).html as string).toContain('<h1');
    expect((result[0].json as Record<string, unknown>).html as string).toContain('Title');
  });

  it('converts html to markdown', async () => {
    const result = await markdownHandler(
      node({ operation: 'htmlToMarkdown', field: 'html', outputField: 'md' }),
      ctx(),
      [{ json: { html: '<h1>Title</h1>' } }],
    );
    expect((result[0].json as Record<string, unknown>).md as string).toContain('# Title');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/markdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/markdown.ts`:

```typescript
import { marked } from 'marked';
import TurndownService from 'turndown';
import type { NodeHandler } from './types';

const turndown = new TurndownService();

/** Convert Markdown↔HTML. */
export const markdownHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'markdownToHtml';
  const field = (config.field as string) || (operation === 'markdownToHtml' ? 'md' : 'html');
  const outputField = (config.outputField as string) || (operation === 'markdownToHtml' ? 'html' : 'md');

  return input.map((item) => {
    const value = String(item.json[field] ?? '');
    const converted = operation === 'htmlToMarkdown'
      ? turndown.turndown(value)
      : (marked.parse(value) as string);
    return { json: { ...item.json, [outputField]: converted } };
  });
};
```

> If `marked.parse` is typed as `string | Promise<string>` under the installed version, wrap with `await Promise.resolve(marked.parse(value))` and drop the cast. If `turndown`'s default import errors, use `import * as TurndownNS from 'turndown'; const TurndownService = (TurndownNS as { default: typeof import('turndown') }).default ?? TurndownNS;` — whatever makes `tsc` pass.

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { markdownHandler } from './markdown';
```
```typescript
  'markdown': markdownHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'markdown', source: 'host', label: 'Markdown', kind: 'transform', description: 'Convert between Markdown and HTML.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'markdownToHtml', label: 'Markdown → HTML' }, { value: 'htmlToMarkdown', label: 'HTML → Markdown' }] }, { key: 'field', label: 'Input field', type: 'text', required: false }, { key: 'outputField', label: 'Output field', type: 'text', required: false }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `markdown` entry:

```typescript
      node('markdown', 'action', 'Markdown', 'FileText', 'Convert to/from Markdown', {
        data: { config: { operation: 'markdownToHtml', field: 'md', outputField: 'html' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/markdown.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/markdown.ts packages/workflows/src/engine/node-handlers/markdown.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement markdown node (md<->html)"
```

---

## Task 6: `html-extract` node (cheerio)

Extract values from an HTML field via CSS-selector rules, merging results into the item.

**Files:** Create `html-extract.ts` + `html-extract.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/html-extract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { htmlExtractHandler } from './html-extract';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'he1', type: 'action', data: { action: 'html-extract', config: cfg } });
const ctx = () => createContext(undefined, () => {});
const html = '<div><h1 class="t">Hello</h1><a href="https://x.test">link</a></div>';

describe('htmlExtractHandler', () => {
  it('extracts text by selector', async () => {
    const result = await htmlExtractHandler(
      node({ sourceField: 'html', extractions: [{ key: 'title', selector: 'h1.t', returnValue: 'text' }] }),
      ctx(),
      [{ json: { html } }],
    );
    expect((result[0].json as Record<string, unknown>).title).toBe('Hello');
  });

  it('extracts an attribute', async () => {
    const result = await htmlExtractHandler(
      node({ sourceField: 'html', extractions: [{ key: 'href', selector: 'a', returnValue: 'attribute', attribute: 'href' }] }),
      ctx(),
      [{ json: { html } }],
    );
    expect((result[0].json as Record<string, unknown>).href).toBe('https://x.test');
  });

  it('returns empty string when selector matches nothing', async () => {
    const result = await htmlExtractHandler(
      node({ sourceField: 'html', extractions: [{ key: 'missing', selector: '.nope', returnValue: 'text' }] }),
      ctx(),
      [{ json: { html } }],
    );
    expect((result[0].json as Record<string, unknown>).missing).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/html-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/html-extract.ts`:

```typescript
import * as cheerio from 'cheerio';
import type { NodeHandler } from './types';

interface Extraction {
  key: string;
  selector: string;
  returnValue?: 'text' | 'html' | 'attribute';
  attribute?: string;
}

/** Extract values from an HTML field using CSS-selector rules. Each rule writes `key` onto the item. */
export const htmlExtractHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sourceField = (config.sourceField as string) || 'html';
  const extractions = (config.extractions as Extraction[] | undefined) ?? [];

  return input.map((item) => {
    const $ = cheerio.load(String(item.json[sourceField] ?? ''));
    const extracted: Record<string, unknown> = {};
    for (const rule of extractions) {
      if (!rule.key || !rule.selector) continue;
      const el = $(rule.selector);
      if (rule.returnValue === 'html') extracted[rule.key] = el.html() ?? '';
      else if (rule.returnValue === 'attribute') extracted[rule.key] = el.attr(rule.attribute ?? '') ?? '';
      else extracted[rule.key] = el.text().trim();
    }
    return { json: { ...item.json, ...extracted } };
  });
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { htmlExtractHandler } from './html-extract';
```
```typescript
  'html-extract': htmlExtractHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts` (extractions is a `json` field):

```typescript
  { id: 'html-extract', source: 'host', label: 'HTML Extract', kind: 'transform', description: 'Extract values from HTML via CSS selectors.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'sourceField', label: 'HTML field', type: 'text', required: false }, { key: 'extractions', label: 'Extractions ([{ "key", "selector", "returnValue": "text|html|attribute", "attribute" }])', type: 'json', required: true }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `html-extract` entry:

```typescript
      node('html-extract', 'action', 'HTML Extract', 'CodeXml', 'Parse HTML with CSS selectors', {
        data: { config: { sourceField: 'html', extractions: [] } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/html-extract.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/html-extract.ts packages/workflows/src/engine/node-handlers/html-extract.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement html-extract node (css selectors)"
```

---

## Task 7: `html` node (cheerio)

Convert an HTML field to plain text (strip tags, collapse whitespace). Single-purpose, distinct from `html-extract`.

**Files:** Create `html.ts` + `html.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/html.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { htmlHandler } from './html';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'ht1', type: 'action', data: { action: 'html', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('htmlHandler', () => {
  it('strips tags to plain text and collapses whitespace', async () => {
    const result = await htmlHandler(
      node({ field: 'html', outputField: 'text' }),
      ctx(),
      [{ json: { html: '<p>Hello   <b>world</b></p>\n<p>again</p>' } }],
    );
    expect((result[0].json as Record<string, unknown>).text).toBe('Hello world again');
  });

  it('returns empty string for empty input', async () => {
    const result = await htmlHandler(node({ field: 'html', outputField: 'text' }), ctx(), [{ json: { html: '' } }]);
    expect((result[0].json as Record<string, unknown>).text).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/html.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/html.ts`:

```typescript
import * as cheerio from 'cheerio';
import type { NodeHandler } from './types';

/** Convert HTML to plain text: strip tags, collapse runs of whitespace, trim. */
export const htmlHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) || 'html';
  const outputField = (config.outputField as string) || 'text';

  return input.map((item) => {
    const $ = cheerio.load(String(item.json[field] ?? ''));
    const text = $.root().text().replace(/\s+/g, ' ').trim();
    return { json: { ...item.json, [outputField]: text } };
  });
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { htmlHandler } from './html';
```
```typescript
  'html': htmlHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'html', source: 'host', label: 'HTML', kind: 'transform', description: 'Convert HTML to plain text.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'field', label: 'HTML field', type: 'text', required: false }, { key: 'outputField', label: 'Output field', type: 'text', required: false }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `html` entry:

```typescript
      node('html', 'action', 'HTML', 'Code2', 'Convert HTML to text', {
        data: { config: { field: 'html', outputField: 'text' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/html.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/html.ts packages/workflows/src/engine/node-handlers/html.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement html node (html->text)"
```

---

## Task 8: Full verification gate

- [ ] **Step 1: Typecheck the workflows package**

Run: `pnpm -C packages/workflows exec tsc --noEmit`
Expected: exit 0. (If a library import shape causes an error, fix the import/types per the library notes; do NOT suppress with `any`.)

- [ ] **Step 2: Run the workflows test suite**

Run: `pnpm -C packages/workflows test`
Expected: all pass — 228 baseline + 15 new (3 crypto, 3 jwt, 2 xml, 2 markdown, 3 html-extract, 2 html) = 243. The `host-nodes`/`node-registry` tests self-adjust to the 6 new descriptors.

- [ ] **Step 3: Typecheck the web package**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: exit 0 (constants.ts only — no type-level change).

- [ ] **Step 4: Run the web test suite (isolated — never trust a turbo `web#test` red)**

Run: `pnpm -C apps/web test`
Expected: pass (~584).

- [ ] **Step 5: Final commit (if any gate fixups)**

```bash
git add -A
git commit -m "test(workflows): slice B codec nodes — gate green"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** Slice B in the inventory spec = crypto, jwt, xml, markdown, html-extract, html. All 6 have tasks; Task 1 covers the dependency additions the spec implied ("one lib each"). ✔
- **Placeholder scan:** every code step has complete code; library-shape uncertainty is handled with explicit fallback instructions + the tsc gate, not TODOs. ✔
- **Type consistency:** all handlers use `NodeHandler`/`WorkflowItem`; all dispatch via `ACTION_HANDLERS[action]` (none are conditions); every descriptor config field includes `required` (the Slice-A regression guard). ✔
- **Scope:** `packages/workflows` (deps + handlers) + one web constants file; no server/DB. ✔
- **Design notes:** `html` is scoped to HTML→text to stay distinct from `html-extract` (CSS extraction); `crypto` is hash/hmac only (no key-pair/encrypt to avoid key management); `jwt` is HS* shared-secret only. These are deliberate MVP boundaries, not gaps.
