# Workflow-Driven Report Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the Zambia team's pm2 report jobs (`temp/app.js`) inside the OpenLDR CE Workflow Builder: a *materialize* workflow (portable SQL extract → declarative reshape → `materialize-dataset`) and a *report* workflow (`load-dataset` → fill branded Excel template → email attachment), proven end-to-end on the AMR Ndola report.

**Architecture:** Two workflows joined by a named dataset. Portability comes from keeping the external DB query a plain parameterized `SELECT` and moving every MSSQL-ism (`PIVOT`, keyed join) into new declarative nodes. Three new capabilities: an `excel-template` node (`xlsx-populate`: template fill + autofilter + secret-resolved password), a `pivot` node (long→wide, fixed columns), and a `combineByKey` join mode on the existing `merge` node. Email is extended to carry attachments; report passwords resolve from the connector secret store.

**Tech Stack:** TypeScript, `@openldr/workflows` engine (node handlers), `@openldr/bootstrap` (host services), `apps/web` (React node palette + config forms), `xlsx-populate`, `nodemailer`, `vitest`.

---

## Reference facts (read before starting)

- **Node handler signature** (`packages/workflows/src/engine/node-handlers/types.ts`): `(node, ctx, input) => Promise<WorkflowItem[]>`. A `WorkflowItem` is `{ json: Record<string,unknown>; binary?: Record<string, BinaryRef> }`.
- **Handler registration**: add the subtype→handler entry in `packages/workflows/src/engine/node-handlers/index.ts` (`ACTION_HANDLERS`).
- **Services** available on `ctx.services` (`packages/workflows/src/engine/services.ts`, interface `WorkflowServices`): `readBinary(objectKey)`, `writeBinary({bytes,fileName,contentType})→BinaryRef`, `materializeDataset`, `loadDataset(name)`, `runConnectorSql({connectorId,sql})`, `runConnectorEmail({...})`. All are optional (`?`) and absent in pure-engine tests.
- **Palette registration** (web): `apps/web/src/workflows/constants.ts` — add the template id to `IMPLEMENTED_TEMPLATE_IDS` and a `node(...)` descriptor entry. Config form: new file under `apps/web/src/workflows/components/node-forms/`, dispatched from `node-forms/index.tsx`, built from `FormField`/`Select`/`TextInput` in `node-forms/shared.tsx`.
- **Test mock pattern**: see `packages/workflows/src/engine/node-handlers/spreadsheet-file.test.ts` (`fakeBinaryCtx` builds a `ctx` with in-memory `readBinary`/`writeBinary`).
- **Connector secrets**: connectors expose `getDecryptedConfig(id, secretsKey) → Record<string,string>` (`packages/bootstrap/src/connector-email-service.ts` shows usage). AES-256-GCM at rest; `secretsKey` is the host master key.
- **Gate command** (run from repo root, per project convention): `pnpm turbo run typecheck test --force` — never pipe turbo through `tail`; if `@openldr/web#test` flakes, re-run isolated with `pnpm -C apps/web test`.

---

## File Structure

**New engine files:**
- `packages/workflows/src/engine/node-handlers/excel-template.ts` — the template-fill handler.
- `packages/workflows/src/engine/node-handlers/excel-template.test.ts`
- `packages/workflows/src/engine/node-handlers/pivot.ts` — long→wide reshape handler.
- `packages/workflows/src/engine/node-handlers/pivot.test.ts`

**Modified engine files:**
- `packages/workflows/src/engine/node-handlers/index.ts` — register `excel-template`, `pivot`.
- `packages/workflows/src/engine/node-handlers/merge.ts` — add `combineByKey` mode.
- `packages/workflows/src/engine/node-handlers/merge.test.ts` — new join tests.
- `packages/workflows/src/engine/node-handlers/email.ts` — attach binaries.
- `packages/workflows/src/engine/node-handlers/email.test.ts`
- `packages/workflows/src/engine/services.ts` — extend `runConnectorEmail` with `attachments`; add `resolveSecret`.
- `packages/workflows/package.json` — add `xlsx-populate`.

**Modified bootstrap files:**
- `packages/bootstrap/src/connector-email-service.ts` — pass attachments to `sendMail`.
- `packages/bootstrap/src/connector-email-service.test.ts`
- `packages/bootstrap/src/index.ts` — wire attachments through `runConnectorEmail`; wire `resolveSecret`.

**Modified web files:**
- `apps/web/src/workflows/constants.ts` — `IMPLEMENTED_TEMPLATE_IDS` + descriptors for `excel-template`, `pivot`; update `merge` form hint.
- `apps/web/src/workflows/components/node-forms/excel-template-form.tsx` (new)
- `apps/web/src/workflows/components/node-forms/pivot-form.tsx` (new)
- `apps/web/src/workflows/components/node-forms/merge-form.tsx` — add `combineByKey` UI.
- `apps/web/src/workflows/components/node-forms/index.tsx` — dispatch the two new forms.

**New scripts / fixtures:**
- `scripts/seed-amr-report-demo.ts` — seed an external-DB fixture + assert the pipeline.

---

## Phase 1 — Excel Template node (+ email attachments + secret resolution)

### Task 1: Add `xlsx-populate` dependency

**Files:**
- Modify: `packages/workflows/package.json`

- [ ] **Step 1: Add the dependency**

Run:
```bash
pnpm --filter @openldr/workflows add xlsx-populate
```
Expected: `xlsx-populate` appears under `dependencies` in `packages/workflows/package.json`, lockfile updated.

- [ ] **Step 2: Verify it imports**

Run:
```bash
node -e "const X=require('xlsx-populate'); X.fromBlankAsync().then(wb=>{wb.sheet(0).cell('A1').value('ok'); return wb.outputAsync();}).then(b=>console.log('bytes', b.length));"
```
Expected: prints `bytes <n>` with n > 0 (proves fill + output works).

- [ ] **Step 3: Commit**

```bash
git add packages/workflows/package.json pnpm-lock.yaml
git commit -m "build(workflows): add xlsx-populate for template fill"
```

---

### Task 2: `excel-template` handler — fill + autofilter (no password yet)

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/excel-template.ts`
- Create: `packages/workflows/src/engine/node-handlers/excel-template.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/workflows/src/engine/node-handlers/excel-template.test.ts
import { describe, it, expect } from 'vitest';
import XlsxPopulate from 'xlsx-populate';
import { excelTemplateHandler } from './excel-template';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

async function blankTemplateBytes(): Promise<Uint8Array> {
  const wb = await XlsxPopulate.fromBlankAsync();
  wb.sheet(0).cell('A1').value('Province'); // a header row to preserve
  wb.sheet(0).cell('B1').value('Count');
  return new Uint8Array(await wb.outputAsync() as ArrayBuffer);
}

