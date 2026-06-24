# DHIS2 Sink SP-7 — Plugin Docs + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give plugins first-class docs that travel *with* the plugin (a signed `readme` in the marketplace manifest, rendered on the Marketplace ▸ plugin detail page), ship a thorough `dhis2-sink` setup/test guide (with screenshots) as that readme, publish `dhis2-sink` to the registry, and clear three rough edges (dialog padding, a stale DHIS2 "Connection" card, fr/pt doc gaps).

**Architecture:** The marketplace artifact manifest gains an optional `readme` (markdown) field. Because signing covers the manifest's canonical bytes (`canonicalSigningBytes` omits only `signature`), `readme` is signed automatically — no signing changes. It threads through the existing adapters (`pluginManifestToArtifact`/`artifactToPluginManifest`), the registry sources (local + http), and the `GET /api/marketplace/available/:ref` detail response to the web `AvailableArtifactDetail`. A small sanitized markdown renderer (react-markdown + remark-gfm, already deps; `img` restricted to `data:image/*` + `https:`) renders it in a new Docs section on `PackageDetail`. The `dhis2-sink` readme is authored as `wasm/dhis2-sink/docs/README.md` with sibling PNG screenshots; `build-dhis2-sink.mjs` inlines those PNGs as `data:` URIs into `manifest.readme` at build time (self-contained, signable).

**Tech Stack:** TypeScript, zod (marketplace schema), Ed25519 signing (`@openldr/marketplace`), React + react-markdown + remark-gfm, react-i18next (en/fr/pt parity enforced at compile), Vitest + Testing Library, the `market` publish flow → GitHub PR to `../openldr-ce-marketplace`.

---

## Pre-flight (orchestrator, before Task 1)

Branch `feat/dhis2-sink-sp7` is already created off `main` (`fbaa9b5`). All work on it; merge to **local `main`** at the end (NOT pushed). Full gate green per task; two-stage review between tasks.

**Gate (capture exit code; never pipe turbo through `tail`):**
```bash
pnpm turbo run typecheck lint test --filter=@openldr/marketplace --filter=@openldr/plugins --filter=@openldr/server --filter=@openldr/web
```
Final, before merge:
```bash
pnpm turbo run typecheck lint test build && pnpm depcruise
```
Known: re-run `pnpm -C apps/web test` in isolation if the turbo web-test parallel flake appears.

---

## Recon (verified — use these exact locations)

- Manifest schema: `packages/marketplace/src/artifact-manifest.ts` — `artifactManifestSchema` (z.object, line ~24-39, has `description: z.string().default('')`, NO readme); `LegacyPluginManifest` interface (~50-55); `pluginManifestToArtifact()` (~57-80).
- Inverse adapter `artifactToPluginManifest()`: `packages/plugins/src/runtime.ts`.
- Signing: `packages/marketplace/src/bundle.ts` `canonicalSigningBytes(manifest, payloadSha256)` signs `canonicalJSON(rest)` where `rest` = manifest minus `signature` → **readme auto-included, no signing change**.
- Registry sources: `packages/marketplace/src/registry-source.ts` — `RegistryListing` interface (~6-17), `LocalRegistrySource.getBundle()`/`list()` (~29-54), `HttpRegistrySource` (~56-116); `MarketplaceIndexEntry`: `packages/marketplace/src/index-json.ts` (~3-11).
- Detail API: `apps/server/src/marketplace-routes.ts` `GET /api/marketplace/available/:ref` (~85-104) maps `b.manifest.*` → response.
- Web client/types: `apps/web/src/api.ts` — `getAvailableArtifact` (~963), `AvailableArtifactDetail` (~933-937), `AvailableArtifact` (~?), `InstalledArtifact`.
- Detail page: `apps/web/src/pages/settings/marketplace/PackageDetail.tsx` (renders `detail.description` at line 127-129; two-column body at line 125; right sidebar sections Details/Permissions/Requirements).
- Markdown renderer: `apps/web/src/docs/DocMarkdown.tsx` (react-markdown@10 + remark-gfm; custom `img`/`a`/`h1-3`; NO raw HTML → safe; its `img` resolves via the bundled-screenshot registry so it is NOT directly reusable for plugin images).
- `cn()` = `twMerge(clsx(...))` (`apps/web/src/lib/cn.ts`) → later Tailwind utility wins (base `p-6` overridable by `p-0`).
- DialogContent base has NO padding: `apps/web/src/components/ui/dialog.tsx:28`. Self-managed `p-0` dialogs: `WidgetEditorDialog.tsx:330`, `DashboardFilterEditor.tsx:52`, `CompareDialog.tsx:54`. Unpadded (rely on default): `Connectors.tsx:177`, `Marketplace.tsx:131`, `Dhis2Mappings.tsx:94`.
- Build: `scripts/build-dhis2-sink.mjs` writes `reference-plugins/dhis2-sink/manifest.json`. Bundle/publish: `scripts/make-marketplace-bundle.ts` + `packages/marketplace/src/pack.ts` `packBundle`; publish route `apps/server/src/marketplace-routes.ts` (~145-214). Test marketplace repo: `../openldr-ce-marketplace` (env `MARKETPLACE_REGISTRY_DIR`).
- SP-6 screenshots (gitignored): `e2e/artifacts/screenshots/sp6-connectors-{list,test,dialog}.png`.

