# Marketplace C2 — Form Export (unsigned bundle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin export a published form as an unsigned `form-template` bundle `.zip` (manifest.json + questionnaire.json), to be signed off-server via the `artifact` CLI and published via A2.

**Architecture:** A new `GET /api/forms/:id/export-bundle` builds an unsigned bundle in memory (computed `questionnaireSha256`, placeholder publisher, no signature) and streams a `.zip` (new server dep `adm-zip`). The Forms page gets an "Export as marketplace bundle" action that triggers the download. Phase 2 of sub-project C; builds on C1.

**Tech Stack:** Fastify, `adm-zip`, React + react-i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-marketplace-c-form-lifecycle-design.md` (§3.4, §4 export→publish).

---

## File Structure

- Modify: `apps/server/package.json` — add `adm-zip` (+ `@types/adm-zip` dev)
- Modify: `apps/server/src/forms-routes.ts` — `GET /api/forms/:id/export-bundle`
- Modify: `apps/server/src/forms-routes.test.ts` — export-bundle test (create if no such test file; otherwise extend)
- Modify: `apps/web/src/api.ts` — `exportFormBundle(id)` (triggers a download)
- Modify: `apps/web/src/pages/Forms.tsx` — "Export as marketplace bundle" action
- Modify: `apps/web/src/pages/Forms.test.tsx` — export action test
- Modify: `apps/web/src/i18n/{en,fr,pt}.ts` — `exportBundle` key (+ `exportNotPublished`)

---

## Task 1: Add `adm-zip`

**Files:** Modify `apps/server/package.json`

- [ ] **Step 1: Add the dependency**

In `apps/server/package.json`, add to `dependencies`: `"adm-zip": "^0.5.16"`, and to `devDependencies`: `"@types/adm-zip": "^0.5.7"`. Then install:

Run: `pnpm install`
Expected: lockfile updates, adm-zip resolved.

- [ ] **Step 2: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml
git commit -m "build(server): add adm-zip for form bundle export"
```

---

## Task 2: Export endpoint (TDD)

**Files:**
- Modify: `apps/server/src/forms-routes.ts`
- Modify/Create: `apps/server/src/forms-routes.test.ts`

- [ ] **Step 1: Write the failing test**

FIRST read `apps/server/src/forms-routes.test.ts` if it exists to match its harness (fake `ctx.forms`, Fastify `appWith`). If it does not exist, mirror `marketplace-routes.test.ts`'s Fastify+fake-ctx pattern. Add:

```ts
import AdmZip from 'adm-zip';
// ...
it('exports a published form as an unsigned form-template bundle zip', async () => {
  const questionnaire = { resourceType: 'Questionnaire', status: 'active', title: 'Intake', item: [] };
  const forms = {
    get: async (id: string) => (id === 'form-1' ? { id, name: 'Specimen Intake', versionLabel: '2.0.0' } : null),
    listVersions: async () => [{ version: 3 }, { version: 2 }],
    getVersion: async (_id: string, v: number) => (v === 3 ? { questionnaire } : null),
  };
  const app = appWithForms({ forms });
  const res = await app.inject({ method: 'GET', url: '/api/forms/form-1/export-bundle' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('zip');
  const zip = new AdmZip(res.rawPayload as Buffer);
  const names = zip.getEntries().map((e) => e.entryName).sort();
  expect(names).toEqual(['manifest.json', 'questionnaire.json']);
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  expect(manifest).toMatchObject({ type: 'form-template', id: 'specimen-intake', version: '2.0.0' });
  expect(manifest.payload).toMatchObject({ kind: 'form-template' });
  // sha matches the questionnaire bytes actually written
  const qBytes = zip.readFile('questionnaire.json') as Buffer;
  const { createHash } = await import('node:crypto');
  expect(manifest.payload.questionnaireSha256).toBe(createHash('sha256').update(qBytes).digest('hex'));
  expect(manifest.publisher).toBeUndefined();
  expect(manifest.signature).toBeUndefined();
});

it('404s when the form has no published version', async () => {
  const forms = { get: async () => ({ id: 'form-2', name: 'Draft', versionLabel: null }), listVersions: async () => [], getVersion: async () => null };
  const app = appWithForms({ forms });
  const res = await app.inject({ method: 'GET', url: '/api/forms/form-2/export-bundle' });
  expect(res.statusCode).toBe(404);
});
```

