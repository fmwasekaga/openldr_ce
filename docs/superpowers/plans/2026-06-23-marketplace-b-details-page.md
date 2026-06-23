# Marketplace Details Page (Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two flat Available/Installed tables in the Settings ▸ Marketplace page with a corlix-style Browse/Installed tabbed card grid plus a full-view, kind-aware artifact detail page, against the existing local registry.

**Architecture:** A thin `Marketplace` container loads available + installed artifacts (as today) and renders `MarketplaceTabs`, which swaps between a card grid (`PackageCard`) and a full-view detail (`PackageDetail`). The server gains a `GET /api/marketplace/available/:ref` endpoint returning the full manifest for the detail view, and the existing `available` rows are enriched with `description`/`license`. No change to trust, signing, capability enforcement, or the install consent contract — this is presentation + two read endpoints.

**Tech Stack:** Fastify (server routes), React + react-i18next + shadcn/ui (Tabs, Badge, Button, DropdownMenu, Card, ConfirmDialog, Dialog), Vitest + @testing-library/react.

---

## File Structure

**Server**
- Modify: `apps/server/src/marketplace-routes.ts` — enrich `available`, add `available/:ref`.
- Modify: `apps/server/src/marketplace-routes.test.ts` — tests for the above.
- Modify: `packages/bootstrap/src/plugin-registry.ts` — export `CE_VERSION`.
- Modify: `packages/bootstrap/src/index.ts` — re-export `CE_VERSION`.

**Web — API + i18n**
- Modify: `apps/web/src/api.ts` — extend `AvailableArtifact`, add `AvailableArtifactDetail` + `getAvailableArtifact`.
- Modify: `apps/web/src/i18n/en.ts`, `fr.ts`, `pt.ts` — new `settings.marketplace.*` keys.

**Web — components (new dir `apps/web/src/pages/settings/marketplace/`)**
- Create: `util.ts` — `capabilityLine()`, `CardEntry` type, mappers.
- Create: `SignatureBadge.tsx` — Verified / New publisher / Invalid badge.
- Create: `PayloadPreview.tsx` — kind-dispatched payload metadata.
- Create: `RequirementsChecklist.tsx` — compatibility ✔/✗ rows.
- Create: `PackageCard.tsx` — one grid card.
- Create: `PackageDetail.tsx` — full-view detail.
- Create: `MarketplaceTabs.tsx` — Browse/Installed tabs + grid↔detail swap.
- Modify: `apps/web/src/pages/settings/Marketplace.tsx` — slim container.
- Modify: `apps/web/src/pages/settings/Marketplace.test.tsx` — updated for new structure.
- Create: `apps/web/src/pages/settings/marketplace/PackageCard.test.tsx`.
- Create: `apps/web/src/pages/settings/marketplace/PackageDetail.test.tsx`.

---

## Task 1: Server — export CE_VERSION

**Files:**
- Modify: `packages/bootstrap/src/plugin-registry.ts:10`
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Export the constant**

In `packages/bootstrap/src/plugin-registry.ts`, change line 10 from:

```ts
const CE_VERSION = '0.1.0'; // artifact compatibility gate; matches package.json
```

to:

```ts
export const CE_VERSION = '0.1.0'; // artifact compatibility gate; matches package.json
```

- [ ] **Step 2: Re-export from the package barrel**

In `packages/bootstrap/src/index.ts`, add this line near the other re-exports (find an existing `export ... from './plugin-registry'` line; if none exists, add a new line):

```ts
export { CE_VERSION } from './plugin-registry';
```

- [ ] **Step 3: Typecheck the package**

Run: `pnpm -C packages/bootstrap typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/plugin-registry.ts packages/bootstrap/src/index.ts
git commit -m "refactor(bootstrap): export CE_VERSION for marketplace compatibility checks"
```

---

## Task 2: Server — enrich `available` + add `available/:ref`