function fakeCtx(templateKey: string, templateBytes: Uint8Array) {
  const store = new Map<string, Uint8Array>([[templateKey, templateBytes]]);
  let n = 0;
  const services = {
    readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('nf'); return b; },
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/t-${n++}/${fileName}`;
      store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), store };
}

const node = (cfg: Record<string, unknown>) => ({ id: 'xt1', type: 'action', data: { action: 'excel-template', config: cfg } });

describe('excelTemplateHandler', () => {
  it('fills the template range in declared column order and returns a binary', async () => {
    const tpl = await blankTemplateBytes();
    const { ctx, store } = fakeCtx('tpl-key', tpl);
    const input = [
      { json: { Province: 'Lusaka', Count: 5 } },
      { json: { Province: 'Ndola', Count: 3 } },
    ];
    const out = await excelTemplateHandler(
      node({ templateRef: 'tpl-key', startCell: 'A2', columns: ['Province', 'Count'], fileName: 'report.xlsx', binaryField: 'file' }),
      ctx, input,
    );
    const ref = (out[0].binary as Record<string, BinaryRef>).file;
    expect(ref.fileName).toBe('report.xlsx');
    // Re-open the produced workbook and assert the values landed.
    const wb = await XlsxPopulate.fromDataAsync(Buffer.from(store.get(ref.objectKey)!));
    expect(wb.sheet(0).cell('A2').value()).toBe('Lusaka');
    expect(wb.sheet(0).cell('B3').value()).toBe(3);
    expect(wb.sheet(0).cell('A1').value()).toBe('Province'); // header preserved
  });

  it('throws without services', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(excelTemplateHandler(node({ templateRef: 'k', columns: ['a'] }), ctx, [{ json: {} }]))
      .rejects.toThrow(/requires server services/);
  });

  it('throws when templateRef is missing', async () => {
    const { ctx } = fakeCtx('tpl-key', await blankTemplateBytes());
    await expect(excelTemplateHandler(node({ columns: ['a'] }), ctx, [{ json: {} }]))
      .rejects.toThrow(/templateRef is required/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/excel-template.test.ts`
Expected: FAIL — `excel-template` module not found.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// packages/workflows/src/engine/node-handlers/excel-template.ts
import XlsxPopulate from 'xlsx-populate';
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Column-letter for a 1-based column index (1→A, 27→AA, 74→BV). */
function colLetter(n: number): string {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function parseCell(cell: string): { col: number; row: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(cell.trim());
  if (!m) throw new Error(`Excel Template: invalid cell reference '${cell}'`);
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/**
 * Fill a branded xlsx template with the input rows and return it as a binary.
 * Mirrors temp/app.js: write rows into a range starting at `startCell` in the
 * declared `columns` order, optionally apply an autofilter over the header+data.
 */
export const excelTemplateHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.readBinary || !ctx.services.writeBinary) {
    throw new Error('Excel Template requires server services');
  }
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const templateRef = String(config.templateRef ?? '').trim();
  if (!templateRef) throw new Error('Excel Template: templateRef is required');
  const columns = Array.isArray(config.columns) ? (config.columns as string[]) : [];
  if (columns.length === 0) throw new Error('Excel Template: columns is required');
  const sheetIndex = Number(config.sheetIndex ?? 0);
  const startCell = String(config.startCell ?? 'A2');
  const binaryField = String(config.binaryField ?? 'file');
  const fileName = resolveTemplate(String(config.fileName ?? 'report.xlsx'), ctx, input);

  const tplBytes = await ctx.services.readBinary(templateRef);
  const wb = await XlsxPopulate.fromDataAsync(Buffer.from(tplBytes));
  const sheet = wb.sheet(sheetIndex);
  const start = parseCell(startCell);

  const rows = input.map((it) => columns.map((c) => {
    const v = it.json[c];
    return v === undefined || v === null ? '' : (v as string | number | boolean);
  }));

  if (rows.length > 0) {
    const endCol = colLetter(start.col + columns.length - 1);
    const endRow = start.row + rows.length - 1;
    sheet.range(`${startCell}:${endCol}${endRow}`).value(rows);
  }

  if (config.autoFilter) {
    const headerCell = String(config.autoFilter); // e.g. 'A1' — top-left of the header row
    const hdr = parseCell(headerCell);
    const endCol = colLetter(hdr.col + columns.length - 1);
    const endRow = start.row + Math.max(rows.length, 0) - 1;
    sheet.range(`${headerCell}:${endCol}${Math.max(endRow, hdr.row)}`).autoFilter();
  }

  const out = (await wb.outputAsync()) as Buffer;
  const ref = await ctx.services.writeBinary({ bytes: new Uint8Array(out), fileName, contentType: XLSX_CONTENT_TYPE });
  const items = input.length > 0 ? input : [{ json: {} }];
  return items.map((it, i) => (i === 0 ? { ...it, binary: { ...(it.binary ?? {}), [binaryField]: ref } } : it));
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/excel-template.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the handler**

In `packages/workflows/src/engine/node-handlers/index.ts`, add the import and the `ACTION_HANDLERS` entry:
```typescript
import { excelTemplateHandler } from './excel-template';
// ...inside ACTION_HANDLERS:
  'excel-template': excelTemplateHandler,
```

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/excel-template.ts packages/workflows/src/engine/node-handlers/excel-template.test.ts packages/workflows/src/engine/node-handlers/index.ts
git commit -m "feat(workflows): excel-template node (template fill + autofilter)"
```

---

### Task 3: Add password protection via `resolveSecret`

**Files:**
- Modify: `packages/workflows/src/engine/services.ts`
- Modify: `packages/workflows/src/engine/node-handlers/excel-template.ts`
- Modify: `packages/workflows/src/engine/node-handlers/excel-template.test.ts`

- [ ] **Step 1: Extend the services interface**

In `packages/workflows/src/engine/services.ts`, inside `interface WorkflowServices`, add:
```typescript
  /** Resolve a named secret from a connector's decrypted config (report passwords etc.). Host-injected. */
  resolveSecret?(input: { connectorId: string; key: string }): Promise<string | undefined>;
```

- [ ] **Step 2: Write the failing test (password round-trip)**

Append to `excel-template.test.ts` (inside the `describe`), and extend `fakeCtx` to accept a secret:
```typescript
  it('encrypts the output when a password secret resolves', async () => {
    const tpl = await blankTemplateBytes();
    const store = new Map<string, Uint8Array>([['tpl-key', tpl]]);
    let n = 0;
    const services = {
      readBinary: async (k: string) => store.get(k)!,
      writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }) => {
        const objectKey = `wf/${n++}/${fileName}`; store.set(objectKey, bytes);
        return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
      },
      resolveSecret: async ({ key }: { connectorId: string; key: string }) => (key === 'amr_pw' ? 'S3cret!' : undefined),
    } as unknown as import('../services').WorkflowServices;
    const ctx = createContext(undefined, () => {}, [], undefined, services);
    const out = await excelTemplateHandler(
      node({ templateRef: 'tpl-key', startCell: 'A2', columns: ['Province', 'Count'], fileName: 'p.xlsx',
             password: { connectorId: 'c1', key: 'amr_pw' } }),
      ctx, [{ json: { Province: 'Lusaka', Count: 1 } }],
    );
    const ref = (out[0].binary as Record<string, import('../items').BinaryRef>).file;
    const bytes = store.get(ref.objectKey)!;
    // Opening WITHOUT the password must fail; WITH it must succeed.
    await expect(XlsxPopulate.fromDataAsync(Buffer.from(bytes))).rejects.toBeTruthy();
    const wb = await XlsxPopulate.fromDataAsync(Buffer.from(bytes), { password: 'S3cret!' });
    expect(wb.sheet(0).cell('A2').value()).toBe('Lusaka');
  });
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/excel-template.test.ts -t "encrypts"`
Expected: FAIL — output is not password-encrypted yet.

- [ ] **Step 4: Implement password resolution**

In `excel-template.ts`, replace the output line with password handling:
```typescript
  let password: string | undefined;
  const pw = config.password as { connectorId?: string; key?: string } | undefined;
  if (pw?.connectorId && pw.key) {
    if (!ctx.services.resolveSecret) throw new Error('Excel Template: secret resolution unavailable');
    password = await ctx.services.resolveSecret({ connectorId: pw.connectorId, key: pw.key });
    if (!password) throw new Error(`Excel Template: password secret '${pw.key}' did not resolve`);
  }

  const out = (await wb.outputAsync(password ? { password } : undefined)) as Buffer;