Provide an `appWithForms` helper if the file lacks one:
```ts
import Fastify from 'fastify';
import { registerFormsRoutes } from './forms-routes';
function appWithForms(ctx: Record<string, unknown>, roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles } as never; });
  registerFormsRoutes(app, ctx as never);
  return app;
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/server test -- forms-routes`
Expected: FAIL — `/export-bundle` 404 (route absent).

- [ ] **Step 3: Implement — `apps/server/src/forms-routes.ts`**

Add imports at the top:
```ts
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { requireRole } from './rbac';
```
(If `requireRole` is already imported, don't duplicate.)

Add a slug helper near the top of the file (after imports):
```ts
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'form';
}
```

Add the route inside `registerFormsRoutes` (after the existing `/api/forms/:id/questionnaire` route):
```ts
  app.get('/api/forms/:id/export-bundle', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const form = await ctx.forms.get(id);
    if (!form) { reply.code(404); return { error: 'form not found' }; }
    const versions = await ctx.forms.listVersions(id);
    if (!versions.length) { reply.code(404); return { error: 'form has no published version to export' }; }
    const latest = await ctx.forms.getVersion(id, versions[0].version);
    if (!latest) { reply.code(404); return { error: 'published version not found' }; }

    const questionnaireBytes = Buffer.from(JSON.stringify(latest.questionnaire, null, 2), 'utf8');
    const questionnaireSha256 = createHash('sha256').update(questionnaireBytes).digest('hex');
    const artifactId = slug(form.name);
    const version = form.versionLabel ?? '1.0.0';
    const manifest = {
      schemaVersion: 1,
      type: 'form-template',
      id: artifactId,
      version,
      description: form.name,
      license: 'UNLICENSED',
      compatibility: { ceVersion: '*' },
      capabilities: [],
      payload: { kind: 'form-template', questionnaireSha256 },
    };

    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    zip.addFile('questionnaire.json', questionnaireBytes);
    const buf = zip.toBuffer();

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${artifactId}-${version}.zip"`);
    return reply.send(buf);
  });
```

> Note: the `questionnaire.json` bytes written here (`JSON.stringify(latest.questionnaire, null, 2)`) are what `questionnaireSha256` hashes — they must be identical (same serialization) so the maintainer's `artifact sign`/`verifyBundle` sees a matching sha. The implementation hashes the exact bytes it writes, so this holds.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C apps/server test -- forms-routes`
Expected: PASS.
Run: `pnpm -C apps/server typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git commit -m "feat(server): GET /api/forms/:id/export-bundle (unsigned form-template zip)"
```

---