---

## File Structure

**Created:**
- `apps/web/src/pages/settings/marketplace/ReadmeMarkdown.tsx` — sanitized readme renderer.
- `apps/web/src/pages/settings/marketplace/ReadmeMarkdown.test.tsx`
- `wasm/dhis2-sink/docs/README.md` — the dhis2-sink setup/test guide (markdown, references `./img/*.png`).
- `wasm/dhis2-sink/docs/img/connectors-list.png`, `connectors-test.png`, `connectors-dialog.png` — copied from the SP-6 screenshots.

**Modified:**
- `packages/marketplace/src/artifact-manifest.ts` — `readme` in schema + `LegacyPluginManifest` + `pluginManifestToArtifact`.
- `packages/plugins/src/runtime.ts` — `artifactToPluginManifest` carries `readme`.
- `packages/marketplace/src/registry-source.ts` — `RegistryListing.readme` + local/http mapping.
- `packages/marketplace/src/index-json.ts` — `readme` in index entry.
- `apps/server/src/marketplace-routes.ts` — readme passthrough in available + available/:ref (+ installed if it has a detail).
- `apps/web/src/api.ts` — `readme?: string` on `AvailableArtifactDetail` (+ `AvailableArtifact` if listing carries it).
- `apps/web/src/pages/settings/marketplace/PackageDetail.tsx` — Docs section rendering `detail.readme`.
- `apps/web/src/i18n/{en,fr,pt}.ts` — `settings.marketplace.docs`, `noDocs`; DHIS2 connection-card relabel keys.
- `apps/web/src/components/ui/dialog.tsx` — base `p-6`.
- `apps/web/src/dashboard/editor/WidgetEditorDialog.tsx`, `apps/web/src/dashboard/filters/DashboardFilterEditor.tsx`, `apps/web/src/forms-builder/CompareDialog.tsx` — confirm/keep `p-0`.
- `apps/web/src/pages/Dhis2.tsx` — slim the Connection card.
- `scripts/build-dhis2-sink.mjs` — inline readme + images into manifest.
- `apps/web/src/docs/0.1.0/fr/{dhis2,ingestion}.md`, `apps/web/src/docs/0.1.0/pt/{dhis2,ingestion}.md` — parity backfill.
- `scripts/make-marketplace-bundle.ts` (or a dhis2-sink bundling path) — include readme for publish.

---

### Task 1: Marketplace `readme` field plumbing

**Files:** `packages/marketplace/src/artifact-manifest.ts`, `packages/plugins/src/runtime.ts`, `packages/marketplace/src/registry-source.ts`, `packages/marketplace/src/index-json.ts`, `apps/server/src/marketplace-routes.ts`, `apps/web/src/api.ts`. Tests: `packages/marketplace/src/artifact-manifest.test.ts`.

