# Slice F — Communication Connectors (Email + SFTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add outbound email (`send-email`/`gmail`/`outlook` via nodemailer) and SFTP file transfer (`ftp` via ssh2-sftp-client) connector nodes on the existing connector foundation.

**Architecture:** One `email` handler backs all three email node ids; `createEmailTransport(type,config)` builds an smtp/gmail/outlook nodemailer transport (gmail/outlook = OAuth2, bring-your-own refresh token). `runConnectorEmail` + `runConnectorSftp` are new optional `WorkflowServices` methods with injectable-factory runners (mirroring Slice E). The `ftp` handler does binary I/O via the existing Slice-C `readBinary`/`writeBinary`. No data-model/migration change — new connector `type` values only.

**Tech Stack:** TypeScript, Vitest, `nodemailer`, `ssh2-sftp-client`, `@openldr/bootstrap`, `@openldr/workflows`, React + shadcn + i18n.

---

## Key facts (verified from Slices D/E)

- **Service runner pattern** (`packages/bootstrap/src/connector-mongo-service.ts` / `connector-redis-service.ts`): `createConnectorXRunner({ connectors: { get, getDecryptedConfig }, secretsKey, <factory>? })` → resolves `connectors.get(id)` (throw if missing/disabled, throw if wrong `type`), `getDecryptedConfig`, builds client via the injectable factory (defaulting to the real helper), runs op, closes in `finally`.
- **`WorkflowServices`** (`packages/workflows/src/engine/services.ts`): optional methods `runConnectorSql?`/`runConnectorMongo?`/`runConnectorRedis?` + Slice-C `readBinary?`/`writeBinary?`. Add `runConnectorEmail?`/`runConnectorSftp?` the same way.
- **bootstrap wiring** (`packages/bootstrap/src/index.ts`): `connectorStore` is declared before the `workflowServices` literal; each runner is constructed just before it and added as a literal member (`runConnectorMongo: (input) => connectorMongoRunner(input)` etc.). Follow this for email/sftp.
- **Handler dispatch**: `ACTION_HANDLERS[node.data.action]`. Descriptors in `host-nodes.ts` — every config field MUST have `required: true|false`. `port(name)` helper exists. Palette + `IMPLEMENTED_TEMPLATE_IDS` in `apps/web/src/workflows/constants.ts`. `resolveTemplate` + `rowsToItems` in `packages/workflows/src/engine/`.
- **`connector-test.ts`** (`packages/bootstrap/src/`): `testConnector(type, config, deps: ConnectorTestDeps = {})`; `ConnectorTestDeps = { sqlDb?, mongo?, redis? }`; SQL set + mongo + redis branches; throws on unknown. Extend with `email`/`sftp`. Route `/api/connectors/:id/test` already calls `testConnector(connector.type, config)` — no route change.
- **Options resolver**: `connectors:<type>` already generic — no change.
- **Connectors UI** (`apps/web/src/pages/settings/Connectors.tsx`): `HOST_TYPES` array + `CONNECTOR_TYPE_FIELDS: Record<string, TypeField[]>` (`TypeField = { key, labelKey, kind: 'text'|'number'|'password'|'boolean' }`); create payload `{ name, type, config }`; the create-required rule. i18n keys under `settings.connectors.*` in `apps/web/src/i18n/{en,fr,pt}.ts`.
- **Slice-C binary services**: `ctx.services.writeBinary({bytes,fileName,contentType})→BinaryRef`, `ctx.services.readBinary(objectKey)→Uint8Array` — the `ftp` handler uses these.
- **Cross-package tsc gate**: optional WorkflowServices additions + new bootstrap code → `tsc` `packages/workflows`, `packages/bootstrap`, `apps/server`, `apps/web`.

## Library API notes (confirm in Task 1)

- **nodemailer**: `import nodemailer from 'nodemailer'` (default export). `nodemailer.createTransport(config) → Transporter`; `await transporter.sendMail({ from, to, cc, subject, text, html }) → { messageId, accepted, rejected }`; `await transporter.verify()`; `transporter.close()`. Gmail OAuth2: `createTransport({ service:'gmail', auth:{ type:'OAuth2', user, clientId, clientSecret, refreshToken } })`. Outlook OAuth2: `createTransport({ host:'smtp.office365.com', port:587, secure:false, auth:{ type:'OAuth2', user, clientId, clientSecret, refreshToken, accessUrl } })`.
- **ssh2-sftp-client**: `import Client from 'ssh2-sftp-client'` (default export class). `const c = new Client(); await c.connect({ host, port, username, password }); await c.get(remotePath) → Buffer; await c.put(Buffer, remotePath); await c.list(remotePath) → Array<{name,size,type,...}>; await c.delete(remotePath); await c.rename(from,to); await c.end();`.

> **Implementer note:** Task 1 confirms import shapes; adjust to the installed version and make `tsc` pass.

## Test commands
bootstrap/workflows/server/web `pnpm -C <pkg> exec vitest run <path>`; tsc `pnpm -C <pkg> exec tsc --noEmit`; web isolated `pnpm -C apps/web test`.

## File structure
- **Create:** `packages/bootstrap/src/connector-email.ts` (+test), `connector-email-service.ts` (+test), `connector-sftp-service.ts` (+test); `packages/workflows/src/engine/node-handlers/email.ts` (+test), `ftp.ts` (+test).
- **Modify:** `packages/bootstrap/package.json`, `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/connector-test.ts` (+test), `packages/workflows/src/engine/services.ts`, `packages/workflows/src/engine/node-handlers/index.ts`, `packages/workflows/src/host-nodes.ts`, `apps/web/src/workflows/constants.ts`, `apps/web/src/pages/settings/Connectors.tsx` (+test), `apps/web/src/i18n/{en,fr,pt}.ts`.