```
(Delete the old `const out = (await wb.outputAsync()) as Buffer;` line.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/excel-template.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/services.ts packages/workflows/src/engine/node-handlers/excel-template.ts packages/workflows/src/engine/node-handlers/excel-template.test.ts
git commit -m "feat(workflows): excel-template password via resolveSecret"
```

---

### Task 4: Email attachments — engine + interface

**Files:**
- Modify: `packages/workflows/src/engine/services.ts`
- Modify: `packages/workflows/src/engine/node-handlers/email.ts`
- Modify: `packages/workflows/src/engine/node-handlers/email.test.ts`

- [ ] **Step 1: Extend the `runConnectorEmail` signature**

In `services.ts`, change the `runConnectorEmail` line to add an optional `attachments`:
```typescript
  runConnectorEmail?(input: { connectorId: string; to: string; subject: string; body: string; html?: boolean; cc?: string; attachments?: Array<{ filename: string; content: Uint8Array; contentType?: string }> }): Promise<{ messageId: string; accepted: string[]; rejected: string[] }>;
```

- [ ] **Step 2: Write the failing test**

Replace the body of `packages/workflows/src/engine/node-handlers/email.test.ts` with (keeping the existing "requires services" case):
```typescript
import { describe, it, expect } from 'vitest';
import { emailHandler } from './email';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

const node = (cfg: Record<string, unknown>) => ({ id: 'e1', type: 'action', data: { action: 'send-email', config: cfg } });

describe('emailHandler', () => {
  it('reads item binaries and forwards them as attachments', async () => {
    const calls: any[] = [];
    const bytes = new Uint8Array([1, 2, 3]);
    const services = {
      readBinary: async (_k: string) => bytes,
      runConnectorEmail: async (i: unknown) => { calls.push(i); return { messageId: 'm', accepted: ['a@b'], rejected: [] }; },
    } as unknown as import('../services').WorkflowServices;
    const ctx = createContext(undefined, () => {}, [], undefined, services);
    const ref: BinaryRef = { objectKey: 'k', contentType: 'application/xlsx', fileName: 'report.xlsx', byteSize: 3 };
    await emailHandler(node({ connectorId: 'c1', to: 'a@b', subject: 's', body: 'b', attachBinaryField: 'file' }), ctx, [{ json: {}, binary: { file: ref } }]);
    expect(calls[0].attachments).toEqual([{ filename: 'report.xlsx', content: bytes, contentType: 'application/xlsx' }]);
  });

  it('sends with no attachments when the field is absent', async () => {
    const calls: any[] = [];
    const services = { runConnectorEmail: async (i: unknown) => { calls.push(i); return { messageId: 'm', accepted: [], rejected: [] }; } } as unknown as import('../services').WorkflowServices;
    const ctx = createContext(undefined, () => {}, [], undefined, services);
    await emailHandler(node({ connectorId: 'c1', to: 'a@b', subject: 's', body: 'b' }), ctx, [{ json: {} }]);
    expect(calls[0].attachments).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/email.test.ts`
Expected: FAIL — `attachments` not built.

- [ ] **Step 4: Implement attachment collection in `email.ts`**

Replace `email.ts` with:
```typescript
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/** Send an email via a connector (smtp/gmail/outlook). to/cc/subject/body are templated.
 *  When `attachBinaryField` is set (default 'file'), any matching BinaryRef on the FIRST
 *  input item is fetched and forwarded as an attachment. */
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

  const attachField = config.attachBinaryField === undefined ? 'file' : String(config.attachBinaryField);
  let attachments: Array<{ filename: string; content: Uint8Array; contentType?: string }> | undefined;
  const ref = attachField ? input[0]?.binary?.[attachField] : undefined;
  if (ref) {
    if (!ctx.services.readBinary) throw new Error('Email node: readBinary unavailable for attachments');
    const content = await ctx.services.readBinary(ref.objectKey);
    attachments = [{ filename: ref.fileName, content, contentType: ref.contentType }];
  }

  const result = await ctx.services.runConnectorEmail({ connectorId, to, subject, body, html, cc, ...(attachments ? { attachments } : {}) });
  return [{ json: { messageId: result.messageId, accepted: result.accepted, rejected: result.rejected } }];
};
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/email.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/services.ts packages/workflows/src/engine/node-handlers/email.ts packages/workflows/src/engine/node-handlers/email.test.ts
git commit -m "feat(workflows): send-email forwards item binaries as attachments"
```

---

### Task 5: Bootstrap wiring — attachments + resolveSecret

**Files:**
- Modify: `packages/bootstrap/src/connector-email-service.ts`
- Modify: `packages/bootstrap/src/connector-email-service.test.ts`
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Write the failing test for attachment pass-through**

In `connector-email-service.test.ts`, add a case asserting `sendMail` receives `attachments` (follow the file's existing `makeTransport` fake pattern):
```typescript
  it('forwards attachments to sendMail', async () => {
    const sent: any[] = [];
    const runner = createConnectorEmailRunner({
      connectors: {
        get: async () => ({ type: 'smtp', enabled: true }),
        getDecryptedConfig: async () => ({ user: 'u', from: 'from@x' }),
      },
      secretsKey: undefined,
      makeTransport: () => ({ sendMail: async (m: any) => { sent.push(m); return { messageId: 'm', accepted: [], rejected: [] }; }, close: () => {} } as any),
    });
    await runner({ connectorId: 'c1', to: 't@x', subject: 's', body: 'b', attachments: [{ filename: 'r.xlsx', content: new Uint8Array([1]), contentType: 'application/xlsx' }] });
    expect(sent[0].attachments).toEqual([{ filename: 'r.xlsx', content: Buffer.from([1]), contentType: 'application/xlsx' }]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/bootstrap exec vitest run src/connector-email-service.test.ts`
Expected: FAIL — attachments not passed.

- [ ] **Step 3: Implement in `connector-email-service.ts`**

Extend the runner's input type and the `sendMail` call:
```typescript
  return async ({ connectorId, to, subject, body, html, cc, attachments }: { connectorId: string; to: string; subject: string; body: string; html?: boolean; cc?: string; attachments?: Array<{ filename: string; content: Uint8Array; contentType?: string }> }) => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (!c.type || !EMAIL_TYPES.has(c.type)) throw new Error(`connector ${connectorId} is not an email connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const transport = make(c.type, config);
    const mailAttachments = attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), ...(a.contentType ? { contentType: a.contentType } : {}) }));
    try {
      const info = await transport.sendMail({ from: config.from || config.user, to, ...(cc ? { cc } : {}), subject, ...(html ? { html: body } : { text: body }), ...(mailAttachments ? { attachments: mailAttachments } : {}) });
      return { messageId: String(info.messageId ?? ''), accepted: (info.accepted ?? []) as string[], rejected: (info.rejected ?? []) as string[] };
    } finally {
      transport.close();
    }
  };
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/bootstrap exec vitest run src/connector-email-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the service into `index.ts`**