- [ ] **Step 1: Failing test — readme round-trips through the schema + adapter + signing**

In `packages/marketplace/src/artifact-manifest.test.ts` add:
```typescript
it('carries readme through pluginManifestToArtifact and parse', () => {
  const art = pluginManifestToArtifact({
    id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64),
    description: 'x', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 },
    readme: '# Hello\n\nsetup steps',
  } as never);
  expect(art.readme).toBe('# Hello\n\nsetup steps');
  expect(parseArtifactManifest({ ...art }).readme).toBe('# Hello\n\nsetup steps');
});
it('defaults readme to empty string when absent', () => {
  const art = pluginManifestToArtifact({ id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64), wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } } as never);
  expect(art.readme).toBe('');
});
```
Run: `pnpm -C packages/marketplace test artifact-manifest` → FAIL (readme undefined).

- [ ] **Step 2: Add `readme` to the schema + legacy interface + adapter**

In `artifact-manifest.ts`, add to `artifactManifestSchema` right after the `description` line:
```typescript
  readme: z.string().default(''),
```
Add to the `LegacyPluginManifest` interface:
```typescript
  readme?: string;
```
In `pluginManifestToArtifact()`, add to the object passed to `parseArtifactManifest` (after `description`):
```typescript
    readme: m.readme ?? '',
```

- [ ] **Step 3: Inverse adapter carries readme**

In `packages/plugins/src/runtime.ts` `artifactToPluginManifest()`, add `readme: a.readme` (or `readme: m.readme`) to the produced flat manifest so an installed artifact's readme survives the artifact→flat translation. (Read the function; mirror how `description` is carried; if it doesn't carry `description`, add `readme` alongside the fields it does carry and note it.)

- [ ] **Step 4: Registry listing + index entry**

`registry-source.ts`: add `readme?: string;` to `RegistryListing`; in `LocalRegistrySource.list()` mapping add `readme: b.manifest.readme`. `index-json.ts`: add `readme: z.string().default('')` to the index entry schema; in `HttpRegistrySource.list()` map `readme: e.readme`. (The HTTP `getBundle` path already returns the full manifest, so detail readme works for both sources.)

- [ ] **Step 5: API passthrough + web type**

`apps/server/src/marketplace-routes.ts`: in the `GET /api/marketplace/available/:ref` response object add `readme: b.manifest.readme,` (after `description`). (Listing endpoints need not carry readme — the detail fetch supplies it.)
`apps/web/src/api.ts`: add `readme?: string;` to `AvailableArtifactDetail`.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -C packages/marketplace test artifact-manifest` (PASS) then `pnpm turbo run typecheck --filter=@openldr/marketplace --filter=@openldr/plugins --filter=@openldr/server --filter=@openldr/web` (PASS).

- [ ] **Step 7: Commit**
```bash
git add packages/marketplace packages/plugins apps/server/src/marketplace-routes.ts apps/web/src/api.ts
git commit -m "feat(marketplace): signed readme field on artifacts, threaded to detail API (SP-7)"
```

---

### Task 2: Readme renderer + PackageDetail Docs section (TDD)

**Files:** Create `apps/web/src/pages/settings/marketplace/ReadmeMarkdown.tsx` + `.test.tsx`; modify `PackageDetail.tsx`; i18n en/fr/pt.

Security: the readme is **untrusted plugin content**. react-markdown@10 does not render raw HTML by default (safe). We still constrain the `img` and `a` components: images only `data:image/...` or `https:`; links only `https:`/`http:`, opened with `rel="noopener noreferrer"`. No `dangerouslySetInnerHTML`.

- [ ] **Step 1: Failing test**

`ReadmeMarkdown.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadmeMarkdown } from './ReadmeMarkdown';