---

## Task 1: Add drivers

- [ ] **Step 1:** In `packages/bootstrap/package.json` `dependencies` add `"nodemailer": "^6.9.15"` and `"ssh2-sftp-client": "^11.0.0"`; in `devDependencies` add `"@types/nodemailer": "^6.4.16"`. (ssh2-sftp-client ships its own types.)
- [ ] **Step 2:** `pnpm install` (worktree root).
- [ ] **Step 3:** Confirm imports: `pnpm -C packages/bootstrap exec node --input-type=module -e "import nodemailer from 'nodemailer'; import Client from 'ssh2-sftp-client'; console.log('nodemailer.createTransport', typeof nodemailer.createTransport); const c = new Client(); console.log('sftp get/put/list/delete/rename/end', typeof c.get, typeof c.put, typeof c.list, typeof c.delete, typeof c.rename, typeof c.end);"` → all `function`. If `ssh2-sftp-client` default differs, note it.
- [ ] **Step 4:** `pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C packages/bootstrap test` → green (baseline 154).
- [ ] **Step 5:** Commit:
```bash
git add packages/bootstrap/package.json pnpm-lock.yaml
git commit -m "build(bootstrap): add nodemailer + ssh2-sftp-client for comms connectors"
```

---

## Task 2: Email transport helper + service

**Files:** Create `packages/bootstrap/src/connector-email.ts` (+test), `connector-email-service.ts` (+test); Modify `packages/workflows/src/engine/services.ts`, `packages/bootstrap/src/index.ts`.

- [ ] **Step 1:** Add to `WorkflowServices` (`services.ts`):
```typescript
  /** Send an email via a host connector (smtp/gmail/outlook). Host-injected. */
  runConnectorEmail?(input: { connectorId: string; to: string; subject: string; body: string; html?: boolean; cc?: string }): Promise<{ messageId: string; accepted: string[]; rejected: string[] }>;
```
- [ ] **Step 2:** Helper test `packages/bootstrap/src/connector-email.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createEmailTransport } from './connector-email';

describe('createEmailTransport', () => {
  it('builds an smtp transport with basic auth', () => {
    const make = vi.fn(() => ({}) as never);
    createEmailTransport('smtp', { host: 'mail', port: '587', user: 'u', password: 'p', secure: 'false' }, make);
    expect(make).toHaveBeenCalledWith(expect.objectContaining({ host: 'mail', port: 587, secure: false, auth: { user: 'u', pass: 'p' } }));
  });
  it('builds a gmail OAuth2 transport', () => {
    const make = vi.fn(() => ({}) as never);
    createEmailTransport('gmail', { user: 'u@gmail.com', clientId: 'ci', clientSecret: 'cs', refreshToken: 'rt' }, make);
    expect(make).toHaveBeenCalledWith(expect.objectContaining({ service: 'gmail', auth: expect.objectContaining({ type: 'OAuth2', user: 'u@gmail.com', clientId: 'ci', clientSecret: 'cs', refreshToken: 'rt' }) }));
  });
  it('builds an outlook OAuth2 transport with the tenant access url', () => {
    const make = vi.fn(() => ({}) as never);
    createEmailTransport('outlook', { user: 'u@org.com', clientId: 'ci', clientSecret: 'cs', refreshToken: 'rt', tenant: 't1' }, make);
    const cfg = make.mock.calls[0][0] as { host: string; auth: { accessUrl: string } };
    expect(cfg.host).toBe('smtp.office365.com');
    expect(cfg.auth.accessUrl).toBe('https://login.microsoftonline.com/t1/oauth2/v2.0/token');
  });
  it('throws on an unsupported type', () => {
    expect(() => createEmailTransport('imap', {})).toThrow(/unsupported email connector type/);
  });
});
```
- [ ] **Step 3:** Run → FAIL. Write `packages/bootstrap/src/connector-email.ts`:
```typescript
import nodemailer, { type Transporter } from 'nodemailer';

function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

type MakeTransport = (config: Record<string, unknown>) => Transporter;

/** Build a nodemailer transport for an email connector by type. `make` is injectable for tests. */
export function createEmailTransport(type: string, config: Record<string, string>, make: MakeTransport = nodemailer.createTransport): Transporter {
  if (type === 'smtp') {
    return make({ host: config.host, port: validatePort(config.port, 587), secure: config.secure === 'true', auth: { user: config.user, pass: config.password } });
  }
  if (type === 'gmail') {
    return make({ service: 'gmail', auth: { type: 'OAuth2', user: config.user, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: config.refreshToken } });
  }
  if (type === 'outlook') {
    return make({
      host: 'smtp.office365.com', port: 587, secure: false,
      auth: { type: 'OAuth2', user: config.user, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: config.refreshToken, accessUrl: `https://login.microsoftonline.com/${config.tenant || 'common'}/oauth2/v2.0/token` },
    });
  }
  throw new Error(`unsupported email connector type: ${type}`);
}
```
- [ ] **Step 4:** Run → PASS (4).
- [ ] **Step 5:** Service test `packages/bootstrap/src/connector-email-service.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createConnectorEmailRunner } from './connector-email-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ user: 'from@x.com', host: 'mail', port: '587', password: 'p' })),
});
function fakeTransport() {
  let closed = false;
  const calls: unknown[] = [];
  return { t: { sendMail: async (m: unknown) => { calls.push(m); return { messageId: 'mid', accepted: ['to@x.com'], rejected: [] }; }, close: () => { closed = true; } }, calls, isClosed: () => closed };
}