In `packages/bootstrap/src/index.ts`: the `runConnectorEmail: (input) => connectorEmailRunner(input)` line already forwards the whole `input`, so attachments flow through unchanged — confirm no change needed there. Then add the `resolveSecret` service next to the other service wirings (find where `WorkflowServices` is assembled). Use the same `connectors.getDecryptedConfig(connectorId, secretsKey)` accessor the email runner uses:
```typescript
    resolveSecret: async ({ connectorId, key }) => {
      const cfg = await connectors.getDecryptedConfig(connectorId, secretsKey);
      return cfg[key];
    },
```
(Match the local names for `connectors` and `secretsKey` already in scope in `index.ts`.)

- [ ] **Step 6: Run the bootstrap package tests**

Run: `pnpm -C packages/bootstrap test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/connector-email-service.ts packages/bootstrap/src/connector-email-service.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): email attachments pass-through + resolveSecret service"
```

---

### Task 6: Web — palette descriptor + config form for `excel-template`

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`
- Create: `apps/web/src/workflows/components/node-forms/excel-template-form.tsx`
- Modify: `apps/web/src/workflows/components/node-forms/index.tsx`

- [ ] **Step 1: Register the template id + descriptor**

In `constants.ts`, add `'excel-template'` to `IMPLEMENTED_TEMPLATE_IDS` (in the binary/file group), and add a descriptor inside the **Files & Storage** category `items` array:
```typescript
      node('excel-template', 'action', 'Excel Template', 'Sheet', 'Fill a branded .xlsx template + autofilter + password', {
        keywords: ['xlsx', 'template', 'report', 'password'],
        data: { action: 'excel-template', config: { templateRef: '', sheetIndex: 0, startCell: 'A2', columns: [], autoFilter: '', fileName: '', binaryField: 'file' } },
      }),
```

- [ ] **Step 2: Create the config form**

```tsx
// apps/web/src/workflows/components/node-forms/excel-template-form.tsx
import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';

/** Config form for the Excel Template node. Template upload is handled by the
 *  artifact picker; `columns` is a comma-separated ordered field list. */