## Task 3: Web — Forms "Export as marketplace bundle" action

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/Forms.tsx`
- Modify: `apps/web/src/pages/Forms.test.tsx`
- Modify: `apps/web/src/i18n/{en,fr,pt}.ts`

- [ ] **Step 1: api.ts — `exportFormBundle`**

Add (using the existing `authFetch` helper; it returns a `Response`, from which we read a blob and trigger a download):
```ts
export async function exportFormBundle(id: string): Promise<void> {
  const r = await authFetch(`/api/forms/${encodeURIComponent(id)}/export-bundle`, { method: 'GET' });
  if (!r.ok) throw new Error(`export failed: ${r.status}`);
  const blob = await r.blob();
  const disposition = r.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `${id}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: i18n keys (en/fr/pt `forms` namespace — match where Forms.tsx pulls its strings; if Forms uses a `forms.*` block, add there)**

FIRST read `apps/web/src/pages/Forms.tsx` to see which i18n namespace it uses. Add an `exportBundle` label and an `exportNotPublished` error in that namespace for all three locales, e.g.:
- en: `exportBundle: 'Export as marketplace bundle'`, `exportNotPublished: 'Publish the form before exporting.'`
- fr: `exportBundle: 'Exporter comme bundle marketplace'`, `exportNotPublished: 'Publiez le formulaire avant de l’exporter.'`
- pt: `exportBundle: 'Exportar como bundle do marketplace'`, `exportNotPublished: 'Publique o formulário antes de exportar.'`

(Keep EnShape key parity across en/fr/pt.)

- [ ] **Step 3: Forms.tsx — add the action**

Read `apps/web/src/pages/Forms.tsx` to find the per-form row/card actions (e.g. an actions menu or buttons). Add an "Export as marketplace bundle" action for each **published** form (gate on the form's `status === 'published'`). On click call `exportFormBundle(form.id)`; on error show a toast (reuse the page's existing toast pattern — sonner `toast.error`). Use `data-testid={`export-bundle-${form.id}`}` for the action.

If Forms.tsx uses a dropdown/kebab menu per row, add a `DropdownMenuItem`; if it uses inline buttons, add a `Button variant="outline" size="sm"`. Match the existing pattern in the file.

- [ ] **Step 4: Forms.test.tsx — export action test**

Add a test that mocks `exportFormBundle` and asserts it's called for a published form:
```ts
// add exportFormBundle: vi.fn() to the @/api mock
it('exports a published form as a bundle', async () => {
  // arrange: list returns one published form (match the file's existing mock shape)
  (api.exportFormBundle as any).mockResolvedValue(undefined);
  // ...render Forms, open the row action if needed...
  fireEvent.click(await screen.findByTestId('export-bundle-form-1'));
  await waitFor(() => expect(api.exportFormBundle).toHaveBeenCalledWith('form-1'));
});
```
Match the file's existing mock/list shape and Radix interaction workarounds.

- [ ] **Step 5: Verify**

Run: `pnpm -C apps/web test -- Forms` → PASS.
Run: `pnpm -C apps/web typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/pages/Forms.tsx apps/web/src/pages/Forms.test.tsx apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): Forms 'Export as marketplace bundle' action"
```

---

## Task 4: Full verification gate

- [ ] **Step 1: Run the gate (capture true exit code — do NOT pipe through tail)**

Run: `pnpm turbo typecheck lint test build --filter=@openldr/web --filter=@openldr/server > /tmp/c2-gate.log 2>&1; echo "EXIT=$?"`
Inspect `/tmp/c2-gate.log`. Expected `EXIT=0`, all tasks successful (re-run once if a transient turbo flake; trust the captured EXIT code, not a piped tail).

- [ ] **Step 2: Commit any lint autofixes**

```bash
git add -A && git commit -m "chore(marketplace): C2 form-export gate green" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage (C2):** export endpoint builds an unsigned bundle (manifest + questionnaire.json) with computed `questionnaireSha256`, no publisher/signature (Task 2) ✓; zip stream w/ `Content-Disposition` (Task 2) ✓; Forms export action triggering the download (Task 3) ✓; 404 when no published version (Task 2) ✓.
- **Off-server signing preserved:** the export is unsigned — `manifest.publisher`/`signature` are absent; the maintainer's `artifact sign` adds them before A2 publish. No key material on the server.
- **Sha integrity:** the route hashes the exact `questionnaire.json` bytes it writes, so a later `verifyBundle` (after signing) sees a matching `questionnaireSha256`.
- **Type consistency:** export reads `ctx.forms.get` + `listVersions` + `getVersion(id, version).questionnaire` (the published snapshot from C1's understanding of the forms store).
- **Dep added:** `adm-zip` (+ types) — small, widely used; in-memory `toBuffer()`.
- **End-to-end (with C1 + A2):** author/publish a form → Export → unsigned `.zip` → `artifact sign` → stage in `MARKETPLACE_REGISTRY_DIR` → A2 Publish to GitHub → merge → others install via A1 / C1.