describe('createConnectorEmailRunner', () => {
  it('sends text mail and closes', async () => {
    const f = fakeTransport();
    const run = createConnectorEmailRunner({ connectors: connectorsFake({ type: 'smtp', enabled: true }), secretsKey: 'k', makeTransport: () => f.t as never });
    const res = await run({ connectorId: 'e1', to: 'to@x.com', subject: 'hi', body: 'hello' });
    expect(res).toEqual({ messageId: 'mid', accepted: ['to@x.com'], rejected: [] });
    expect(f.calls[0]).toEqual(expect.objectContaining({ from: 'from@x.com', to: 'to@x.com', subject: 'hi', text: 'hello' }));
    expect(f.isClosed()).toBe(true);
  });
  it('sends html when html=true', async () => {
    const f = fakeTransport();
    const run = createConnectorEmailRunner({ connectors: connectorsFake({ type: 'smtp', enabled: true }), secretsKey: 'k', makeTransport: () => f.t as never });
    await run({ connectorId: 'e1', to: 't', subject: 's', body: '<b>x</b>', html: true });
    expect(f.calls[0]).toEqual(expect.objectContaining({ html: '<b>x</b>' }));
    expect((f.calls[0] as Record<string, unknown>).text).toBeUndefined();
  });
  it('throws for a non-email connector', async () => {
    const run = createConnectorEmailRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', makeTransport: () => ({}) as never });
    await expect(run({ connectorId: 'x', to: 't', subject: 's', body: 'b' })).rejects.toThrow(/not an email connector/);
  });
});
```
- [ ] **Step 6:** Run → FAIL. Write `packages/bootstrap/src/connector-email-service.ts`:
```typescript
import type { Transporter } from 'nodemailer';
import { createEmailTransport } from './connector-email';

const EMAIL_TYPES = new Set(['smtp', 'gmail', 'outlook']);

export interface ConnectorEmailDeps {
  connectors: { get(id: string): Promise<{ type: string | null; enabled: boolean } | null>; getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>> };
  secretsKey: string | undefined;
  makeTransport?: (type: string, config: Record<string, string>) => Transporter;
}