export function ExcelTemplateForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => update({ config: { ...config, ...p } });
  const columns = Array.isArray(config.columns) ? (config.columns as string[]).join(', ') : '';
  const pw = (config.password as { connectorId?: string; key?: string } | undefined) ?? {};

  return (
    <div className="space-y-4">
      <FormField label="Label"><TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} /></FormField>
      <FormField label="Template artifact key" hint="Object key of the uploaded .xlsx template.">
        <TextInput value={String(config.templateRef ?? '')} onChange={(e) => patch({ templateRef: e.target.value })} />
      </FormField>
      <FormField label="Start cell" hint="Top-left of the data write range, e.g. A2.">
        <TextInput value={String(config.startCell ?? 'A2')} onChange={(e) => patch({ startCell: e.target.value })} />
      </FormField>
      <FormField label="Columns (ordered)" hint="Comma-separated item fields, in template column order.">
        <TextInput value={columns} onChange={(e) => patch({ columns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
      </FormField>
      <FormField label="Auto-filter header cell" hint="e.g. A1. Leave blank to disable.">
        <TextInput value={String(config.autoFilter ?? '')} onChange={(e) => patch({ autoFilter: e.target.value })} />
      </FormField>
      <FormField label="File name" hint="Output attachment name; supports templating.">
        <TextInput value={String(config.fileName ?? '')} onChange={(e) => patch({ fileName: e.target.value })} />
      </FormField>
      <FormField label="Password connector id" hint="Connector holding the report password (optional).">
        <TextInput value={pw.connectorId ?? ''} onChange={(e) => patch({ password: { ...pw, connectorId: e.target.value } })} />
      </FormField>
      <FormField label="Password secret key" hint="Config key of the password within that connector.">
        <TextInput value={pw.key ?? ''} onChange={(e) => patch({ password: { ...pw, key: e.target.value } })} />
      </FormField>
    </div>
  );
}
```

- [ ] **Step 3: Dispatch the form**

In `node-forms/index.tsx`, add `import { ExcelTemplateForm } from './excel-template-form';` and register it in the `FORMS` registry (keyed by template id):
```typescript
  'excel-template': ExcelTemplateForm,
```
(The registry is looked up by `data.templateId`, which the sidebar stamps at drop time — so this key must match the `node('excel-template', …)` descriptor id.)

- [ ] **Step 4: Verify web builds and tests pass**

Run: `pnpm -C apps/web test`
Expected: PASS (no snapshot/type failures for the new form).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workflows/constants.ts apps/web/src/workflows/components/node-forms/excel-template-form.tsx apps/web/src/workflows/components/node-forms/index.tsx
git commit -m "feat(web): Excel Template node palette entry + config form"
```

---

### Task 7: Checkpoint — Transmission report smoke (simplest template)

**Files:**
- Create: `scripts/verify-excel-template-demo.ts`

- [ ] **Step 1: Write a standalone verification script**

Follow the existing `scripts/verify-*-demo.ts` pattern. The script builds a tiny 4-column template in-memory (`Province, LabCode, LabName, LastTransmission` — the Transmission report shape from `temp/app.js`), runs `excelTemplateHandler` with a fake binary ctx, writes the result to `scratchpad/transmission-demo.xlsx`, re-opens it, and asserts the range filled + headers preserved.

```typescript
// scripts/verify-excel-template-demo.ts
import XlsxPopulate from 'xlsx-populate';
import { excelTemplateHandler } from '../packages/workflows/src/engine/node-handlers/excel-template';
import { createContext } from '../packages/workflows/src/engine/execution-context';

async function main() {
  const tpl = await XlsxPopulate.fromBlankAsync();
  ['Province', 'LabCode', 'LabName', 'LastTransmission'].forEach((h, i) => tpl.sheet(0).cell(1, i + 1).value(h));
  const tplBytes = new Uint8Array(await tpl.outputAsync() as ArrayBuffer);

  const store = new Map<string, Uint8Array>([['tpl', tplBytes]]);
  let n = 0;
  const services = {
    readBinary: async (k: string) => store.get(k)!,
    writeBinary: async ({ bytes, fileName, contentType }: any) => { const objectKey = `a/${n++}/${fileName}`; store.set(objectKey, bytes); return { objectKey, contentType, fileName, byteSize: bytes.byteLength }; },
  } as any;
  const ctx = createContext(undefined, () => {}, [], undefined, services);
  const rows = [{ json: { Province: 'Lusaka', LabCode: 'LUS01', LabName: 'UTH', LastTransmission: '2026-06-30' } }];
  const out = await excelTemplateHandler(
    { id: 'x', type: 'action', data: { action: 'excel-template', config: { templateRef: 'tpl', startCell: 'A2', columns: ['Province', 'LabCode', 'LabName', 'LastTransmission'], autoFilter: 'A1', fileName: 'transmission.xlsx' } } },
    ctx, rows,
  );
  const ref = (out[0].binary as any).file;
  const wb = await XlsxPopulate.fromDataAsync(Buffer.from(store.get(ref.objectKey)!));
  const ok = wb.sheet(0).cell('A2').value() === 'Lusaka' && wb.sheet(0).cell('A1').value() === 'Province';
  console.log(ok ? 'PASS transmission demo' : 'FAIL transmission demo');
  if (!ok) process.exit(1);
}
main();
```

- [ ] **Step 2: Run it**

Run: `pnpm tsx scripts/verify-excel-template-demo.ts`
Expected: prints `PASS transmission demo`.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-excel-template-demo.ts
git commit -m "test(workflows): transmission-shape excel-template smoke script"
```

---

## Phase 2 — `pivot` node

### Task 8: `pivot` handler (long → wide, fixed columns)

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/pivot.ts`
- Create: `packages/workflows/src/engine/node-handlers/pivot.test.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/workflows/src/engine/node-handlers/pivot.test.ts
import { describe, it, expect } from 'vitest';
import { pivotHandler } from './pivot';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'p1', type: 'action', data: { action: 'pivot', config: cfg } });
const ctx = createContext(undefined, () => {});

describe('pivotHandler', () => {
  const input = [
    { json: { requestid: 'R1', organism: 'E.coli', drug: 'Amikacin', val: 'S', ward: 'A' } },
    { json: { requestid: 'R1', organism: 'E.coli', drug: 'Ampicillin', val: 'R', ward: 'A' } },
    { json: { requestid: 'R2', organism: 'S.aureus', drug: 'Amikacin', val: 'I', ward: 'B' } },
  ];

  it('pivots long rows into one wide row per group with fixed columns', async () => {
    const out = await pivotHandler(node({
      groupBy: ['requestid', 'organism'], pivotColumn: 'drug', valueColumn: 'val',
      columns: ['Amikacin', 'Ampicillin', 'Ceftriaxone'], carry: ['ward'],
    }), ctx, input);
    expect(out).toHaveLength(2);
    expect(out[0].json).toEqual({ requestid: 'R1', organism: 'E.coli', ward: 'A', Amikacin: 'S', Ampicillin: 'R', Ceftriaxone: '' });
    expect(out[1].json).toEqual({ requestid: 'R2', organism: 'S.aureus', ward: 'B', Amikacin: 'I', Ampicillin: '', Ceftriaxone: '' });
  });

  it('MAX-aggregates collisions within a group', async () => {
    const dup = [
      { json: { requestid: 'R1', organism: 'E.coli', drug: 'Amikacin', val: 'R' } },
      { json: { requestid: 'R1', organism: 'E.coli', drug: 'Amikacin', val: 'S' } },
    ];
    const out = await pivotHandler(node({ groupBy: ['requestid', 'organism'], pivotColumn: 'drug', valueColumn: 'val', columns: ['Amikacin'], aggregate: 'max' }), ctx, dup);
    expect(out[0].json.Amikacin).toBe('S'); // MAX of 'R','S' lexicographically
  });

  it('returns [] for empty input', async () => {
    expect(await pivotHandler(node({ groupBy: ['requestid'], pivotColumn: 'drug', valueColumn: 'val', columns: [] }), ctx, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/pivot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pivot.ts`**

```typescript
// packages/workflows/src/engine/node-handlers/pivot.ts
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Reshape long rows into wide rows: one output row per distinct groupBy key,
 *  with one column per entry in `columns` filled from pivotColumn/valueColumn.
 *  Missing values default to ''. Collisions combine via `aggregate` (max|min|first|last). */
export const pivotHandler: NodeHandler = async (node, _ctx, input) => {
  if (input.length === 0) return [];
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const groupBy = (config.groupBy as string[]) ?? [];
  const pivotColumn = String(config.pivotColumn ?? '');
  const valueColumn = String(config.valueColumn ?? '');
  const columns = (config.columns as string[]) ?? [];
  const carry = (config.carry as string[]) ?? [];
  const aggregate = String(config.aggregate ?? 'max');
  if (groupBy.length === 0 || !pivotColumn || !valueColumn) {
    throw new Error('Pivot node: groupBy, pivotColumn and valueColumn are required');
  }

  const combine = (prev: unknown, next: unknown): unknown => {
    if (prev === undefined || prev === '') return next;
    if (next === undefined || next === '') return prev;
    switch (aggregate) {
      case 'min': return String(next) < String(prev) ? next : prev;
      case 'first': return prev;
      case 'last': return next;
      case 'max': default: return String(next) > String(prev) ? next : prev;
    }
  };

  const groups = new Map<string, WorkflowItem>();
  for (const it of input) {
    const key = groupBy.map((g) => String(it.json[g] ?? '')).join(' ');
    let row = groups.get(key);
    if (!row) {
      const json: Record<string, unknown> = {};
      for (const g of groupBy) json[g] = it.json[g];
      for (const c of carry) json[c] = it.json[c];
      for (const c of columns) json[c] = '';
      row = { json };
      groups.set(key, row);
    }
    const col = String(it.json[pivotColumn] ?? '');
    if (columns.includes(col)) row.json[col] = combine(row.json[col], it.json[valueColumn]);
  }
  return [...groups.values()];
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/pivot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the handler**

In `index.ts` add `import { pivotHandler } from './pivot';` and the entry `'pivot': pivotHandler,` in `ACTION_HANDLERS`.

- [ ] **Step 6: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/pivot.ts packages/workflows/src/engine/node-handlers/pivot.test.ts packages/workflows/src/engine/node-handlers/index.ts
git commit -m "feat(workflows): pivot node (long→wide, fixed columns, aggregate)"
```

---

### Task 9: Web — palette descriptor + config form for `pivot`

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`
- Create: `apps/web/src/workflows/components/node-forms/pivot-form.tsx`
- Modify: `apps/web/src/workflows/components/node-forms/index.tsx`

- [ ] **Step 1: Register the template id + descriptor**

In `constants.ts`, add `'pivot'` to `IMPLEMENTED_TEMPLATE_IDS` (data transforms group), and add to the **Data Transformation** category `items`:
```typescript
      node('pivot', 'action', 'Pivot', 'Table2', 'Reshape long rows into wide columns', {
        keywords: ['pivot', 'crosstab', 'wide', 'transpose'],
        data: { action: 'pivot', config: { groupBy: [], pivotColumn: '', valueColumn: '', columns: [], carry: [], aggregate: 'max' } },
      }),
```

- [ ] **Step 2: Create the config form**

```tsx
// apps/web/src/workflows/components/node-forms/pivot-form.tsx
import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { FormField, Select, TextInput } from './shared';

const list = (v: unknown) => (Array.isArray(v) ? (v as string[]).join(', ') : '');
const parse = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function PivotForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => update({ config: { ...config, ...p } });
  return (
    <div className="space-y-4">
      <FormField label="Label"><TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} /></FormField>
      <FormField label="Group by" hint="Comma-separated key fields (one output row per unique key).">
        <TextInput value={list(config.groupBy)} onChange={(e) => patch({ groupBy: parse(e.target.value) })} />
      </FormField>
      <FormField label="Pivot column" hint="Field whose values become new column names.">
        <TextInput value={String(config.pivotColumn ?? '')} onChange={(e) => patch({ pivotColumn: e.target.value })} />
      </FormField>
      <FormField label="Value column" hint="Field supplying the cell values.">
        <TextInput value={String(config.valueColumn ?? '')} onChange={(e) => patch({ valueColumn: e.target.value })} />
      </FormField>
      <FormField label="Output columns" hint="Comma-separated fixed allow-list of pivot columns.">
        <TextInput value={list(config.columns)} onChange={(e) => patch({ columns: parse(e.target.value) })} />
      </FormField>
      <FormField label="Carry fields" hint="Comma-separated extra fields to keep from each group.">
        <TextInput value={list(config.carry)} onChange={(e) => patch({ carry: parse(e.target.value) })} />
      </FormField>
      <FormField label="Aggregate" hint="How to combine collisions within a group.">
        <Select value={String(config.aggregate ?? 'max')} onChange={(e) => patch({ aggregate: e.target.value })}>
          <option value="max">Max</option><option value="min">Min</option><option value="first">First</option><option value="last">Last</option>
        </Select>
      </FormField>
    </div>
  );
}
```

- [ ] **Step 3: Dispatch the form**

In `node-forms/index.tsx`, add `import { PivotForm } from './pivot-form';` and register it in the `FORMS` registry (keyed by template id):
```typescript
  'pivot': PivotForm,