**Files:**
- Modify: `apps/server/src/marketplace-routes.ts`
- Test: `apps/server/src/marketplace-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `describe('marketplace routes', ...)` block in `apps/server/src/marketplace-routes.test.ts` (after the existing `'lists available bundles from the registry dir'` test):

```ts
  it('available rows include description and license', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    const body = res.json();
    expect(body.bundles[0]).toHaveProperty('description');
    expect(body.bundles[0]).toHaveProperty('license');
  });

  it('returns full manifest detail for one ref (with compatible flag)', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available/demo-1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ref: 'demo-1', id: 'demo', version: '1.0.0', valid: true, compatible: true });
    expect(body.payload).toMatchObject({ kind: 'plugin' });
    expect(body.capabilities).toEqual([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]);
  });

  it('rejects a traversal ref on the detail endpoint', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available/..%2Fsecrets' });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/server test -- marketplace-routes`
Expected: FAIL — the new `available/:ref` route 404s, and `available` rows lack `description`/`license`.

- [ ] **Step 3: Implement**

In `apps/server/src/marketplace-routes.ts`:

1. Add `CE_VERSION` to the bootstrap import and `isCompatible` to the marketplace import:

```ts
import type { AppContext } from '@openldr/bootstrap';
import { CE_VERSION } from '@openldr/bootstrap';
import { readBundle, verifyBundle, readGrant, isCompatible, type Capability } from '@openldr/marketplace';
```

(Keep the existing `import type { AppContext }` line; add the `CE_VERSION` value import as a second line as shown, and extend the existing `@openldr/marketplace` import to include `isCompatible`.)

2. In the `GET /api/marketplace/available` handler, extend the pushed object with `description` and `license`:

```ts
        bundles.push({
          ref,
          id: b.manifest.id,
          version: b.manifest.version,
          type: b.manifest.type,
          description: b.manifest.description,
          license: b.manifest.license,
          publisher: b.manifest.publisher ?? null,
          capabilities: b.manifest.capabilities,
          compatibility: b.manifest.compatibility,
          valid: v.valid,
        });
```

3. Add the new detail route immediately after the `available` route (before the `install` route):

```ts
  app.get('/api/marketplace/available/:ref', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!registryDir) {
      reply.code(400);
      return { error: 'no marketplace registry configured' };
    }
    const ref = safeRef((req.params as { ref: string }).ref);
    if (!ref) {
      reply.code(400);
      return { error: 'invalid bundle ref' };
    }
    try {
      const b = await readBundle(join(registryDir, ref));
      const v = verifyBundle(b);
      return {
        ref,
        id: b.manifest.id,
        version: b.manifest.version,
        type: b.manifest.type,
        description: b.manifest.description,
        license: b.manifest.license,
        publisher: b.manifest.publisher ?? null,
        capabilities: b.manifest.capabilities,
        compatibility: b.manifest.compatibility,
        compatible: isCompatible(b.manifest.compatibility.ceVersion, CE_VERSION),
        payload: b.manifest.payload,
        valid: v.valid,
      };
    } catch {
      reply.code(404);
      return { error: 'bundle not found' };
    }
  });
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm -C apps/server test -- marketplace-routes`
Expected: PASS (all marketplace-routes tests, including the new three).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/marketplace-routes.ts apps/server/src/marketplace-routes.test.ts
git commit -m "feat(server): enrich marketplace available rows + GET /available/:ref detail endpoint"
```

---

## Task 3: Web API client — detail types + fetcher

**Files:**
- Modify: `apps/web/src/api.ts:894-920`

- [ ] **Step 1: Extend `AvailableArtifact` and add the detail type + fetcher**

Replace the `AvailableArtifact` interface (lines 894-903) with:

```ts
export interface AvailableArtifact {
  ref: string;
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  capabilities: unknown[];
  compatibility: { ceVersion: string };
  valid: boolean;
  description?: string;
  license?: string;
}
export interface ArtifactPayloadMeta {
  kind: string;
  entrypoint?: string;
  wasmSha256?: string;
  wasi?: boolean;
  limits?: { memoryMb: number; timeoutMs: number };
  [k: string]: unknown;
}
export interface AvailableArtifactDetail extends AvailableArtifact {
  compatible: boolean;
  payload: ArtifactPayloadMeta;
}
```

Then add this fetcher right after the existing `listAvailableArtifacts` export (after line 920):

```ts
export const getAvailableArtifact = (ref: string): Promise<AvailableArtifactDetail> =>
  apiGet(`/api/marketplace/available/${encodeURIComponent(ref)}`, 'get available artifact');
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(web): marketplace artifact detail type + getAvailableArtifact"
```

---

## Task 4: Web i18n — new marketplace keys

**Files:**
- Modify: `apps/web/src/i18n/en.ts:259-288`
- Modify: `apps/web/src/i18n/fr.ts` (the `settings.marketplace` block)
- Modify: `apps/web/src/i18n/pt.ts` (the `settings.marketplace` block)

- [ ] **Step 1: Add keys to `en.ts`**

In `apps/web/src/i18n/en.ts`, inside the `marketplace: { ... }` object, add these keys before the closing `},` on line 288:

```ts
      browse: 'Browse',
      installedTab: 'Installed',
      searchPlaceholder: 'Search…',
      allTypes: 'All types',
      back: 'Back',
      details: 'Details',
      permissions: 'Permissions',
      requirements: 'Requirements',
      tags: 'Tags',
      category: 'Category',
      license: 'License',
      noDescription: 'No description provided.',
      noneCapabilities: 'No special permissions requested.',
      installComingSoon: 'Install (coming soon)',
      compatibleWith: 'Compatible with CE {{version}}',
      incompatibleWith: 'Requires CE {{range}} (have {{version}})',
      entrypoint: 'Entry point',
      checksum: 'Checksum (sha256)',
      sandbox: 'Sandbox',
      memoryLimit: 'Memory limit',
      timeLimit: 'Time limit',
      wasiOn: 'WASI enabled',
      wasiOff: 'WASI disabled',
      payloadUnavailable: 'Payload details unavailable.',
      emptyBrowse: 'No artifacts available.',
      emptyInstalled: 'Nothing installed yet.',