export function createConnectorEmailRunner(deps: ConnectorEmailDeps) {
  const make = deps.makeTransport ?? ((type, config) => createEmailTransport(type, config));
  return async ({ connectorId, to, subject, body, html, cc }: { connectorId: string; to: string; subject: string; body: string; html?: boolean; cc?: string }) => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (!c.type || !EMAIL_TYPES.has(c.type)) throw new Error(`connector ${connectorId} is not an email connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const transport = make(c.type, config);
    try {
      const info = await transport.sendMail({ from: config.from || config.user, to, ...(cc ? { cc } : {}), subject, ...(html ? { html: body } : { text: body }) });
      return { messageId: String(info.messageId ?? ''), accepted: (info.accepted ?? []) as string[], rejected: (info.rejected ?? []) as string[] };
    } finally {
      transport.close();
    }
  };
}
```
- [ ] **Step 7:** Run → PASS (3).
- [ ] **Step 8:** Wire into `packages/bootstrap/src/index.ts`: `import { createConnectorEmailRunner } from './connector-email-service';`; before the `workflowServices` literal: `const connectorEmailRunner = createConnectorEmailRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });`; literal member `runConnectorEmail: (input) => connectorEmailRunner(input),`.
- [ ] **Step 9:** `pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C packages/workflows exec tsc --noEmit` → 0.
- [ ] **Step 10:** Commit:
```bash
git add packages/bootstrap/src/connector-email.ts packages/bootstrap/src/connector-email.test.ts packages/bootstrap/src/connector-email-service.ts packages/bootstrap/src/connector-email-service.test.ts packages/workflows/src/engine/services.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): email transport helper + runConnectorEmail service (smtp/gmail/outlook)"
```

---

## Task 3: Email node handler (send-email / gmail / outlook)

**Files:** Create `packages/workflows/src/engine/node-handlers/email.ts` (+test); Modify `node-handlers/index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1:** Test `email.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { emailHandler } from './email';
import { createContext } from '../execution-context';

function fakeCtx(result = { messageId: 'm', accepted: ['t'], rejected: [] }) {
  const calls: unknown[] = [];
  const services = { runConnectorEmail: async (i: unknown) => { calls.push(i); return result; } } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'em1', type: 'action', data: { action: 'send-email', config: cfg } });

describe('emailHandler', () => {
  it('templates to/subject/body and returns the send result', async () => {
    const { ctx, calls } = fakeCtx();
    const result = await emailHandler(node({ connectorId: 'c1', to: '{{ $json.email }}', subject: 'Re: {{ $json.id }}', body: 'Hi {{ $json.name }}' }), ctx, [{ json: { email: 'a@x.com', id: '7', name: 'Ann' } }]);
    expect(calls[0]).toEqual({ connectorId: 'c1', to: 'a@x.com', subject: 'Re: 7', body: 'Hi Ann', html: false, cc: undefined });
    expect(result).toEqual([{ json: { messageId: 'm', accepted: ['t'], rejected: [] } }]);
  });
  it('passes html=true and cc', async () => {
    const { ctx, calls } = fakeCtx();
    await emailHandler(node({ connectorId: 'c1', to: 't@x.com', subject: 's', body: '<b>x</b>', html: true, cc: 'c@x.com' }), ctx, []);
    expect(calls[0]).toEqual({ connectorId: 'c1', to: 't@x.com', subject: 's', body: '<b>x</b>', html: true, cc: 'c@x.com' });
  });
  it('throws without connector / to / subject / services', async () => {
    const { ctx } = fakeCtx();
    await expect(emailHandler(node({ connectorId: '', to: 't', subject: 's', body: 'b' }), ctx, [])).rejects.toThrow(/connector is required/);
    await expect(emailHandler(node({ connectorId: 'c1', to: '', subject: 's', body: 'b' }), ctx, [])).rejects.toThrow(/recipient/);
    await expect(emailHandler(node({ connectorId: 'c1', to: 't', subject: '', body: 'b' }), ctx, [])).rejects.toThrow(/subject/);
    const bare = createContext(undefined, () => {});
    await expect(emailHandler(node({ connectorId: 'c1', to: 't', subject: 's', body: 'b' }), bare, [])).rejects.toThrow(/requires server services/);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Handler `email.ts`:
```typescript
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/** Send an email via a connector (smtp/gmail/outlook). to/cc/subject/body are templated. */
export const emailHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorEmail) throw new Error('Email node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('Email node: a connector is required');
  const to = resolveTemplate(String(config.to ?? ''), ctx, input);
  if (!to) throw new Error('Email node: a recipient (to) is required');
  const subject = resolveTemplate(String(config.subject ?? ''), ctx, input);
  if (!subject) throw new Error('Email node: a subject is required');
  const body = resolveTemplate(String(config.body ?? ''), ctx, input);
  const cc = config.cc ? resolveTemplate(String(config.cc), ctx, input) : undefined;
  const html = Boolean(config.html);
  const result = await ctx.services.runConnectorEmail({ connectorId, to, subject, body, html, cc });
  return [{ json: { messageId: result.messageId, accepted: result.accepted, rejected: result.rejected } }];
};
```
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Wiring. `node-handlers/index.ts`: `import { emailHandler } from './email';` + three entries `'send-email': emailHandler, 'gmail': emailHandler, 'outlook': emailHandler,`. `host-nodes.ts` add three descriptors (only `optionsSource` differs):
```typescript
  { id: 'send-email', source: 'host', label: 'Send Email (SMTP)', kind: 'transform', description: 'Send an email via SMTP.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'connectorId', label: 'Connector', type: 'select', required: true, optionsSource: 'connectors:smtp' }, { key: 'to', label: 'To', type: 'text', required: true }, { key: 'subject', label: 'Subject', type: 'text', required: true }, { key: 'body', label: 'Body', type: 'text', required: false }, { key: 'cc', label: 'CC', type: 'text', required: false }, { key: 'html', label: 'Send as HTML', type: 'boolean', required: false }] },
  { id: 'gmail', source: 'host', label: 'Gmail', kind: 'transform', description: 'Send email via Gmail (OAuth2).', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'connectorId', label: 'Connector', type: 'select', required: true, optionsSource: 'connectors:gmail' }, { key: 'to', label: 'To', type: 'text', required: true }, { key: 'subject', label: 'Subject', type: 'text', required: true }, { key: 'body', label: 'Body', type: 'text', required: false }, { key: 'cc', label: 'CC', type: 'text', required: false }, { key: 'html', label: 'Send as HTML', type: 'boolean', required: false }] },
  { id: 'outlook', source: 'host', label: 'Microsoft Outlook', kind: 'transform', description: 'Send email via Outlook (OAuth2).', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'connectorId', label: 'Connector', type: 'select', required: true, optionsSource: 'connectors:outlook' }, { key: 'to', label: 'To', type: 'text', required: true }, { key: 'subject', label: 'Subject', type: 'text', required: true }, { key: 'body', label: 'Body', type: 'text', required: false }, { key: 'cc', label: 'CC', type: 'text', required: false }, { key: 'html', label: 'Send as HTML', type: 'boolean', required: false }] },
```
`constants.ts`: replace the `send-email`, `gmail`, `outlook` palette entries with default config `{ connectorId: '', to: '', subject: '', body: '', cc: '', html: false }`, and add a `// communication (slice F)` line to `IMPLEMENTED_TEMPLATE_IDS`: `'send-email', 'gmail', 'outlook',`.
- [ ] **Step 6:** `pnpm -C packages/workflows exec tsc --noEmit` → 0; `pnpm -C packages/workflows test` → green.
- [ ] **Step 7:** Commit:
```bash
git add packages/workflows/src/engine/node-handlers/email.ts packages/workflows/src/engine/node-handlers/email.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): send-email/gmail/outlook nodes (shared email handler)"
```

---

## Task 4: SFTP service

**Files:** Create `packages/bootstrap/src/connector-sftp-service.ts` (+test); Modify `services.ts`, `index.ts`.

- [ ] **Step 1:** Add to `WorkflowServices` (`services.ts`):
```typescript
  /** Run an SFTP operation against a host connector. Host-injected. */
  runConnectorSftp?(input: { connectorId: string; operation: string; remotePath: string; toPath?: string; bytes?: Uint8Array }): Promise<{ bytes?: Uint8Array; fileName?: string; entries?: { name: string; size: number; type: string }[]; ok?: boolean }>;
```
- [ ] **Step 2:** Test `packages/bootstrap/src/connector-sftp-service.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createConnectorSftpRunner } from './connector-sftp-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '22', user: 'u', password: 'p' })),
});
function fakeClient() {
  let ended = false;
  const calls: string[] = [];
  return {
    client: {
      connect: async () => { calls.push('connect'); },
      get: async (p: string) => { calls.push(`get ${p}`); return Buffer.from('FILE'); },
      put: async (_b: unknown, p: string) => { calls.push(`put ${p}`); },
      list: async (p: string) => { calls.push(`list ${p}`); return [{ name: 'a.txt', size: 4, type: '-' }]; },
      delete: async (p: string) => { calls.push(`delete ${p}`); },
      rename: async (a: string, b: string) => { calls.push(`rename ${a} ${b}`); },
      end: async () => { ended = true; },
    },
    calls, isEnded: () => ended,
  };
}

describe('createConnectorSftpRunner', () => {
  it('download returns bytes + fileName and ends', async () => {
    const f = fakeClient();
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    const res = await run({ connectorId: 's1', operation: 'download', remotePath: '/dir/a.txt' });
    expect(new TextDecoder().decode(res.bytes!)).toBe('FILE');
    expect(res.fileName).toBe('a.txt');
    expect(f.isEnded()).toBe(true);
  });
  it('upload puts the bytes', async () => {
    const f = fakeClient();
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    expect(await run({ connectorId: 's1', operation: 'upload', remotePath: '/x', bytes: new TextEncoder().encode('Y') })).toEqual({ ok: true });
    expect(f.calls).toContain('put /x');
  });
  it('list returns entries', async () => {
    const f = fakeClient();
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    expect((await run({ connectorId: 's1', operation: 'list', remotePath: '/d' })).entries).toEqual([{ name: 'a.txt', size: 4, type: '-' }]);
  });
  it('rename requires toPath and calls rename', async () => {
    const f = fakeClient();
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    await run({ connectorId: 's1', operation: 'rename', remotePath: '/a', toPath: '/b' });
    expect(f.calls).toContain('rename /a /b');
  });
  it('ends the client even when the op throws', async () => {
    const f = fakeClient();
    f.client.get = async () => { throw new Error('boom'); };
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    await expect(run({ connectorId: 's1', operation: 'download', remotePath: '/a' })).rejects.toThrow('boom');
    expect(f.isEnded()).toBe(true);
  });
  it('throws for a non-sftp connector', async () => {
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'redis', enabled: true }), secretsKey: 'k', connect: vi.fn() as never });
    await expect(run({ connectorId: 'x', operation: 'list', remotePath: '/' })).rejects.toThrow(/not an sftp connector/);
  });
});
```
- [ ] **Step 3:** Run → FAIL. Write `packages/bootstrap/src/connector-sftp-service.ts`:
```typescript
import Client from 'ssh2-sftp-client';

export interface SftpLike {
  connect(opts: { host: string; port: number; username: string; password: string }): Promise<unknown>;
  get(remotePath: string): Promise<string | Buffer | NodeJS.WritableStream>;
  put(input: Buffer, remotePath: string): Promise<string>;
  list(remotePath: string): Promise<Array<{ name: string; size: number; type: string }>>;
  delete(remotePath: string): Promise<string>;
  rename(from: string, to: string): Promise<string>;
  end(): Promise<void>;
}

function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

async function defaultConnect(config: Record<string, string>): Promise<SftpLike> {
  const client = new Client() as unknown as SftpLike;
  await client.connect({ host: config.host || 'localhost', port: validatePort(config.port, 22), username: config.user ?? '', password: config.password ?? '' });
  return client;
}

export interface ConnectorSftpDeps {
  connectors: { get(id: string): Promise<{ type: string | null; enabled: boolean } | null>; getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>> };
  secretsKey: string | undefined;
  connect?: (config: Record<string, string>) => Promise<SftpLike>;
}

export function createConnectorSftpRunner(deps: ConnectorSftpDeps) {
  const connect = deps.connect ?? defaultConnect;
  return async ({ connectorId, operation, remotePath, toPath, bytes }: { connectorId: string; operation: string; remotePath: string; toPath?: string; bytes?: Uint8Array }) => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (c.type !== 'sftp') throw new Error(`connector ${connectorId} is not an sftp connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const client = await connect(config);
    try {
      if (operation === 'upload') {
        await client.put(Buffer.from(bytes ?? new Uint8Array()), remotePath);
        return { ok: true };
      }
      if (operation === 'list') {
        const rows = await client.list(remotePath);
        return { entries: rows.map((r) => ({ name: r.name, size: r.size, type: r.type })) };
      }
      if (operation === 'delete') {
        await client.delete(remotePath);
        return { ok: true };
      }
      if (operation === 'rename') {
        if (!toPath) throw new Error('sftp rename requires toPath');
        await client.rename(remotePath, toPath);
        return { ok: true };
      }
      // download (default)
      const data = await client.get(remotePath);
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as string);
      const fileName = remotePath.split('/').pop() || 'download';
      return { bytes: new Uint8Array(buf), fileName };
    } finally {
      await client.end();
    }
  };
}
```
- [ ] **Step 4:** Run → PASS (6).
- [ ] **Step 5:** Wire into `packages/bootstrap/src/index.ts`: `import { createConnectorSftpRunner } from './connector-sftp-service';`; `const connectorSftpRunner = createConnectorSftpRunner({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY });`; literal member `runConnectorSftp: (input) => connectorSftpRunner(input),`.
- [ ] **Step 6:** `pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C packages/workflows exec tsc --noEmit` → 0.
- [ ] **Step 7:** Commit:
```bash
git add packages/bootstrap/src/connector-sftp-service.ts packages/bootstrap/src/connector-sftp-service.test.ts packages/workflows/src/engine/services.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): runConnectorSftp service (download/upload/list/delete/rename)"
```

---

## Task 5: FTP node handler

**Files:** Create `packages/workflows/src/engine/node-handlers/ftp.ts` (+test); Modify `node-handlers/index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1:** Test `ftp.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ftpHandler } from './ftp';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeCtx(sftpResult: Record<string, unknown>) {
  const store = new Map<string, Uint8Array>();
  let wn = 0;
  const calls: unknown[] = [];
  const services = {
    runConnectorSftp: async (i: unknown) => { calls.push(i); return sftpResult; },
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/t-${wn++}/${fileName}`; store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
    readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('nf'); return b; },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls, store };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'f1', type: 'action', data: { action: 'ftp', config: cfg } });