```

- [ ] **Step 4: Verify web tests**

Run: `pnpm -C apps/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workflows/constants.ts apps/web/src/workflows/components/node-forms/pivot-form.tsx apps/web/src/workflows/components/node-forms/index.tsx
git commit -m "feat(web): Pivot node palette entry + config form"
```

---

## Phase 3 — `combineByKey` merge mode

### Task 10: Extend `merge` with a keyed join

**Files:**
- Modify: `packages/workflows/src/engine/node-handlers/merge.ts`
- Modify: `packages/workflows/src/engine/node-handlers/merge.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `merge.test.ts` (follow the file's existing pattern of seeding `ctx.nodeOutputs` + `ctx.edges` so the handler discovers branches; the left branch is the edge listed first):
```typescript
  it('combineByKey left-joins branches on the key fields', async () => {
    const left = [{ json: { requestid: 'R1', organism: 'E.coli', ward: 'A' } }, { json: { requestid: 'R2', organism: 'S.aureus', ward: 'B' } }];
    const right = [{ json: { requestid: 'R1', organism: 'E.coli', Amikacin: 'S' } }];
    const ctx = createContext(undefined, () => {}, [
      { id: 'e1', source: 'L', target: 'm1' },
      { id: 'e2', source: 'R', target: 'm1' },
    ]);
    ctx.nodeOutputs = { L: left, R: right };
    const out = await mergeHandler({ id: 'm1', type: 'action', data: { config: { mode: 'combineByKey', joinKeys: ['requestid', 'organism'], joinType: 'left' } } } as any, ctx, []);
    expect(out).toHaveLength(2);
    expect(out[0].json).toEqual({ requestid: 'R1', organism: 'E.coli', ward: 'A', Amikacin: 'S' });
    expect(out[1].json).toEqual({ requestid: 'R2', organism: 'S.aureus', ward: 'B' }); // unmatched left kept
  });

  it('combineByKey inner join drops unmatched left rows', async () => {
    const ctx = createContext(undefined, () => {}, [
      { id: 'e1', source: 'L', target: 'm1' },
      { id: 'e2', source: 'R', target: 'm1' },
    ]);
    ctx.nodeOutputs = { L: [{ json: { k: 1, a: 1 } }, { json: { k: 2, a: 2 } }], R: [{ json: { k: 1, b: 9 } }] };
    const out = await mergeHandler({ id: 'm1', type: 'action', data: { config: { mode: 'combineByKey', joinKeys: ['k'], joinType: 'inner' } } } as any, ctx, []);
    expect(out).toEqual([{ json: { k: 1, a: 1, b: 9 } }]);
  });
```
(Ensure `createContext` is imported in this test file; add the import if absent.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/merge.test.ts`
Expected: FAIL — `combineByKey` returns `[]` (unknown mode falls through to append).

- [ ] **Step 3: Implement the mode in `merge.ts`**

Add a case before `default`:
```typescript
    case 'combineByKey': {
      const joinKeys = (config.joinKeys as string[]) ?? [];
      const joinType = (config.joinType as string) ?? 'left';
      if (joinKeys.length === 0) throw new Error('Merge combineByKey: joinKeys is required');
      const [leftItems = [], ...rest] = branches;
      const rightItems = rest.flat();
      const keyOf = (it: WorkflowItem) => joinKeys.map((k) => String(it.json[k] ?? '')).join(' ');
      const rightIndex = new Map<string, WorkflowItem>();
      for (const r of rightItems) if (!rightIndex.has(keyOf(r))) rightIndex.set(keyOf(r), r);
      const out: WorkflowItem[] = [];
      for (const l of leftItems) {
        const match = rightIndex.get(keyOf(l));
        if (match) out.push({ json: { ...l.json, ...match.json }, ...(l.binary ? { binary: l.binary } : {}) });
        else if (joinType !== 'inner') out.push(l);
      }
      return out;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/merge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/merge.ts packages/workflows/src/engine/node-handlers/merge.test.ts
git commit -m "feat(workflows): merge combineByKey (keyed left/inner join)"
```

---

### Task 11: Web — expose `combineByKey` in the merge form

**Files:**
- Modify: `apps/web/src/workflows/components/node-forms/merge-form.tsx`

- [ ] **Step 1: Add the option + fields**

In `merge-form.tsx`, add `<option value="combineByKey">Combine by key (join)</option>` to the mode `Select`, and render join fields when `mode === 'combineByKey'`:
```tsx
      {mode === 'combineByKey' && (
        <>
          <FormField label="Join keys" hint="Comma-separated fields matched between the two branches.">
            <TextInput
              value={Array.isArray(config.joinKeys) ? (config.joinKeys as string[]).join(', ') : ''}
              onChange={(e) => patchConfig({ joinKeys: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </FormField>
          <FormField label="Join type" hint="Left keeps unmatched first-branch rows; inner drops them.">
            <Select value={(config.joinType as string) ?? 'left'} onChange={(e) => patchConfig({ joinType: e.target.value })}>
              <option value="left">Left</option>
              <option value="inner">Inner</option>
            </Select>
          </FormField>
        </>
      )}
```
Also update the mode `FormField` hint to mention "Combine by key: SQL-style join on key fields."

- [ ] **Step 2: Verify web tests**

Run: `pnpm -C apps/web test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/workflows/components/node-forms/merge-form.tsx
git commit -m "feat(web): merge form exposes combineByKey join"
```

---

## Phase 4 — AMR Ndola reference (seed + end-to-end)

Context: the AMR proc (`temp/Stored Procedure.txt`) reads an external LIMS DB
(`OpenLDRData.dbo.{requests,labresults,patients,ASTResults}`). In CE the workflow
points a **connector** at that DB. For the e2e we seed a **Postgres** fixture with
the minimal columns the two extract `SELECT`s read, to prove portability without
the live MSSQL.

### Task 12: Define the AMR column constants

**Files:**
- Create: `packages/workflows/src/reports/amr-columns.ts`
- Create: `packages/workflows/src/reports/amr-columns.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/workflows/src/reports/amr-columns.test.ts
import { describe, it, expect } from 'vitest';
import { AMR_ANTIBIOTICS, AMR_TEMPLATE_COLUMNS } from './amr-columns';

describe('amr columns', () => {
  it('has the full antibiotic pivot set', () => {
    expect(AMR_ANTIBIOTICS).toContain('Amikacin');
    expect(AMR_ANTIBIOTICS).toContain('Vancomycin');
    expect(AMR_ANTIBIOTICS.length).toBe(54);
  });
  it('template column order starts with identifiers and ends with Comment', () => {
    expect(AMR_TEMPLATE_COLUMNS[0]).toBe('cultureTestCode');
    expect(AMR_TEMPLATE_COLUMNS[AMR_TEMPLATE_COLUMNS.length - 1]).toBe('Comment');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/reports/amr-columns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the constants**

Transcribe the antibiotic list from the SP `PIVOT` (`temp/Stored Procedure.txt` lines 42–54) and the template column order from `temp/app.js` (the `AMR_temp.xlsx` `bb.map` at lines 109–113):
```typescript
// packages/workflows/src/reports/amr-columns.ts
/** Antibiotic substances pivoted long→wide (from sp_Ndola_ast_data_month PIVOT). */
export const AMR_ANTIBIOTICS = [
  'Amikacin', 'Amoxycillin', 'Amoxycillin/Clavulanic acid', 'Ampicillin', 'Ampicillin/Sulbactum',
  'Azithromycin', 'Carbenicillin', 'Cefazolin', 'Cefepime', 'Cefotaxime', 'Cefoxitin Screen',
  'Ceftazidime', 'Ceftriaxone', 'Cefuroxime', 'Cefuroxime (oral)', 'Cefuroxime (Parenteral)',
  'Cefuroxime Axetil', 'Cephalothin', 'Chloramphenicol', 'Ciprofloxacin', 'Clarithromycin',
  'Clindamycin', 'Co-amoxiclav', 'Co-trimoxazole', 'Colistin', 'Doripenem', 'Doxycycline',
  'Ertapenem', 'Erythromycin', 'Gentamicin', 'Imipenem', 'Levofloxacin', 'Linezolid', 'Meropenem',
  'Minocycline', 'Moxifloxacin', 'Nalidixic Acid', 'Nitrofurantoin', 'Norfloxacin', 'Oxacillin',
  'Penicillin', 'Piperacillin', 'Piperacillin/Tazobactam', 'Polymyxin B', 'Quinupristin/Dalfopristin',
  'Rifampicin', 'Tetracycline', 'Ticarcillin', 'Tigecycline', 'Tobramycin', 'Trimethoprim',
  'Trimethoprim/Sulfamethoxazole', 'Vancomycin', 'Gram Results',
] as const;

/** Full AMR_temp.xlsx column order (A→BV) from temp/app.js. */
export const AMR_TEMPLATE_COLUMNS = [
  'cultureTestCode', 'CultureTestDescription', 'LIMSRptResult', 'RequestID', 'LIMSSpecimenSourceCode',
  'LIMSSpecimenSourceDesc', 'IdentificationNumber', 'AccessionDate', 'SpecimenDate', 'FIRSTNAME',
  'LastName', 'AgeInYears', 'DOB', 'sex', 'LocationCode', 'Location', 'AST_TestCode', 'AST_Test',
  'ORGANISM', 'Gram Results',
  ...AMR_ANTIBIOTICS.filter((a) => a !== 'Gram Results'),
  'Comment',
] as const;
```
(If the transcribed antibiotic count differs from 54, update the test's expected length to match the actual transcription — the SP is the source of truth, not the number.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/reports/amr-columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/reports/amr-columns.ts packages/workflows/src/reports/amr-columns.test.ts
git commit -m "feat(workflows): AMR report column constants (from SP + template)"
```

---

### Task 13: End-to-end AMR pipeline test (engine-level, seeded rows)

**Files:**
- Create: `packages/workflows/src/reports/amr-pipeline.test.ts`

This test wires the new nodes together in-process (no DB/connector — it feeds the
two extracts as literal item arrays, standing in for the portable `SELECT`s) and
asserts the materialized shape + a password-protected xlsx.

- [ ] **Step 1: Write the test**

```typescript
// packages/workflows/src/reports/amr-pipeline.test.ts
import { describe, it, expect } from 'vitest';
import XlsxPopulate from 'xlsx-populate';
import { pivotHandler } from '../engine/node-handlers/pivot';
import { mergeHandler } from '../engine/node-handlers/merge';
import { excelTemplateHandler } from '../engine/node-handlers/excel-template';
import { createContext } from '../engine/execution-context';
import { AMR_ANTIBIOTICS, AMR_TEMPLATE_COLUMNS } from './amr-columns';
import type { BinaryRef } from '../engine/items';

describe('AMR Ndola pipeline (nodes composed)', () => {
  it('extract → pivot → join → template produces a filled, password-protected xlsx', async () => {
    // Stand-ins for the two portable SELECTs.
    const isolates = [{ json: { requestid: 'R1', organism: 'E.coli', cultureTestCode: 'CULUR', CultureTestDescription: 'Urine Culture', LIMSRptResult: 'E.coli', RequestID: 'R1', LIMSSpecimenSourceCode: 'UR', LIMSSpecimenSourceDesc: 'Urine', IdentificationNumber: 'H1', AccessionDate: '2026-06-02', SpecimenDate: '2026-06-01', FIRSTNAME: 'Jane', LastName: 'Doe', AgeInYears: 34, DOB: '1992-01-01', sex: 'F', LocationCode: 'W1', Location: 'Ward 1', AST_TestCode: 'SENS', AST_Test: 'Sensitivity', ORGANISM: 'E.coli' } }];
    const astLong = [
      { json: { requestid: 'R1', organism: 'E.coli', LIMSSubstanceName: 'Amikacin', ASTValue: 'S' } },
      { json: { requestid: 'R1', organism: 'E.coli', LIMSSubstanceName: 'Ampicillin', ASTValue: 'R' } },
    ];

    const ctx = createContext(undefined, () => {}, [
      { id: 'e1', source: 'isolates', target: 'join' },
      { id: 'e2', source: 'pivot', target: 'join' },
    ]);

    const pivoted = await pivotHandler(
      { id: 'pivot', type: 'action', data: { config: { groupBy: ['requestid', 'organism'], pivotColumn: 'LIMSSubstanceName', valueColumn: 'ASTValue', columns: [...AMR_ANTIBIOTICS], aggregate: 'max' } } } as any,
      ctx, astLong,
    );
    ctx.nodeOutputs = { isolates, pivot: pivoted };
    const joined = await mergeHandler(
      { id: 'join', type: 'action', data: { config: { mode: 'combineByKey', joinKeys: ['requestid', 'organism'], joinType: 'left' } } } as any,
      ctx, [],
    );
    expect(joined[0].json.Amikacin).toBe('S');
    expect(joined[0].json.Ampicillin).toBe('R');

    // Build a template with the header row, then fill it.
    const tpl = await XlsxPopulate.fromBlankAsync();
    AMR_TEMPLATE_COLUMNS.forEach((h, i) => tpl.sheet(0).cell(1, i + 1).value(h));
    const tplBytes = new Uint8Array(await tpl.outputAsync() as ArrayBuffer);
    const store = new Map<string, Uint8Array>([['tpl', tplBytes]]);
    let n = 0;
    (ctx as any).services = {
      readBinary: async (k: string) => store.get(k)!,
      writeBinary: async ({ bytes, fileName, contentType }: any) => { const objectKey = `a/${n++}/${fileName}`; store.set(objectKey, bytes); return { objectKey, contentType, fileName, byteSize: bytes.byteLength }; },
      resolveSecret: async () => 'Micro!',
    };
    const out = await excelTemplateHandler(
      { id: 'xt', type: 'action', data: { config: { templateRef: 'tpl', startCell: 'A2', columns: [...AMR_TEMPLATE_COLUMNS], autoFilter: 'A1', fileName: 'amr.xlsx', password: { connectorId: 'c', key: 'amr_pw' } } } } as any,
      ctx, joined,
    );
    const ref = (out[0].binary as Record<string, BinaryRef>).file;
    const wb = await XlsxPopulate.fromDataAsync(Buffer.from(store.get(ref.objectKey)!), { password: 'Micro!' });
    expect(wb.sheet(0).cell('A2').value()).toBe('CULUR'); // first template column filled
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/reports/amr-pipeline.test.ts`
Expected: PASS (proves pivot + combineByKey + excel-template compose correctly end-to-end).

- [ ] **Step 3: Commit**

```bash
git add packages/workflows/src/reports/amr-pipeline.test.ts
git commit -m "test(workflows): AMR Ndola pipeline (pivot+join+template) e2e"
```

---

### Task 14: Seed script + saved AMR workflows (manual acceptance)

**Files:**
- Create: `scripts/seed-amr-report-demo.ts`

This produces the two saved workflows (Materialize + Report) as JSON the builder
can import, plus a seeded Postgres fixture, so the team can run the real
connector→pivot→template→email path. It follows the existing `scripts/seed-*-demo.ts`
pattern (DB URL from env, idempotent inserts).

- [ ] **Step 1: Write the seed script**

The script must:
1. Connect to a Postgres fixture DB (`process.env.AMR_FIXTURE_URL`) and create/populate minimal tables `requests`, `labresults`, `patients`, `astresults` with a handful of AMR rows (one isolate + a few AST substances) covering the columns the two extract SELECTs read.
2. Emit two workflow JSON files under `scratchpad/`:
   - `amr-materialize.workflow.json`: `schedule-trigger → set(dates) → [microsoft-sql/postgres "isolates" SELECT] and [… "ast_long" SELECT → pivot] → merge(combineByKey) → materialize-dataset "amr_ndola_monthly"`.
   - `amr-report.workflow.json`: `schedule-trigger → load-dataset "amr_ndola_monthly" → excel-template(AMR_temp) → send-email`.
   Use `AMR_ANTIBIOTICS` / `AMR_TEMPLATE_COLUMNS` from `@openldr/workflows` for the pivot + template `columns`.
3. Print the two portable extract SQL statements (parameterized by `:periodStart`/`:periodEnd`) so a reviewer can paste them into the DB nodes.

Extract SQL to embed (portable — no PIVOT, ANSI `CASE` kept inline):
```sql
-- isolates
SELECT r.requestid,
       l.limsrptresult          AS organism,
       r.limspanelcode          AS "cultureTestCode",
       r.limspaneldesc          AS "CultureTestDescription",
       l.limsrptresult          AS "LIMSRptResult",
       r.requestid              AS "RequestID",
       r.limsspecimensourcecode AS "LIMSSpecimenSourceCode",
       CASE r.limspanelcode WHEN 'CULPU' THEN 'Pus' WHEN 'CULUR' THEN 'Urine'
            WHEN 'CULBC' THEN 'Blood' ELSE r.limsspecimensourcedesc END AS "LIMSSpecimenSourceDesc",
       p.firstname AS "FIRSTNAME", p.surname AS "LastName", p.ageinyears AS "AgeInYears",
       p.dob AS "DOB", r.hl7sexcode AS sex, p.ward AS "LocationCode",
       r.limspointofcaredesc AS "Location", r.registereddatetime AS "AccessionDate",
       r.specimendatetime AS "SpecimenDate", r.limspanelcode AS "AST_TestCode",
       r.limspaneldesc AS "AST_Test", l.limsrptresult AS "ORGANISM"
FROM requests r
JOIN labresults l ON r.requestid = l.requestid AND r.obrsetid = l.obrsetid
JOIN patients p ON r.requestid = p.requestid
WHERE (r.limspaneldesc ILIKE '%cult%' OR r.limspaneldesc ILIKE '%microbiology%')
  AND l.limsobservationcode LIKE 'ORGS%'
  AND r.testingfacilitycode = 'ZNP'
  AND r.authoriseddatetime IS NOT NULL
  AND r.registereddatetime >= :periodStart AND r.registereddatetime < :periodEnd;

-- ast_long
SELECT r.requestid, a.organism AS organism,
       a.limssubstancename AS "LIMSSubstanceName", a.astvalue AS "ASTValue"
FROM astresults a
JOIN requests r ON a.requestid = r.requestid AND a.obrsetid = r.obrsetid
WHERE r.limspaneldesc ILIKE '%sens%'
  AND r.testingfacilitycode = 'ZNP'
  AND r.authoriseddatetime IS NOT NULL
  AND r.registereddatetime >= :periodStart AND r.registereddatetime < :periodEnd;
```
(Note: `ILIKE` is Postgres; for a MSSQL connector the equivalent is `LIKE` with a case-insensitive collation — document both in the script's comments. The connector's dialect determines which to paste.)

- [ ] **Step 2: Run it against a fixture DB**

Run: `AMR_FIXTURE_URL=postgres://... pnpm tsx scripts/seed-amr-report-demo.ts`
Expected: prints `seeded N rows` and writes the two `*.workflow.json` files to `scratchpad/`.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-amr-report-demo.ts
git commit -m "test(workflows): AMR report seed + saved workflow generator"
```

---

### Task 15: Full gate + memory update

- [ ] **Step 1: Run the full monorepo gate**

Run: `pnpm turbo run typecheck test --force`
Expected: all packages green. If `@openldr/web#test` flakes, re-run `pnpm -C apps/web test` in isolation and trust that result.

- [ ] **Step 2: Manual browser acceptance (checkpoint, not automated)**

In the running app: open Workflow Builder, confirm **Excel Template**, **Pivot** appear in the palette and **Merge → Combine by key** is selectable; import the two `scratchpad/*.workflow.json`, upload `temp/AMR_temp.xlsx` as the template artifact, set the SMTP + password connectors, run Materialize then Report, and confirm a password-protected `.xlsx` is emailed.

- [ ] **Step 3: Update the workflow-node-palette memory**

Append to `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\workflow-node-palette.md`: the three new nodes (`excel-template`, `pivot`, `combineByKey` merge mode), the email-attachment + `resolveSecret` service additions, and that the AMR Ndola report is the reference for the Zambia pm2 migration. Update `MEMORY.md` index line if the hook changes.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(workflows): report-pipeline MVP gate green + memory notes"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** excel-template (Task 2–3, 6), pivot (Task 8–9), combineByKey (Task 10–11), email attachments (Task 4–5), secret-resolved password (Task 3, 5), portable extracts + date bounds (Task 14 SQL uses `:periodStart`/`:periodEnd`; the `set` node computes them), materialize/load handoff (Task 14 graphs), AMR reference + seed (Task 12–14), Transmission smoke (Task 7). All spec sections map to a task.
- **Deferred (out of scope, per spec):** the other 24 reports, province fan-out via `execute-workflow`, recipient-list UI, pre-send `wait`. Do not implement here.
- **Type consistency:** `resolveSecret({connectorId,key})`, `runConnectorEmail({...attachments:[{filename,content,contentType}]})`, and the `password:{connectorId,key}` config shape are used identically in engine, bootstrap, and web tasks.
```