```

- [ ] **Step 2: Add the same keys (translated) to `fr.ts`**

In `apps/web/src/i18n/fr.ts`, inside the `settings.marketplace` object, add:

```ts
      browse: 'Parcourir',
      installedTab: 'Installés',
      searchPlaceholder: 'Rechercher…',
      allTypes: 'Tous les types',
      back: 'Retour',
      details: 'Détails',
      permissions: 'Permissions',
      requirements: 'Prérequis',
      tags: 'Étiquettes',
      category: 'Catégorie',
      license: 'Licence',
      noDescription: 'Aucune description fournie.',
      noneCapabilities: 'Aucune permission particulière demandée.',
      installComingSoon: 'Installer (bientôt)',
      compatibleWith: 'Compatible avec CE {{version}}',
      incompatibleWith: 'Nécessite CE {{range}} (version actuelle {{version}})',
      entrypoint: 'Point d’entrée',
      checksum: 'Empreinte (sha256)',
      sandbox: 'Bac à sable',
      memoryLimit: 'Limite mémoire',
      timeLimit: 'Limite de temps',
      wasiOn: 'WASI activé',
      wasiOff: 'WASI désactivé',
      payloadUnavailable: 'Détails du contenu indisponibles.',
      emptyBrowse: 'Aucun artefact disponible.',
      emptyInstalled: 'Rien d’installé pour le moment.',
```

- [ ] **Step 3: Add the same keys (translated) to `pt.ts`**

In `apps/web/src/i18n/pt.ts`, inside the `settings.marketplace` object, add:

```ts
      browse: 'Explorar',
      installedTab: 'Instalados',
      searchPlaceholder: 'Pesquisar…',
      allTypes: 'Todos os tipos',
      back: 'Voltar',
      details: 'Detalhes',
      permissions: 'Permissões',
      requirements: 'Requisitos',
      tags: 'Etiquetas',
      category: 'Categoria',
      license: 'Licença',
      noDescription: 'Nenhuma descrição fornecida.',
      noneCapabilities: 'Nenhuma permissão especial solicitada.',
      installComingSoon: 'Instalar (em breve)',
      compatibleWith: 'Compatível com CE {{version}}',
      incompatibleWith: 'Requer CE {{range}} (versão atual {{version}})',
      entrypoint: 'Ponto de entrada',
      checksum: 'Checksum (sha256)',
      sandbox: 'Sandbox',
      memoryLimit: 'Limite de memória',
      timeLimit: 'Limite de tempo',
      wasiOn: 'WASI ativado',
      wasiOff: 'WASI desativado',
      payloadUnavailable: 'Detalhes do conteúdo indisponíveis.',
      emptyBrowse: 'Nenhum artefacto disponível.',
      emptyInstalled: 'Nada instalado ainda.',
```

- [ ] **Step 4: Typecheck (verifies en/fr/pt key parity at compile time)**

Run: `pnpm -C apps/web typecheck`
Expected: PASS. (The `EnShape` type enforces that fr/pt have exactly the same keys as en — a missing key fails here.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): i18n keys for marketplace details page (en/fr/pt)"
```

---

## Task 5: Web — util + leaf components

**Files:**
- Create: `apps/web/src/pages/settings/marketplace/util.ts`
- Create: `apps/web/src/pages/settings/marketplace/SignatureBadge.tsx`
- Create: `apps/web/src/pages/settings/marketplace/RequirementsChecklist.tsx`
- Create: `apps/web/src/pages/settings/marketplace/PayloadPreview.tsx`

- [ ] **Step 1: Create `util.ts`**

```ts
import type { AvailableArtifact, InstalledArtifact } from '@/api';

/** A minimal, source-agnostic shape for a card + detail header. */
export interface CardEntry {
  ref?: string;          // present only for Browse (registry) items
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  capabilities: unknown[];
  valid?: boolean;       // Browse only (signature validity)
  installed?: boolean;   // is this id currently installed?
  active?: boolean;      // installed AND active version
}

/** Render one capability as a human-readable line for the Permissions list. */
export function capabilityLine(cap: unknown): string {
  if (typeof cap !== 'object' || cap === null) return String(cap);
  const c = cap as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof c.kind === 'string') parts.push(c.kind);
  if (Array.isArray(c.resourceTypes)) parts.push(`(${(c.resourceTypes as string[]).join(', ')})`);
  if (Array.isArray(c.allowedHosts)) parts.push(`(${(c.allowedHosts as string[]).join(', ') || 'none'})`);
  return parts.join(' ') || JSON.stringify(cap);
}

export function availableToEntry(b: AvailableArtifact, installedIds: Set<string>): CardEntry {
  return {
    ref: b.ref, id: b.id, version: b.version, type: b.type,
    publisher: b.publisher, capabilities: b.capabilities, valid: b.valid,
    installed: installedIds.has(b.id),
  };
}

export function installedToEntry(a: InstalledArtifact): CardEntry {
  const pub = a.publisher && typeof a.publisher === 'object'
    ? (a.publisher as { id?: string; name?: string })
    : null;
  return {
    id: a.id, version: a.version, type: a.type,
    publisher: pub ? { id: pub.id ?? '', name: pub.name ?? '' } : null,
    capabilities: a.capabilities, installed: true, active: a.active,
  };
}
```