describe('ftpHandler', () => {
  it('download writes a BinaryRef onto the item', async () => {
    const { ctx } = fakeCtx({ bytes: new TextEncoder().encode('DATA'), fileName: 'a.txt' });
    const result = await ftpHandler(node({ connectorId: 'c1', operation: 'download', remotePath: '/d/a.txt', binaryField: 'file' }), ctx, []);
    const ref = (result[0].binary as Record<string, BinaryRef>).file;
    expect(ref.fileName).toBe('a.txt');
    expect((result[0].json as Record<string, unknown>).fileName).toBe('a.txt');
  });
  it('upload reads the input item file and sends bytes', async () => {
    const { ctx, calls } = fakeCtx({ ok: true });
    // seed a file via writeBinary
    const seeded = await ctx.services!.writeBinary!({ bytes: new TextEncoder().encode('UP'), fileName: 'u.txt', contentType: 'text/plain' });
    const result = await ftpHandler(node({ connectorId: 'c1', operation: 'upload', remotePath: '/up/u.txt', binaryField: 'file' }), ctx, [{ json: {}, binary: { file: seeded } }]);
    const sent = calls[0] as { bytes: Uint8Array };
    expect(new TextDecoder().decode(sent.bytes)).toBe('UP');
    expect((result[0].json as Record<string, unknown>).ok).toBe(true);
  });
  it('list maps entries to items', async () => {
    const { ctx } = fakeCtx({ entries: [{ name: 'a', size: 1, type: '-' }, { name: 'b', size: 2, type: 'd' }] });
    const result = await ftpHandler(node({ connectorId: 'c1', operation: 'list', remotePath: '/d' }), ctx, []);
    expect(result).toEqual([{ json: { name: 'a', size: 1, type: '-' } }, { json: { name: 'b', size: 2, type: 'd' } }]);
  });
  it('rename requires toPath', async () => {
    const { ctx } = fakeCtx({ ok: true });
    await expect(ftpHandler(node({ connectorId: 'c1', operation: 'rename', remotePath: '/a' }), ctx, [])).rejects.toThrow(/toPath/);
  });
  it('upload throws when the input has no file', async () => {
    const { ctx } = fakeCtx({ ok: true });
    await expect(ftpHandler(node({ connectorId: 'c1', operation: 'upload', remotePath: '/x', binaryField: 'file' }), ctx, [{ json: {} }])).rejects.toThrow(/no file/);
  });
  it('throws without connector / remotePath / services', async () => {
    const { ctx } = fakeCtx({});
    await expect(ftpHandler(node({ connectorId: '', operation: 'list', remotePath: '/d' }), ctx, [])).rejects.toThrow(/connector is required/);
    await expect(ftpHandler(node({ connectorId: 'c1', operation: 'list', remotePath: '' }), ctx, [])).rejects.toThrow(/remote path/);
    const bare = createContext(undefined, () => {});
    await expect(ftpHandler(node({ connectorId: 'c1', operation: 'list', remotePath: '/d' }), bare, [])).rejects.toThrow(/requires server services/);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Handler `ftp.ts`:
```typescript
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { rowsToItems } from '../items';

/** SFTP transfer (download/upload/list/delete/rename). Binary I/O reuses readBinary/writeBinary. */
export const ftpHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorSftp) throw new Error('FTP node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('FTP node: a connector is required');
  const operation = (config.operation as string) || 'download';
  const remotePath = resolveTemplate(String(config.remotePath ?? ''), ctx, input);
  if (!remotePath) throw new Error('FTP node: a remote path is required');
  const binaryField = (config.binaryField as string) || 'file';

  if (operation === 'upload') {
    if (!ctx.services.readBinary) throw new Error('FTP node requires server services');
    const ref = input[0]?.binary?.[binaryField];
    if (!ref) throw new Error(`FTP node: no file on the input item (field '${binaryField}')`);
    const bytes = await ctx.services.readBinary(ref.objectKey);
    const res = await ctx.services.runConnectorSftp({ connectorId, operation: 'upload', remotePath, bytes });
    return [{ json: { ok: res.ok ?? true, remotePath } }];
  }
  if (operation === 'list') {
    const res = await ctx.services.runConnectorSftp({ connectorId, operation: 'list', remotePath });
    return rowsToItems((res.entries ?? []) as Record<string, unknown>[]);
  }
  if (operation === 'delete') {
    await ctx.services.runConnectorSftp({ connectorId, operation: 'delete', remotePath });
    return [{ json: { ok: true, remotePath } }];
  }
  if (operation === 'rename') {
    const toPath = resolveTemplate(String(config.toPath ?? ''), ctx, input);
    if (!toPath) throw new Error('FTP node: rename requires toPath');
    await ctx.services.runConnectorSftp({ connectorId, operation: 'rename', remotePath, toPath });
    return [{ json: { ok: true, from: remotePath, to: toPath } }];
  }
  // download (default)
  if (!ctx.services.writeBinary) throw new Error('FTP node requires server services');
  const res = await ctx.services.runConnectorSftp({ connectorId, operation: 'download', remotePath });
  const fileName = res.fileName || (remotePath.split('/').pop() || 'download');
  const out = input.length > 0 ? input[0] : { json: {} };
  const ref = await ctx.services.writeBinary({ bytes: res.bytes ?? new Uint8Array(), fileName, contentType: 'application/octet-stream' });
  return [{ ...out, json: { ...out.json, fileName }, binary: { ...(out.binary ?? {}), [binaryField]: ref } }];
};
```
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Wiring. `node-handlers/index.ts`: `import { ftpHandler } from './ftp';` + `'ftp': ftpHandler,`. `host-nodes.ts`:
```typescript
  { id: 'ftp', source: 'host', label: 'FTP / SFTP', kind: 'transform', description: 'Transfer files over SFTP.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'connectorId', label: 'Connector', type: 'select', required: true, optionsSource: 'connectors:sftp' }, { key: 'operation', label: 'Operation', type: 'select', required: false, options: [{ value: 'download', label: 'Download' }, { value: 'upload', label: 'Upload' }, { value: 'list', label: 'List' }, { value: 'delete', label: 'Delete' }, { value: 'rename', label: 'Rename' }] }, { key: 'remotePath', label: 'Remote path', type: 'text', required: true }, { key: 'toPath', label: 'New path (rename)', type: 'text', required: false }, { key: 'binaryField', label: 'Binary field (download/upload)', type: 'text', required: false }] },
```
`constants.ts`: replace the `ftp` palette entry with default config `{ connectorId: '', operation: 'download', remotePath: '', toPath: '', binaryField: 'file' }`; add `'ftp'` to the `// communication (slice F)` IMPLEMENTED line.
- [ ] **Step 6:** `pnpm -C packages/workflows exec tsc --noEmit` → 0; `pnpm -C packages/workflows test` → green.
- [ ] **Step 7:** Commit:
```bash
git add packages/workflows/src/engine/node-handlers/ftp.ts packages/workflows/src/engine/node-handlers/ftp.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): ftp (sftp) node (download/upload/list/delete/rename)"
```

---

## Task 6: Extend the connector test probe (email + sftp)

**Files:** Modify `packages/bootstrap/src/connector-test.ts` (+ `connector-test.test.ts`).

- [ ] **Step 1:** Add failing tests to `connector-test.test.ts`:
```typescript
  it('verifies for email types', async () => {
    const verify = vi.fn(async () => true);
    const close = vi.fn(() => {});
    await testConnector('smtp', {}, { email: () => ({ verify, close }) as never });
    expect(verify).toHaveBeenCalled();
  });
  it('connects + lists for sftp', async () => {
    const list = vi.fn(async () => []);
    const end = vi.fn(async () => {});
    await testConnector('sftp', {}, { sftp: async () => ({ list, end }) as never });
    expect(list).toHaveBeenCalledWith('.');
    expect(end).toHaveBeenCalled();
  });
```
- [ ] **Step 2:** Run → FAIL (email/sftp fall through to unknown-type throw).
- [ ] **Step 3:** Edit `connector-test.ts`. Add imports `import { createEmailTransport } from './connector-email';` and a minimal sftp connect (reuse the service's connect by exporting a helper, OR inline). Extend `ConnectorTestDeps` and the function:
```typescript
const EMAIL_TYPES = new Set(['smtp', 'gmail', 'outlook']);

export interface ConnectorTestDeps {
  sqlDb?: (type: string, config: Record<string, string>) => ConnectorDb;
  mongo?: (config: Record<string, string>) => Promise<MongoConn>;
  redis?: (config: Record<string, string>) => Redis;
  email?: (type: string, config: Record<string, string>) => { verify(): Promise<unknown>; close(): void };
  sftp?: (config: Record<string, string>) => Promise<{ list(p: string): Promise<unknown>; end(): Promise<void> }>;
}
```
Inside `testConnector`, before the final throw, add:
```typescript
  if (EMAIL_TYPES.has(type)) {
    const transport = (deps.email ?? ((t, c) => createEmailTransport(t, c) as unknown as { verify(): Promise<unknown>; close(): void }))(type, config);
    try { await transport.verify(); } finally { transport.close(); }
    return;
  }
  if (type === 'sftp') {
    const client = await (deps.sftp ?? (async (c) => {
      const sftp = new (await import('ssh2-sftp-client')).default();
      await sftp.connect({ host: c.host || 'localhost', port: Number(c.port || 22), username: c.user ?? '', password: c.password ?? '' });
      return sftp as unknown as { list(p: string): Promise<unknown>; end(): Promise<void> };
    }))(config);
    try { await client.list('.'); } finally { await client.end(); }
    return;
  }
```
> If the dynamic `import('ssh2-sftp-client')` is awkward for tsc, instead add a top `import SftpClient from 'ssh2-sftp-client';` and use `new SftpClient()` in the default sftp connect. Either way the unit tests inject `deps.sftp`/`deps.email`, so the defaults aren't exercised in tests.
- [ ] **Step 4:** Run → PASS (the 2 new + existing 4). `pnpm -C packages/bootstrap exec tsc --noEmit` → 0.
- [ ] **Step 5:** Commit:
```bash
git add packages/bootstrap/src/connector-test.ts packages/bootstrap/src/connector-test.test.ts
git commit -m "feat(bootstrap): connector test probe covers email (verify) + sftp (list)"
```

---

## Task 7: Connectors UI — email + sftp host types

**Files:** `apps/web/src/pages/settings/Connectors.tsx` (+test), `apps/web/src/i18n/{en,fr,pt}.ts`.

- [ ] **Step 1:** Extend `HOST_TYPES` (append after the db types):
```typescript
  { value: 'smtp', label: 'SMTP Email' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Microsoft Outlook' },
  { value: 'sftp', label: 'SFTP' },
```
- [ ] **Step 2:** Add to `CONNECTOR_TYPE_FIELDS`:
```typescript
  smtp: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'secure', labelKey: 'settings.connectors.fieldSecure', kind: 'boolean' },
  ],
  gmail: [
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'clientId', labelKey: 'settings.connectors.fieldClientId', kind: 'text' },
    { key: 'clientSecret', labelKey: 'settings.connectors.fieldClientSecret', kind: 'password' },
    { key: 'refreshToken', labelKey: 'settings.connectors.fieldRefreshToken', kind: 'password' },
  ],
  outlook: [
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'clientId', labelKey: 'settings.connectors.fieldClientId', kind: 'text' },
    { key: 'clientSecret', labelKey: 'settings.connectors.fieldClientSecret', kind: 'password' },
    { key: 'refreshToken', labelKey: 'settings.connectors.fieldRefreshToken', kind: 'password' },
    { key: 'tenant', labelKey: 'settings.connectors.fieldTenant', kind: 'text' },
  ],
  sftp: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
  ],
```
- [ ] **Step 3:** Generalize the create-required rule. The current rule requires `host` (Slice E). gmail/outlook have no `host`. Change it to require the FIRST field of the active type's schema (host for db/smtp/sftp; user for gmail/outlook). Locate the create-validation in `onSave` and replace the hard `host` check with: `const firstKey = (CONNECTOR_TYPE_FIELDS[draft.type] ?? [])[0]?.key; const requiredOk = firstKey ? Boolean((draft.dbConfig[firstKey] ?? '').trim()) : true;` and use `requiredOk` where the old `host` check was. Keep the password-blank-on-edit behavior.
- [ ] **Step 4:** Relabel the non-plugin category from "Database" to "Host" — change the category option label to use `t('settings.connectors.categoryHost')` (add that key) where the category Select currently shows the database label (`categoryDatabase`). Keep the value `'database'` if the code keys on it, OR rename the value to `'host'` consistently — pick whichever is least invasive; the value only affects local draft state, not the API (API gets `type`). Simplest: keep the internal value, change the visible label key to `categoryHost`.
- [ ] **Step 5:** i18n — add to `en.ts`, `fr.ts`, `pt.ts` under `settings.connectors`: `fieldSecure`, `fieldClientId`, `fieldClientSecret`, `fieldRefreshToken`, `fieldTenant`, `categoryHost`. en values e.g. "Use TLS", "Client ID", "Client secret", "Refresh token", "Tenant", "Host". Provide fr/pt (or clear fallbacks) — the KEY must exist in all three.
- [ ] **Step 6:** Test — in `Connectors.test.tsx` add: selecting type "Gmail" renders `clientId`/`clientSecret`/`refreshToken` and does NOT render `host`; selecting "SFTP" renders host/port/user/password; saving an SMTP connector calls `createConnector` with `{ name, type: 'smtp', config: { host, port, user, password, secure } }`.
- [ ] **Step 7:** `pnpm -C apps/web exec tsc --noEmit` → 0; `pnpm -C apps/web exec vitest run src/pages/settings/Connectors.test.tsx` → pass; run the i18n parity test → pass.
- [ ] **Step 8:** Commit:
```bash
git add apps/web/src/pages/settings/Connectors.tsx apps/web/src/pages/settings/Connectors.test.tsx apps/web/src/i18n
git commit -m "feat(web): email + sftp connector types in the Connectors UI"
```

---

## Task 8: Full verification gate

- [ ] **Step 1:** `pnpm -C packages/workflows exec tsc --noEmit && pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C apps/server exec tsc --noEmit && pnpm -C apps/web exec tsc --noEmit` → all 0.
- [ ] **Step 2:** `pnpm -C packages/workflows test && pnpm -C packages/bootstrap test && pnpm -C apps/server test` → all pass (workflows +~10 email/ftp handler tests; bootstrap +~13 email/sftp/test-probe tests).
- [ ] **Step 3:** `pnpm -C apps/web test` (isolated) → pass.
- [ ] **Step 4:** Final commit if any fixups: `git add -A && git commit -m "test(workflows): slice F comms connectors — gate green"`.

> **Post-merge reminder:** after ff-merge to `main`, run `pnpm install` in the main checkout (new bootstrap deps) before the gate. Live SMTP/Gmail/Outlook/SFTP deferred to the accept script.

---

## Self-Review (completed during planning)

- **Spec coverage:** email helper+service (Task 2) + nodes (3), sftp service (4) + node (5), test probe (6), UI (7), gate (8). All spec sections mapped. ✔
- **Placeholder scan:** full code in backend tasks; UI task is concrete field schema + payload + named tests; library shapes confirmed in Task 1; the test-probe dynamic-import has an explicit static-import fallback. No TBD. ✔
- **Type consistency:** `runConnectorEmail`/`runConnectorSftp` signatures identical across services.ts ↔ runners ↔ handlers; `createEmailTransport` shared by service + test probe; SFTP `SftpLike` shape consistent; `connectors:<smtp|gmail|outlook|sftp>` strings match descriptor optionsSource ↔ service type guards ↔ UI HOST_TYPES/CONNECTOR_TYPE_FIELDS; every descriptor field has `required`. ✔
- **Scope:** bootstrap + workflows + server(none — route already calls testConnector) + web; no DB model change. Cross-package tsc gate noted. ✔
- **Deferred:** attachments, IMAP email-trigger, plain FTP, SSH keys, in-app OAuth flow, live e2e.