describe('ReadmeMarkdown', () => {
  it('renders headings and paragraphs', () => {
    render(<ReadmeMarkdown content={'# Title\n\nsome **text**'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
  });
  it('renders a data:image and an https image, drops other schemes', () => {
    render(<ReadmeMarkdown content={'![ok](data:image/png;base64,iVBORw0KGgo=)\n\n![bad](javascript:alert(1))'} />);
    const imgs = screen.queryAllByRole('img');
    expect(imgs.some((i) => (i as HTMLImageElement).src.startsWith('data:image/'))).toBe(true);
    expect(imgs.some((i) => (i as HTMLImageElement).src.startsWith('javascript:'))).toBe(false);
  });
  it('opens links in a new tab safely', () => {
    render(<ReadmeMarkdown content={'[x](https://example.org)'} />);
    const a = screen.getByRole('link', { name: 'x' }) as HTMLAnchorElement;
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });
});
```
Run: `pnpm -C apps/web test ReadmeMarkdown` → FAIL (no module).

- [ ] **Step 2: Implement `ReadmeMarkdown.tsx`**
```typescript
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SAFE_IMG = /^(data:image\/(png|jpeg|gif|webp|svg\+xml);|https:\/\/)/i;
const SAFE_HREF = /^https?:\/\//i;

const components: Components = {
  img: ({ src, alt }) => (typeof src === 'string' && SAFE_IMG.test(src)
    ? <img src={src} alt={alt ?? ''} className="my-3 max-w-full rounded-md border border-border" />
    : null),
  a: ({ href, children }) => (typeof href === 'string' && SAFE_HREF.test(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{children}</a>
    : <span>{children}</span>),
};

/** Renders an UNTRUSTED plugin readme. react-markdown does not emit raw HTML; we further
 *  restrict images to data:image/https and links to http(s). */
export function ReadmeMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-sm text-foreground/90 [&_h1]:mt-0 [&_h1]:text-lg [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
    </div>
  );
}
```
Run: `pnpm -C apps/web test ReadmeMarkdown` → PASS. (If the `data:`/`javascript:` URL assertions need react-markdown's `urlTransform` disabled to let `data:` through, pass `urlTransform={(u) => u}` to `<ReactMarkdown>` and rely solely on the `img`/`a` component guards for safety — do NOT remove the regex guards.)

- [ ] **Step 3: i18n keys (en/fr/pt)**

Under `settings.marketplace` add in all three: en `docs: 'Docs'`, `noDocs: 'This plugin has no documentation.'`; fr `docs: 'Docs'`, `noDocs: "Cette extension n'a pas de documentation."`; pt `docs: 'Docs'`, `noDocs: 'Este plugin não tem documentação.'`

- [ ] **Step 4: Add the Docs section to `PackageDetail.tsx`**

Import `ReadmeMarkdown`. In the left column (`<div className="min-w-0 space-y-4">`, after the `description` `<p>` and before/after `PayloadPreview`), add:
```tsx
            {detail?.readme ? (
              <section data-testid="detail-docs">
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('settings.marketplace.docs')}</p>
                <ReadmeMarkdown content={detail.readme} />
              </section>
            ) : null}
```
(Plain section, not a new tab — the page has no Tabs today; keep it simple and consistent with the existing sections.)

- [ ] **Step 5: Component test for the Docs section** (extend `PackageDetail.test.tsx` if it exists, else add a focused render test)

Add a case: mock `getAvailableArtifact` to resolve `{ ...detail, readme: '# Setup\n\nstep one' }`, render `PackageDetail` for that entry, assert `screen.findByText('Setup')` appears. Reuse the file's existing mock shape. Run: `pnpm -C apps/web test PackageDetail` → PASS.

- [ ] **Step 6: typecheck + commit**
```bash
pnpm -C apps/web typecheck
git add apps/web/src/pages/settings/marketplace apps/web/src/i18n
git commit -m "feat(web): render plugin readme (sanitized) in Marketplace detail Docs section (SP-7)"
```

---

### Task 3: dhis2-sink README + build wiring

**Files:** Create `wasm/dhis2-sink/docs/README.md` + `wasm/dhis2-sink/docs/img/*.png`; modify `scripts/build-dhis2-sink.mjs`.

- [ ] **Step 1: Copy the SP-6 screenshots into the committed docs dir**
```bash
mkdir -p wasm/dhis2-sink/docs/img
cp e2e/artifacts/screenshots/sp6-connectors-list.png  wasm/dhis2-sink/docs/img/connectors-list.png
cp e2e/artifacts/screenshots/sp6-connectors-test.png  wasm/dhis2-sink/docs/img/connectors-test.png
cp e2e/artifacts/screenshots/sp6-connectors-dialog.png wasm/dhis2-sink/docs/img/connectors-dialog.png
```
(If the SP-6 screenshots are absent — gitignored, may not exist in a fresh checkout — STOP and report; the orchestrator will re-capture them. They exist in this working tree from SP-6.)

- [ ] **Step 2: Author `wasm/dhis2-sink/docs/README.md`**

A complete operator guide. It MUST reference images as `./img/<name>.png` (the build inlines them). Structure (write real prose, not placeholders):
```markdown
# DHIS2 Sink Plugin

Pushes OpenLDR aggregate (`dataValueSets`) and tracker (`events`) data to a DHIS2 instance.
DHIS2 protocol + HTTP egress run inside this WASM plugin; the OpenLDR host supplies the
rows, mapping, and (encrypted) connection — so credentials never live in the host config.

## Prerequisites
- A DHIS2 server reachable from OpenLDR (for a local trial: `pnpm dhis2:seed` then
  `docker compose --profile dhis2 up -d` → DHIS2 2.40.3 Sierra Leone demo at http://localhost:8085, login `admin`/`district`).
- `SECRETS_ENCRYPTION_KEY` set on the OpenLDR server (`openssl rand -base64 32`) — connector
  secrets are AES-256-GCM encrypted at rest.
- `REPORTING_TARGET_ADAPTER=dhis2` (enables the reporting-target wiring).

## 1. Create a connector  (Settings ▸ Connectors)
Click **Add connector**, pick the `dhis2-sink` plugin, enter the base URL + credentials, Save.
Secrets are write-only — re-enter all connection fields together to change any.

![Add connector dialog](./img/connectors-dialog.png)

## 2. Test the connection
Click **Test** on the connector row. A successful test does a live `health_check` +
`pull_metadata` and shows the counts.

![Connector with a successful live test](./img/connectors-test.png)

## 3. Map + push
Create a DHIS2 mapping (Settings ▸ DHIS2 ▸ Mappings) and pick this connector. Run a push
from the mapping, a schedule, or a Workflow `dhis2-push` node (which selects the mapping).
A dry-run returns the mapped `dataValues` without egress; a real push POSTs to
`/api/dataValueSets` and reports the DHIS2 import summary.

## Entry points (ABI)
`health_check`, `pull_metadata`, `push_aggregate`, `push_tracker` (JSON in/out).

## Verifying end to end (developers)
`pnpm dhis2:accept` runs the live acceptance against the Docker DHIS2 demo: connector
store round-trip → healthCheck → pullMetadata → dry-run → real push → reads the value
back via `GET /api/dataValueSets`.

## Capabilities
Declares `net-egress` intent; the host pins the concrete DHIS2 host (the connector's
base URL) at call time — least privilege, no ambient network access.
```
(Include the `connectors-list.png` image too if useful, e.g. under step 1.)

- [ ] **Step 3: Wire the readme into the built manifest**

In `scripts/build-dhis2-sink.mjs`, after computing `manifest` and before `writeFileSync`, read the README, inline images as data URIs, and set `manifest.readme`:
```javascript
import { readdirSync } from 'node:fs';
// ... after building `manifest`, before writeFileSync(manifest.json):
const docsDir = join(wasmDir, 'dhis2-sink', 'docs');
let readme = readFileSync(join(docsDir, 'README.md'), 'utf8');
// Inline ./img/<name>.png references as data: URIs so the readme is self-contained + signable.
readme = readme.replace(/\]\(\.\/img\/([\w.-]+)\)/g, (_m, file) => {
  const ext = file.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'application/octet-stream';
  const b64 = readFileSync(join(docsDir, 'img', file)).toString('base64');
  return `](data:${mime};base64,${b64})`;
});
manifest.readme = readme;
```
(Confirm `wasmDir` is `<root>/wasm` — the script uses `const wasmDir = join(root, 'wasm')`; so `docsDir = wasm/dhis2-sink/docs`. Adjust the join if the crate dir differs.)

- [ ] **Step 4: Build + verify the readme is present + self-contained**
```bash
pnpm build:dhis2-sink
node -e "const m=require('./reference-plugins/dhis2-sink/manifest.json'); if(!m.readme||!m.readme.includes('DHIS2 Sink Plugin')) throw new Error('readme missing'); if(!m.readme.includes('data:image/png;base64,')) throw new Error('image not inlined'); console.log('readme ok, length', m.readme.length)"
```
Expected: prints "readme ok, length …" (no `./img/` refs remain).

- [ ] **Step 5: Live verify in the installed-plugin path** (optional but recommended)

Re-install the plugin and confirm the detail API serves the readme:
```bash
set -a; . ./.env; set +a; pnpm openldr plugin install reference-plugins/dhis2-sink/plugin.wasm
```
(The installed Marketplace detail reads from the available/registry path; the readme is fully exercised once Task 7 publishes the bundle. If a quick check is wanted, assert the staged manifest readme as in Step 4.)

- [ ] **Step 6: Commit**
```bash
git add wasm/dhis2-sink/docs scripts/build-dhis2-sink.mjs
git commit -m "docs(dhis2-sink): ship setup/test guide as the plugin readme (inlined screenshots) (SP-7)"
```

---

### Task 4: Dialog padding fix

**Files:** `apps/web/src/components/ui/dialog.tsx`; `apps/web/src/dashboard/editor/WidgetEditorDialog.tsx`, `apps/web/src/dashboard/filters/DashboardFilterEditor.tsx`, `apps/web/src/forms-builder/CompareDialog.tsx` (verify their `p-0` stays).

`cn` uses tailwind-merge, so a base `p-6` is overridden by a later `p-0`. The three self-managed dialogs already pass `p-0` → unchanged. The unpadded dialogs (Connectors/Marketplace/Dhis2Mappings) gain padding.

- [ ] **Step 1: Add base padding**

In `dialog.tsx`, change the `DialogContent` base className to include `p-6`:
```typescript
        'fixed left-1/2 top-1/2 z-50 flex max-h-[95vh] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background p-6 shadow-lg focus:outline-none',
```

- [ ] **Step 2: Verify the self-managed dialogs still pass `p-0`**

Confirm `WidgetEditorDialog.tsx:330`, `DashboardFilterEditor.tsx:52`, `CompareDialog.tsx:54` still include `p-0` in their `DialogContent` className (they do). No change needed — `p-0` wins via twMerge. (If any relied on the old no-padding base WITHOUT setting p-0, add `p-0`.)

- [ ] **Step 3: Verify tests + visual sanity**

Run `pnpm -C apps/web test components/ui/dialog` (and the dialog/ui primitive tests) → PASS. Run `pnpm -C apps/web typecheck`. The Connectors/Marketplace dialogs now have 24px padding; the full-bleed editor dialogs are unchanged.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/components/ui/dialog.tsx
git commit -m "fix(web): default padding on DialogContent (p-6); self-managed dialogs keep p-0 (SP-7)"
```

---

### Task 5: Slim the stale DHIS2 Connection card

**Files:** `apps/web/src/pages/Dhis2.tsx` (Connection card ~39-63); `apps/web/src/i18n/{en,fr,pt}.ts`.

The card currently shows `configured`/`host`/`reachability` from the first-enabled connector, duplicating/contradicting the Connectors page. Replace its body with: the active-connector summary (host + reachability are still useful operationally) PLUS a clear pointer that the connection is managed under Settings ▸ Connectors, and reword the "not configured" copy to direct users to Connectors (not to set env vars).

- [ ] **Step 1: Read `Dhis2.tsx` + its i18n keys** (`dhis2.connection`, `dhis2.configured`, `dhis2.notConfigured`, `dhis2.notConfiguredHelp`, `dhis2.host`, `dhis2.reachability`). Identify the exact card JSX (lines ~39-63).

- [ ] **Step 2: Relabel + add the pointer**

Keep showing host/reachability when an active connector exists (operational signal), but:
- Change the card title key usage to a new `dhis2.activeConnector` ("Active connector") OR keep "Connection" but add a sub-line.
- Replace `dhis2.notConfiguredHelp` text with copy pointing to Settings ▸ Connectors (no env vars).
- Add a always-visible line/link: `t('dhis2.connectionManagedHint')` → "Connection is configured under Settings ▸ Connectors." with a `<NavLink to="/settings/connectors">`.

Add i18n keys to en/fr/pt:
- en: `activeConnector: 'Active connector'`, `connectionManagedHint: 'DHIS2 connection is configured under Settings ▸ Connectors.'`, and reword `notConfiguredHelp: 'No enabled DHIS2 connector. Add one under Settings ▸ Connectors.'`
- fr: `activeConnector: 'Connecteur actif'`, `connectionManagedHint: 'La connexion DHIS2 se configure dans Paramètres ▸ Connecteurs.'`, `notConfiguredHelp: 'Aucun connecteur DHIS2 activé. Ajoutez-en un dans Paramètres ▸ Connecteurs.'`
- pt: `activeConnector: 'Conector ativo'`, `connectionManagedHint: 'A conexão DHIS2 é configurada em Configurações ▸ Conectores.'`, `notConfiguredHelp: 'Nenhum conector DHIS2 ativado. Adicione um em Configurações ▸ Conectores.'`
(If `notConfiguredHelp` already exists, reword in place; keep the key name so other refs don't break.)

- [ ] **Step 3: Update/extend the Dhis2 page test** if one exists (assert the Connectors hint/link renders). Run `pnpm -C apps/web test Dhis2` (the status page test) + `typecheck`.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/Dhis2.tsx apps/web/src/i18n
git commit -m "fix(web): DHIS2 status Connection card points to Settings ▸ Connectors (SP-7)"
```

---

### Task 6: fr/pt doc parity

**Files:** `apps/web/src/docs/0.1.0/fr/dhis2.md`, `pt/dhis2.md`, `fr/ingestion.md`, `pt/ingestion.md`.

EN is the source of truth. fr/pt `dhis2.md` are missing the metadata-cache + troubleshooting sections; fr/pt `ingestion.md` are missing the pipeline-troubleshooting (`pnpm openldr pipeline logs`/`retry`) section.

- [ ] **Step 1: Diff EN vs fr/pt** for `dhis2.md` and `ingestion.md`; identify the EN sections missing from each translation (read all six files).

- [ ] **Step 2: Backfill `fr/dhis2.md` + `pt/dhis2.md`** — add the missing "metadata cache" section (`pnpm openldr dhis2 pull-metadata`, `pnpm openldr dhis2 status`) and the troubleshooting line, translated, matching the EN structure/headings.

- [ ] **Step 3: Backfill `fr/ingestion.md` + `pt/ingestion.md`** — add the missing pipeline-troubleshooting section (`pnpm openldr pipeline logs`/`retry`), translated.

- [ ] **Step 4: Verify** the four files now mirror EN section-for-section (no English left except commands/identifiers). `pnpm -C apps/web typecheck` (docs are markdown, not type-checked, but run the web build to ensure the glob still resolves: covered by the final gate).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/docs/0.1.0/fr apps/web/src/docs/0.1.0/pt
git commit -m "docs(i18n): backfill fr/pt dhis2 + ingestion docs to EN parity (SP-7)"
```

---

### Task 7: Publish dhis2-sink to the marketplace registry

**Files:** likely `scripts/make-marketplace-bundle.ts` (extend to build a dhis2-sink bundle) or a new small script; uses the existing `packBundle` + publish route. Live op.

Goal: a signed `dhis2-sink` bundle (manifest incl. `readme` + the wasm payload) lands in `../openldr-ce-marketplace/bundles` (and, if the in-app publish PR flow is used, a PR). Then it appears in the Marketplace **Browse** tab with its Docs.

- [ ] **Step 1: Understand the existing bundle/publish path** — read `scripts/make-marketplace-bundle.ts` (how it builds + signs the whonet bundle via `packBundle`, the publisher keypair source) and the publish route. Decide the minimal way to produce a dhis2-sink bundle: extend `make-marketplace-bundle.ts` to also pack `reference-plugins/dhis2-sink` (read its built `manifest.json` — which now has `readme` from Task 3 — + `plugin.wasm`), or add a sibling builder. The manifest must be a full artifact manifest (type:plugin, kind:sink payload, capabilities net-egress, readme).

- [ ] **Step 2: Produce + sign the bundle** into `MARKETPLACE_REGISTRY_DIR` (../openldr-ce-marketplace/bundles/dhis2-sink). Reuse the publisher keypair the whonet bundle uses. Verify locally: the bundle dir has `manifest.json` (with `readme` + `signature`), `plugin.wasm`, `publisher.pub`; and `pnpm openldr market verify <dir> --json` → `valid:true`.

- [ ] **Step 3: Surface in Browse** — refresh the registry in the app (or `listAvailableArtifacts`) and confirm `dhis2-sink` now appears in Browse. (Run the dev/built server with `MARKETPLACE_REGISTRY_DIR` set; `curl /api/marketplace/available` shows dhis2-sink; the detail endpoint returns its `readme`.)

- [ ] **Step 4: (Optional) PR publish** — if the user wants it in the remote GitHub registry, use the in-app publish flow / `make:marketplace-bundle` + commit-PR path to `fmwasekaga/openldr-ce-marketplace`. This is outward-facing — only do it if explicitly confirmed; otherwise leave the bundle in the LOCAL registry dir. Report which was done.

- [ ] **Step 5: Commit** any script changes (NOT the external marketplace repo, which is a separate repo):
```bash
git add scripts/make-marketplace-bundle.ts
git commit -m "feat(marketplace): pack + sign the dhis2-sink bundle for the registry (SP-7)"
```

---

### Task 8: Full gate + finish

- [ ] **Step 1: Full gate**
```bash
pnpm turbo run typecheck lint test build && pnpm depcruise
```
All green (re-run `pnpm -C apps/web test` isolated if the web turbo flake appears).

- [ ] **Step 2: Finish the branch** — `superpowers:finishing-a-development-branch`: merge `feat/dhis2-sink-sp7` to **local `main`** (ff/clean), do NOT push, remove the branch. Re-run the gate on main.

- [ ] **Step 3: Update memory** — `dhis2-sink-plugin-workstream`: add SP-7 (plugin readme/docs in marketplace detail; dhis2-sink shipped guide; dialog padding; DHIS2 card slimmed; fr/pt parity; dhis2-sink published to registry). Note the readme renderer is sanitized (untrusted plugin content).

---

## Self-Review

**Spec coverage:** plugin docs travel with the plugin + render in Marketplace detail (Tasks 1+2) ✅; dhis2-sink setup/test guide w/ screenshots as that readme (Task 3) ✅; dialog padding (Task 4) ✅; stale DHIS2 Connection card (Task 5) ✅; fr/pt parity (Task 6) ✅; publish dhis2-sink so it's in Browse (Task 7) ✅; marketplace 1-vs-2 explained to the user already + resolved by Task 7.

**Placeholder scan:** code blocks are complete for the non-trivial steps; Tasks 5/6/7 carry explicit read-first steps because they touch files whose exact current text must be matched (not placeholders — the change is specified). README prose is written in full.

**Type/security consistency:** `readme` is `string` (default '') everywhere it's added; the renderer treats it as UNTRUSTED (react-markdown no-raw-HTML + img/href scheme allowlists) — the one security-sensitive surface, flagged for the code-quality reviewer. `readme` added in Task 1 is consumed in Tasks 2/3/7. Signing needs no change (canonical bytes include readme).

**Note for executor:** Task 3 depends on Task 1 (schema) for `manifest.readme` to validate at pack time; Task 7 depends on Tasks 1+3. Tasks 4/5/6 are independent and can be done in any order.