- [ ] **Step 2: Create `SignatureBadge.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

export function SignatureBadge({ valid, publisher }: { valid?: boolean; publisher: { name: string } | null }) {
  const { t } = useTranslation();
  if (valid === false) {
    return <Badge variant="secondary" className="border-destructive/50 text-destructive">{t('settings.marketplace.invalid')}</Badge>;
  }
  if (publisher) {
    return <Badge variant="outline" className="border-emerald-500 text-emerald-700">{t('settings.marketplace.verified')}</Badge>;
  }
  return <Badge variant="outline">{t('settings.marketplace.firstUse')}</Badge>;
}
```

- [ ] **Step 3: Create `RequirementsChecklist.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';

export function RequirementsChecklist({ compatible, ceRange, ceVersion }: {
  compatible: boolean;
  ceRange: string;
  ceVersion: string;
}) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1 text-[13px]">
      <li className="flex items-center gap-2">
        {compatible
          ? <Check className="h-3.5 w-3.5 text-emerald-600" />
          : <X className="h-3.5 w-3.5 text-destructive" />}
        <span className={compatible ? '' : 'text-destructive'}>
          {compatible
            ? t('settings.marketplace.compatibleWith', { version: ceVersion })
            : t('settings.marketplace.incompatibleWith', { range: ceRange, version: ceVersion })}
        </span>
      </li>
    </ul>
  );
}
```

- [ ] **Step 4: Create `PayloadPreview.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import type { ArtifactPayloadMeta } from '@/api';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-[12px] text-foreground/90 break-all">{value}</dd>
    </div>
  );
}

export function PayloadPreview({ payload }: { payload: ArtifactPayloadMeta | null }) {
  const { t } = useTranslation();
  if (!payload) {
    return <p className="text-sm text-muted-foreground">{t('settings.marketplace.payloadUnavailable')}</p>;
  }
  if (payload.kind === 'plugin') {
    const sha = payload.wasmSha256 ? `${payload.wasmSha256.slice(0, 16)}…` : '—';
    return (
      <dl className="rounded-md border border-border p-3 text-[13px]">
        <Row label={t('settings.marketplace.entrypoint')} value={payload.entrypoint ?? 'convert'} />
        <Row label={t('settings.marketplace.checksum')} value={sha} />
        <Row label={t('settings.marketplace.sandbox')} value={payload.wasi ? t('settings.marketplace.wasiOn') : t('settings.marketplace.wasiOff')} />
        {payload.limits ? (
          <>
            <Row label={t('settings.marketplace.memoryLimit')} value={`${payload.limits.memoryMb} MB`} />
            <Row label={t('settings.marketplace.timeLimit')} value={`${payload.limits.timeoutMs} ms`} />
          </>
        ) : null}
      </dl>
    );
  }
  // Non-plugin kinds (form/report/test-definition) — fleshed out in sub-project C.
  return <p className="text-sm text-muted-foreground">{t('settings.marketplace.payloadUnavailable')}</p>;
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/settings/marketplace/util.ts apps/web/src/pages/settings/marketplace/SignatureBadge.tsx apps/web/src/pages/settings/marketplace/RequirementsChecklist.tsx apps/web/src/pages/settings/marketplace/PayloadPreview.tsx
git commit -m "feat(web): marketplace leaf components (util, SignatureBadge, RequirementsChecklist, PayloadPreview)"
```

---

## Task 6: Web — PackageCard

**Files:**
- Create: `apps/web/src/pages/settings/marketplace/PackageCard.tsx`
- Test: `apps/web/src/pages/settings/marketplace/PackageCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { PackageCard } from './PackageCard';
import type { CardEntry } from './util';

const base: CardEntry = {
  ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin',
  publisher: { id: 'p', name: 'OpenLDR Reference' }, capabilities: [], valid: true,
};

describe('PackageCard', () => {
  it('renders id, version and a type badge, and fires onClick', () => {
    const onClick = vi.fn();
    render(<PackageCard entry={base} onClick={onClick} />);
    expect(screen.getByText('whonet-sqlite')).toBeTruthy();
    expect(screen.getByText(/1\.1\.0/)).toBeTruthy();
    expect(screen.getByText('plugin')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows an Active badge for an installed+active artifact', () => {
    render(<PackageCard entry={{ ...base, ref: undefined, installed: true, active: true }} onClick={() => {}} />);
    expect(screen.getByText(/Active/i)).toBeTruthy();
  });

  it('shows an Install affordance for a non-installed registry item', () => {
    render(<PackageCard entry={base} onClick={() => {}} />);
    expect(screen.getByText(/Install/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/web test -- PackageCard`
Expected: FAIL — `Cannot find module './PackageCard'`.

- [ ] **Step 3: Implement `PackageCard.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { SignatureBadge } from './SignatureBadge';
import type { CardEntry } from './util';

export function PackageCard({ entry, onClick }: { entry: CardEntry; onClick: () => void }) {
  const { t } = useTranslation();
  const stateBadge = entry.installed
    ? (entry.active
        ? <Badge variant="outline" className="border-emerald-500 text-emerald-700">{t('settings.marketplace.active')}</Badge>
        : <Badge variant="outline">{t('settings.marketplace.installed')}</Badge>)
    : <Badge variant="outline" className="opacity-70">{t('settings.marketplace.install')}</Badge>;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`card-${entry.ref ?? entry.id}`}
      className="w-full rounded-md border border-border p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug text-foreground">{entry.id}</span>
        <Badge variant="outline" className="shrink-0 text-[10px] uppercase">{entry.type}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {(entry.publisher?.name || '—')} · v{entry.version}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {stateBadge}
        {entry.ref ? <SignatureBadge valid={entry.valid} publisher={entry.publisher} /> : null}
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C apps/web test -- PackageCard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/marketplace/PackageCard.tsx apps/web/src/pages/settings/marketplace/PackageCard.test.tsx
git commit -m "feat(web): marketplace PackageCard"
```

---

## Task 7: Web — PackageDetail

**Files:**
- Create: `apps/web/src/pages/settings/marketplace/PackageDetail.tsx`
- Test: `apps/web/src/pages/settings/marketplace/PackageDetail.test.tsx`

**Interface:** `PackageDetail` receives the card `entry`, callbacks for the lifecycle/install actions, and fetches its own full detail (`getAvailableArtifact`) when `entry.ref` is present. Capabilities come from the fetched detail when available, else from `entry.capabilities`.

```ts
interface PackageDetailProps {
  entry: CardEntry;
  onBack: () => void;
  onInstall: (entry: CardEntry, capabilities: unknown[]) => void;  // opens consent in the container
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRollback: (id: string, version: string) => void;
  onRemove: (entry: CardEntry) => void;
}
```

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getAvailableArtifact: vi.fn() };
});
import * as api from '@/api';
import { PackageDetail } from './PackageDetail';
import type { CardEntry } from './util';

const entry: CardEntry = {
  ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin',
  publisher: { id: 'p', name: 'OpenLDR Reference' },
  capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }], valid: true,
};

beforeEach(() => { vi.clearAllMocks(); });

function mockDetail(over: Partial<api.AvailableArtifactDetail> = {}) {
  (api.getAvailableArtifact as any).mockResolvedValue({
    ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin',
    description: 'Converts WHONET SQLite to FHIR.', license: 'Apache-2.0',
    publisher: { id: 'p', name: 'OpenLDR Reference' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    compatibility: { ceVersion: '*' }, compatible: true,
    payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } },
    valid: true, ...over,
  });
}

describe('PackageDetail', () => {
  it('fetches and renders description, permissions and requirements', async () => {
    mockDetail();
    render(<PackageDetail entry={entry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    expect(await screen.findByText(/Converts WHONET SQLite/)).toBeTruthy();
    expect(screen.getByText(/emit-fhir/)).toBeTruthy();
    expect(screen.getByText(/Compatible with CE/)).toBeTruthy();
  });

  it('Install calls onInstall with the fetched capabilities', async () => {
    mockDetail();
    const onInstall = vi.fn();
    render(<PackageDetail entry={entry} onBack={() => {}} onInstall={onInstall} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    fireEvent.click(await screen.findByTestId('detail-install'));
    await waitFor(() => expect(onInstall).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'whonet-narrow' }),
      [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    ));
  });

  it('Back calls onBack', async () => {
    mockDetail();
    const onBack = vi.fn();
    render(<PackageDetail entry={entry} onBack={onBack} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    fireEvent.click(await screen.findByTestId('detail-back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('installed item shows the actions menu instead of Install', async () => {
    const installedEntry: CardEntry = { ...entry, ref: undefined, installed: true, active: true };
    render(<PackageDetail entry={installedEntry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    // No ref → no fetch → no Install button; capabilities come from the entry.
    expect(screen.queryByTestId('detail-install')).toBeNull();
    expect(await screen.findByText(/emit-fhir/)).toBeTruthy();
    expect(screen.getByTestId('detail-menu')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/web test -- PackageDetail`
Expected: FAIL — `Cannot find module './PackageDetail'`.

- [ ] **Step 3: Implement `PackageDetail.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { getAvailableArtifact, type AvailableArtifactDetail } from '@/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { SignatureBadge } from './SignatureBadge';
import { PayloadPreview } from './PayloadPreview';
import { RequirementsChecklist } from './RequirementsChecklist';
import { capabilityLine, type CardEntry } from './util';

interface PackageDetailProps {
  entry: CardEntry;
  onBack: () => void;
  onInstall: (entry: CardEntry, capabilities: unknown[]) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRollback: (id: string, version: string) => void;
  onRemove: (entry: CardEntry) => void;
}

export function PackageDetail({ entry, onBack, onInstall, onToggleEnabled, onRollback, onRemove }: PackageDetailProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<AvailableArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    if (!entry.ref) return;
    void getAvailableArtifact(entry.ref)
      .then((d) => { if (active) setDetail(d); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [entry.ref]);

  const capabilities = (detail?.capabilities ?? entry.capabilities) as unknown[];
  const publisher = detail?.publisher ?? entry.publisher;
  const canInstall = Boolean(entry.ref) && !entry.installed && entry.type === 'plugin' && (detail ? detail.valid : entry.valid !== false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-1 py-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" data-testid="detail-back" onClick={onBack}>
          ← {t('settings.marketplace.back')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-medium text-foreground">{entry.id}</h1>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
              <span>{(publisher?.name || '—')} · v{entry.version}</span>
              <Badge variant="outline" className="text-[10px] uppercase">{entry.type}</Badge>
              {entry.ref ? <SignatureBadge valid={detail ? detail.valid : entry.valid} publisher={publisher} /> : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canInstall ? (
              <Button data-testid="detail-install" onClick={() => onInstall(entry, capabilities)}>
                {t('settings.marketplace.install')}
              </Button>
            ) : entry.ref && entry.type !== 'plugin' && !entry.installed ? (
              <Button disabled title={t('settings.marketplace.installPluginOnly')}>
                {t('settings.marketplace.installComingSoon')}
              </Button>
            ) : null}
            {entry.installed ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="detail-menu" aria-label={t('settings.marketplace.details')}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onToggleEnabled(entry.id, !entry.active ? true : false)}>
                    {entry.active ? t('settings.marketplace.disable') : t('settings.marketplace.enable')}
                  </DropdownMenuItem>
                  {!entry.active ? (
                    <DropdownMenuItem onSelect={() => onRollback(entry.id, entry.version)}>
                      {t('settings.marketplace.rollback')}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem className="text-destructive" onSelect={() => onRemove(entry)}>
                    {t('settings.marketplace.remove')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        {/* Two-column body */}
        <div className="mt-4 grid gap-6" style={{ gridTemplateColumns: 'minmax(0,1fr) 244px' }}>
          <div className="min-w-0 space-y-4">
            <p className="whitespace-pre-line text-sm text-foreground/85">
              {detail?.description || t('settings.marketplace.noDescription')}
            </p>
            <PayloadPreview payload={detail?.payload ?? null} />
            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            ) : null}
          </div>

          <div className="space-y-4">
            <section className="rounded-md bg-muted/40 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('settings.marketplace.details')}</p>
              <dl className="space-y-1 text-[13px]">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t('settings.marketplace.publisher')}</dt><dd className="text-right text-foreground/90">{publisher?.name || '—'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t('settings.marketplace.version')}</dt><dd className="text-right text-foreground/90">{entry.version}</dd></div>
                {detail?.license ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t('settings.marketplace.license')}</dt><dd className="text-right text-foreground/90">{detail.license}</dd></div> : null}
              </dl>
            </section>

            <section>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('settings.marketplace.permissions')}</p>
              {capabilities.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{t('settings.marketplace.noneCapabilities')}</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-foreground/85">
                  {capabilities.map((cap, i) => <li key={i}>{capabilityLine(cap)}</li>)}
                </ul>
              )}
            </section>

            {detail ? (
              <section>
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t('settings.marketplace.requirements')}</p>
                <RequirementsChecklist compatible={detail.compatible} ceRange={detail.compatibility.ceVersion} ceVersion="0.1.0" />
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C apps/web test -- PackageDetail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/marketplace/PackageDetail.tsx apps/web/src/pages/settings/marketplace/PackageDetail.test.tsx
git commit -m "feat(web): marketplace PackageDetail full-view"
```

---

## Task 8: Web — MarketplaceTabs + slim container + updated tests

**Files:**
- Create: `apps/web/src/pages/settings/marketplace/MarketplaceTabs.tsx`
- Modify: `apps/web/src/pages/settings/Marketplace.tsx`
- Modify: `apps/web/src/pages/settings/Marketplace.test.tsx`

- [ ] **Step 1: Create `MarketplaceTabs.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AvailableArtifact, InstalledArtifact } from '@/api';
import { PackageCard } from './PackageCard';
import { PackageDetail } from './PackageDetail';
import { availableToEntry, installedToEntry, type CardEntry } from './util';

interface MarketplaceTabsProps {
  configured: boolean;
  available: AvailableArtifact[];
  installed: InstalledArtifact[];
  onInstall: (entry: CardEntry, capabilities: unknown[]) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRollback: (id: string, version: string) => void;
  onRemove: (entry: CardEntry) => void;
}

export function MarketplaceTabs(props: MarketplaceTabsProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState<CardEntry | null>(null);

  const installedIds = useMemo(() => new Set(props.installed.map((a) => a.id)), [props.installed]);

  const browseEntries = useMemo(() => props.available
    .filter((b) => {
      const textMatch = !filter || b.id.toLowerCase().includes(filter.toLowerCase()) || b.ref.toLowerCase().includes(filter.toLowerCase());
      const typeMatch = typeFilter === 'all' || b.type === typeFilter;
      return textMatch && typeMatch;
    })
    .map((b) => availableToEntry(b, installedIds)), [props.available, filter, typeFilter, installedIds]);

  const installedEntries = useMemo(() => props.installed.map(installedToEntry), [props.installed]);

  if (selected) {
    return (
      <PackageDetail
        entry={selected}
        onBack={() => setSelected(null)}
        onInstall={props.onInstall}
        onToggleEnabled={props.onToggleEnabled}
        onRollback={props.onRollback}
        onRemove={props.onRemove}
      />
    );
  }

  return (
    <Tabs defaultValue="browse" className="flex min-h-0 flex-1 flex-col">
      <TabsList>
        <TabsTrigger value="browse">{t('settings.marketplace.browse')}</TabsTrigger>
        <TabsTrigger value="installed">{t('settings.marketplace.installedTab')} ({props.installed.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="browse" className="min-h-0 flex-1">
        <div className="mb-3 flex items-center gap-2">
          <Input className="max-w-xs" placeholder={t('settings.marketplace.searchPlaceholder')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('settings.marketplace.allTypes')}</SelectItem>
              <SelectItem value="plugin">Plugin</SelectItem>
              <SelectItem value="form-template">Form template</SelectItem>
              <SelectItem value="report-template">Report</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!props.configured ? (
          <div className="px-1 py-6 text-sm text-muted-foreground">{t('settings.marketplace.notConfigured')}</div>
        ) : browseEntries.length === 0 ? (
          <div className="px-1 py-6 text-center text-sm text-muted-foreground">{t('settings.marketplace.emptyBrowse')}</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {browseEntries.map((e) => <PackageCard key={e.ref ?? e.id} entry={e} onClick={() => setSelected(e)} />)}
          </div>
        )}
      </TabsContent>

      <TabsContent value="installed" className="min-h-0 flex-1">
        {installedEntries.length === 0 ? (
          <div className="px-1 py-6 text-center text-sm text-muted-foreground">{t('settings.marketplace.emptyInstalled')}</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {installedEntries.map((e) => <PackageCard key={e.id} entry={e} onClick={() => setSelected(e)} />)}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 2: Rewrite `Marketplace.tsx` as a slim container**

Replace the entire contents of `apps/web/src/pages/settings/Marketplace.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  listAvailableArtifacts, listInstalledArtifacts,
  installArtifact, setArtifactEnabled, rollbackArtifact, removeArtifact,
  type AvailableArtifact, type InstalledArtifact,
} from '@/api';
import { MarketplaceTabs } from './marketplace/MarketplaceTabs';
import { capabilityLine, type CardEntry } from './marketplace/util';

export function Marketplace() {
  const { t } = useTranslation();
  const [configured, setConfigured] = useState(true);
  const [available, setAvailable] = useState<AvailableArtifact[]>([]);
  const [installed, setInstalled] = useState<InstalledArtifact[]>([]);
  const [consent, setConsent] = useState<{ entry: CardEntry; capabilities: unknown[] } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<CardEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [avail, inst] = await Promise.all([listAvailableArtifacts(), listInstalledArtifacts()]);
      setConfigured(avail.configured);
      setAvailable(avail.bundles);
      setInstalled(inst);
    } catch (e) {
      toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const doInstall = useCallback(async () => {
    if (!consent || !consent.entry.ref || busy) return;
    setBusy(true);
    try {
      await installArtifact(consent.entry.ref, consent.capabilities);
      toast.success(t('settings.marketplace.installedToast', { id: consent.entry.id }));
      setConsent(null);
      await load();
    } catch (e) {
      toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [consent, busy, t, load]);

  const onToggleEnabled = useCallback(async (id: string, enabled: boolean) => {
    try { await setArtifactEnabled(id, enabled); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onRollback = useCallback(async (id: string, version: string) => {
    try { await rollbackArtifact(id, version); toast.success(t('settings.marketplace.installedToast', { id })); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const doRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const entry = pendingRemove;
    setPendingRemove(null);
    try { await removeArtifact(entry.id); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingRemove, t, load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4" data-testid="marketplace-page">
      <h1 className="text-lg font-semibold">{t('settings.marketplace.heading')}</h1>

      <MarketplaceTabs
        configured={configured}
        available={available}
        installed={installed}
        onInstall={(entry, capabilities) => setConsent({ entry, capabilities })}
        onToggleEnabled={onToggleEnabled}
        onRollback={onRollback}
        onRemove={(entry) => setPendingRemove(entry)}
      />

      {/* Consent dialog */}
      <Dialog open={consent !== null} onOpenChange={(o) => { if (!o) setConsent(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('settings.marketplace.consentTitle', { id: consent?.entry.id ?? '' })}</DialogTitle>
          {consent ? (
            <div className="grid gap-3 text-sm">
              <div><span className="font-medium">{t('settings.marketplace.version')}:</span> {consent.entry.version}</div>
              <div>
                <div className="mb-1 font-medium">{t('settings.marketplace.requestedCapabilities')}</div>
                {consent.capabilities.length === 0 ? (
                  <div className="text-muted-foreground">{t('settings.marketplace.noneCapabilities')}</div>
                ) : (
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {consent.capabilities.map((cap, i) => <li key={i}>{capabilityLine(cap)}</li>)}
                  </ul>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setConsent(null)}>{t('settings.marketplace.cancel')}</Button>
                <Button data-testid="approve-install" disabled={busy} onClick={() => void doInstall()}>
                  {t('settings.marketplace.approveInstall')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={t('settings.marketplace.removeTitle', { id: pendingRemove?.id ?? '' })}
        description={t('settings.marketplace.removeDescription')}
        confirmLabel={t('settings.marketplace.remove')}
        destructive
        onConfirm={() => { void doRemove(); }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Update `Marketplace.test.tsx` for the new structure**

Replace the entire contents of `apps/web/src/pages/settings/Marketplace.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasRole: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    listInstalledArtifacts: vi.fn(), listAvailableArtifacts: vi.fn(), getAvailableArtifact: vi.fn(),
    installArtifact: vi.fn(), setArtifactEnabled: vi.fn(), rollbackArtifact: vi.fn(), removeArtifact: vi.fn() };
});
import * as api from '@/api';
import { Marketplace } from './Marketplace';

beforeEach(() => { vi.clearAllMocks(); });

const oneBundle = {
  configured: true,
  bundles: [{ ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }], compatibility: { ceVersion: '*' }, valid: true }],
};

function mockDetail() {
  (api.getAvailableArtifact as any).mockResolvedValue({
    ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin',
    description: 'desc', license: 'Apache-2.0', publisher: { id: 'p', name: 'P' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    compatibility: { ceVersion: '*' }, compatible: true,
    payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } },
    valid: true,
  });
}

it('browses a bundle, opens detail, installs after consent', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  (api.installArtifact as any).mockResolvedValue({ id: 'whonet-sqlite', version: '1.0.0' });
  mockDetail();
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId('card-whonet-narrow'));
  fireEvent.click(await screen.findByTestId('detail-install'));
  expect(await screen.findByText(/Patient/)).toBeTruthy(); // consent dialog
  fireEvent.click(screen.getByTestId('approve-install'));
  await waitFor(() => expect(api.installArtifact).toHaveBeenCalledWith('whonet-narrow', [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]));
});

it('shows the unconfigured empty state', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: false, bundles: [] });
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  expect(await screen.findByText(/No marketplace registry configured/i)).toBeTruthy();
});

it('installed tab lists installed artifacts and toggles enabled from detail', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, bundles: [] });
  (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'whonet-sqlite', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false }]);
  (api.setArtifactEnabled as any).mockResolvedValue(undefined);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  fireEvent.click(screen.getByText(/Installed \(1\)/));
  fireEvent.click(await screen.findByTestId('card-whonet-sqlite'));
  fireEvent.click(await screen.findByTestId('detail-menu'));
  fireEvent.click(await screen.findByText('Disable'));
  await waitFor(() => expect(api.setArtifactEnabled).toHaveBeenCalledWith('whonet-sqlite', false));
});
```

- [ ] **Step 4: Run the web marketplace suite**

Run: `pnpm -C apps/web test -- marketplace Marketplace PackageCard PackageDetail`
Expected: PASS (all marketplace component + container tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/marketplace/MarketplaceTabs.tsx apps/web/src/pages/settings/Marketplace.tsx apps/web/src/pages/settings/Marketplace.test.tsx
git commit -m "feat(web): marketplace Browse/Installed tabs + slim container wiring detail page"
```

---

## Task 9: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo typecheck lint test build --filter=@openldr/web --filter=@openldr/server --filter=@openldr/bootstrap`
Expected: all green. If `@openldr/web#test` flakes in parallel (known per project memory), re-run `pnpm -C apps/web test` in isolation — it should pass.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Start the dev server, log in as a `lab_admin`, open Settings ▸ Marketplace. Verify: Browse tab shows whonet cards; clicking a card opens the full-view detail with description, Permissions (emit-fhir / net-egress), Requirements (✔ Compatible with CE 0.1.0), and payload preview; Install opens the consent dialog and installs; the Installed tab lists it and the ⋯ menu disables/removes.

- [ ] **Step 3: Final commit (if any lint autofixes applied)**

```bash
git add -A
git commit -m "chore(marketplace): verification gate green for details page"
```

---

## Self-Review Notes

- **Spec coverage:** Browse/Installed tabs (Task 8) ✓; full-view kind-aware detail (Task 7) ✓; PackageCard/PayloadPreview/RequirementsChecklist/Permissions (Tasks 5-7) ✓; consent dialog retained (Task 8 container) ✓; API enrich + `:ref` endpoint (Task 2) ✓; client type + fetcher (Task 3) ✓; i18n en/fr/pt (Task 4) ✓; tests (Tasks 2,6,7,8) ✓; CE version source for compatibility (Task 1) ✓.
- **Out-of-scope guardrails honored:** non-plugin kinds render but show disabled "Install (coming soon)" and a placeholder payload preview; no remote fetch / publish / drift.
- **Type consistency:** `CardEntry` (util) is the single header view-model used by `PackageCard`, `PackageDetail`, `MarketplaceTabs`; `AvailableArtifactDetail`/`ArtifactPayloadMeta` (api.ts) are used by `getAvailableArtifact`, `PackageDetail`, `PayloadPreview`; `compatible` flows server (Task 2) → api type (Task 3) → `RequirementsChecklist` (Tasks 6/7).
- **Note:** `RequirementsChecklist` is passed `ceVersion="0.1.0"` as a display string in `PackageDetail`; the authoritative compatibility decision is computed server-side (`compatible`), so the displayed version is cosmetic only.
