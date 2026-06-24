# DHIS2 Sink Plugin — SP-5b: Connectors Web UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the web UI on top of the existing SP-5a connector API — a Settings ▸ Connectors page (list + create/edit dialog + live "Test connection"), a typed api.ts client, a connector picker on the DHIS2 mapping editor, a Test button on the workflow `dhis2-push` node — and fix the bundled operator docs that still reference the removed `DHIS2_*` env vars.

**Architecture:** Additive web-only work. The SP-5a API (`/api/connectors` CRUD + `/:id/test` + `/sink-plugins`, all `lab_admin`-gated, secrets write-only/masked) already exists and is unchanged. We add a typed client in `apps/web/src/api.ts`, a `Connectors` settings page modelled on `Marketplace.tsx`, wire it into `SettingsShell` SUB_NAV + `App.tsx`, add `connectorId` to the mapping editor (it persists into the mapping `definition` JSON, which the host `dhis2-context.connectorIdOf` already reads), and add a Test button to the `dhis2-push` node form. The push **node** does **not** need its own connector field — the connector is resolved from the mapping it selects (confirmed in `packages/bootstrap/src/dhis2-context.ts:92` `connectorIdOf` reads `mapping.connectorId`).

**Tech Stack:** React 18 + TypeScript, react-router-dom, react-i18next (en/fr/pt with compile-time `EnShape` key parity — every new key MUST land in all three bundles or the build fails), shadcn/ui primitives (`Dialog`, `Select`, `Input`, `Button`, `Table`, `Switch`, `ConfirmDialog`), Vitest + Testing Library + jsdom, sonner toasts.

---

## Pre-flight (orchestrator, before Task 1)

Create the isolated worktree/branch per the established SP-1..SP-5a discipline (use `superpowers:using-git-worktrees`):

- Branch: `feat/dhis2-sink-sp5b`
- All work happens on that branch; merge to **local `main`** at the end (NOT pushed — origin is ~30 commits behind by design).
- Full gate green per task; review between tasks.

**Gate command (run from repo root, capture exit code — NEVER pipe turbo through `tail`, it masks the exit code):**
```bash
pnpm turbo run typecheck lint test --filter=@openldr/web
```
Plus, when web tests look flaky under turbo concurrency, re-run web in isolation (the known `@openldr/web#test` parallel flake — trust the isolated run, not a turbo red):
```bash
pnpm -C apps/web test
```
Final full gate before merge:
```bash
pnpm turbo run typecheck lint test build && pnpm depcruise
```

---

## File Structure

**Created:**
- `apps/web/src/pages/settings/Connectors.tsx` — the Settings ▸ Connectors page (list + create/edit dialog + Test).
- `apps/web/src/pages/settings/Connectors.test.tsx` — component test for the page.

**Modified:**
- `apps/web/src/api.ts` — add `Connector`/`SinkPluginRef`/`ConnectorTestResult` types + 7 client fns; add `connectorId?` to `AggregateMappingDef` + `TrackerMappingDef`.
- `apps/web/src/i18n/en.ts`, `fr.ts`, `pt.ts` — add `settings.subNav.connectors`, a `settings.connectors.*` block, and `dhis2.mappings.editor.connector*` keys (all three, parity-required).
- `apps/web/src/pages/settings/SettingsShell.tsx` — add the SUB_NAV entry.
- `apps/web/src/pages/settings/SettingsShell.test.tsx` — assert the Connectors link renders.
- `apps/web/src/App.tsx` — add the `/settings/connectors` route.
- `apps/web/src/pages/Dhis2MappingEditor.tsx` — add a connector picker that sets `definition.connectorId`.
- `apps/web/src/pages/Dhis2MappingEditor.test.tsx` — cover the connector picker round-trip.
- `apps/web/src/workflows/components/node-forms/dhis2-push-form.tsx` — mapping picker + Test button.
- `apps/web/src/workflows/components/node-forms/dhis2-push-form.test.tsx` — new test for the node form.
- `apps/web/src/docs/0.1.0/en/dhis2.md`, `fr/dhis2.md`, `pt/dhis2.md` — connector-based connection flow.
- `docs/CONFIGURATION.md`, `docs/OPERATOR-GUIDE.md` — connector-based connection flow.

---

## Reference: the SP-5a API contract (already built, do not change)

`apps/server/src/connectors-routes.ts`, all `lab_admin`-gated:

- `GET  /api/connectors` → `ConnectorRecord[]` (masked — NO `config`/secrets).
- `GET  /api/connectors/:id` → `ConnectorRecord` | 404 `{ error }`.
- `POST /api/connectors` body `{ name, pluginId, config: Record<string,string>, allowedHost? }` → created `ConnectorRecord` | 400 `{ error }`.
- `PUT  /api/connectors/:id` body `{ name?, config?, allowedHost?, enabled? }` → updated `ConnectorRecord` | 400/404.
- `DELETE /api/connectors/:id` → `{ ok: true }`.
- `POST /api/connectors/:id/test` → `{ ok: true, metadata: { dataElements, orgUnits, categoryOptionCombos, programs, programStages } }` (all numbers) | `{ ok: false, error: string }` | 404.
- `GET  /api/connectors/sink-plugins` → `{ id: string, version: string, enabled: boolean }[]`.

`ConnectorRecord` (from `@openldr/db`, masked): `{ id, name, pluginId, kind, allowedHost: string|null, enabled, createdAt, updatedAt }` (dates serialize to ISO strings over HTTP).

Secrets are **write-only**: the server never returns `config`. The UI shows `••• set` for existing connectors and only sends `config` on create or when the operator re-enters it.

---

### Task 1: API client — types, connector fns, and mapping `connectorId`

**Files:**
- Modify: `apps/web/src/api.ts` (append a Connectors section near the other client fns, e.g. after the DHIS2 mappings block ~line 849; add `connectorId?` to the two mapping defs at lines 786-807)

This task is pure plumbing/types (thin `authFetch` wrappers — the repo has **no** direct `api.ts` unit tests; every consumer mocks `@/api`). Verification is `typecheck` + `build`, consistent with the existing terminology/marketplace client fns. The page/editor/node tests in later tasks exercise these fns via mocks.

- [ ] **Step 1: Add `connectorId?` to both mapping defs**

In `apps/web/src/api.ts`, add the field to `AggregateMappingDef` (after `kind?: 'aggregate';`) and `TrackerMappingDef` (after `kind: 'tracker';`):

```typescript
// in AggregateMappingDef:
  kind?: 'aggregate';
  /** Connector that receives this mapping's push (resolved host-side from the definition). */
  connectorId?: string;
```
```typescript
// in TrackerMappingDef:
  kind: 'tracker';
  /** Connector that receives this mapping's push (resolved host-side from the definition). */
  connectorId?: string;
```

- [ ] **Step 2: Add the Connectors client section**

Append to `apps/web/src/api.ts` (uses the existing `authFetch`, `jbody`, `okJson`, `apiGet` helpers already defined in the file):

```typescript
// ── Connectors (SP-5b) ─────────────────────────────────────────────────────────
export interface Connector {
  id: string;
  name: string;
  pluginId: string;
  kind: string;
  allowedHost: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SinkPluginRef { id: string; version: string; enabled: boolean }
export interface ConnectorMetadataCounts {
  dataElements: number; orgUnits: number; categoryOptionCombos: number; programs: number; programStages: number;
}
export type ConnectorTestResult =
  | { ok: true; metadata: ConnectorMetadataCounts }
  | { ok: false; error: string };
export interface ConnectorCreateInput {
  name: string; pluginId: string; config: Record<string, string>; allowedHost?: string;
}
export interface ConnectorUpdateInput {
  name?: string; config?: Record<string, string>; allowedHost?: string | null; enabled?: boolean;
}

export const listConnectors = (): Promise<Connector[]> =>
  apiGet<Connector[]>('/api/connectors', 'list connectors');
export const listSinkPlugins = (): Promise<SinkPluginRef[]> =>
  apiGet<SinkPluginRef[]>('/api/connectors/sink-plugins', 'list sink plugins');
export const createConnector = (input: ConnectorCreateInput): Promise<Connector> =>
  authFetch('/api/connectors', jbody(input, 'POST')).then((r) => okJson<Connector>(r, 'create connector'));
export const updateConnector = (id: string, input: ConnectorUpdateInput): Promise<Connector> =>
  authFetch(`/api/connectors/${encodeURIComponent(id)}`, jbody(input, 'PUT')).then((r) => okJson<Connector>(r, 'update connector'));
export async function deleteConnector(id: string): Promise<void> {
  const r = await authFetch(`/api/connectors/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete connector failed: ${r.status}`);
}
export const testConnector = (id: string): Promise<ConnectorTestResult> =>
  authFetch(`/api/connectors/${encodeURIComponent(id)}/test`, jbody({}, 'POST')).then((r) => okJson<ConnectorTestResult>(r, 'test connector'));
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -C apps/web typecheck` (or `pnpm turbo run typecheck --filter=@openldr/web`)
Expected: PASS (no type errors; the new exports compile).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(web): connector api client + mapping connectorId field (SP-5b)"
```

---

### Task 2: i18n keys (en/fr/pt — parity required)

**Files:**
- Modify: `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/fr.ts`, `apps/web/src/i18n/pt.ts`

`en.ts` is the canonical `EnShape`; `fr.ts`/`pt.ts` must contain the **same keys** or the build fails. Add all keys to all three in this one task.

- [ ] **Step 1: Add the SUB_NAV key**

In `en.ts` under `settings.subNav` (after `dhis2: 'DHIS2',`), add:
```typescript
      connectors: 'Connectors',
```
In `fr.ts` same place: `connectors: 'Connecteurs',`
In `pt.ts` same place: `connectors: 'Conectores',`

- [ ] **Step 2: Add the `settings.connectors` block**

In `en.ts`, inside `settings` (a sibling of `marketplace`), add:
```typescript
    connectors: {
      heading: 'Connectors',
      description: 'Configure and test outbound sink connectors (e.g. DHIS2). Secrets are encrypted at rest and never shown again.',
      add: 'Add connector',
      empty: 'No connectors yet.',
      colName: 'Name',
      colPlugin: 'Plugin',
      colHost: 'Host',
      colEnabled: 'Enabled',
      colActions: 'Actions',
      test: 'Test',
      edit: 'Edit',
      remove: 'Remove',
      newTitle: 'Add connector',
      editTitle: 'Edit connector',
      fieldName: 'Name',
      fieldPlugin: 'Sink plugin',
      pickPlugin: 'Pick a plugin…',
      fieldBaseUrl: 'Base URL',
      fieldUsername: 'Username',
      fieldPassword: 'Password',
      secretSet: '••• set (leave blank to keep)',
      enabledLabel: 'Enabled',
      save: 'Save',
      cancel: 'Cancel',
      removeTitle: 'Remove {{name}}?',
      removeDescription: 'This deletes the connector and its stored secrets. Mappings pointing at it will fail until reassigned.',
      testing: 'Testing…',
      testOk: 'Connected. {{dataElements}} data elements, {{orgUnits}} org units.',
      testFailed: 'Test failed: {{error}}',
      savedToast: 'Saved {{name}}',
      removedToast: 'Removed {{name}}',
      errorToast: 'Connector error: {{error}}',
      noPlugins: 'No sink plugins installed. Install one from the Marketplace first.',
    },
```
In `fr.ts` add the same keys with these values:
```typescript
    connectors: {
      heading: 'Connecteurs',
      description: 'Configurez et testez les connecteurs de sortie (par ex. DHIS2). Les secrets sont chiffrés au repos et ne sont plus jamais affichés.',
      add: 'Ajouter un connecteur',
      empty: 'Aucun connecteur pour le moment.',
      colName: 'Nom',
      colPlugin: 'Extension',
      colHost: 'Hôte',
      colEnabled: 'Activé',
      colActions: 'Actions',
      test: 'Tester',
      edit: 'Modifier',
      remove: 'Supprimer',
      newTitle: 'Ajouter un connecteur',
      editTitle: 'Modifier le connecteur',
      fieldName: 'Nom',
      fieldPlugin: 'Extension de sortie',
      pickPlugin: 'Choisir une extension…',
      fieldBaseUrl: 'URL de base',
      fieldUsername: 'Nom d’utilisateur',
      fieldPassword: 'Mot de passe',
      secretSet: '••• défini (laisser vide pour conserver)',
      enabledLabel: 'Activé',
      save: 'Enregistrer',
      cancel: 'Annuler',
      removeTitle: 'Supprimer {{name}} ?',
      removeDescription: 'Cela supprime le connecteur et ses secrets. Les correspondances qui le visent échoueront jusqu’à réassignation.',
      testing: 'Test en cours…',
      testOk: 'Connecté. {{dataElements}} éléments de données, {{orgUnits}} unités d’organisation.',
      testFailed: 'Échec du test : {{error}}',
      savedToast: 'Enregistré {{name}}',
      removedToast: 'Supprimé {{name}}',
      errorToast: 'Erreur du connecteur : {{error}}',
      noPlugins: 'Aucune extension de sortie installée. Installez-en une depuis la Place de marché.',
    },
```
In `pt.ts` add the same keys with these values:
```typescript
    connectors: {
      heading: 'Conectores',
      description: 'Configure e teste conectores de saída (por ex. DHIS2). Os segredos são criptografados em repouso e nunca mais exibidos.',
      add: 'Adicionar conector',
      empty: 'Nenhum conector ainda.',
      colName: 'Nome',
      colPlugin: 'Plugin',
      colHost: 'Host',
      colEnabled: 'Ativado',
      colActions: 'Ações',
      test: 'Testar',
      edit: 'Editar',
      remove: 'Remover',
      newTitle: 'Adicionar conector',
      editTitle: 'Editar conector',
      fieldName: 'Nome',
      fieldPlugin: 'Plugin de saída',
      pickPlugin: 'Escolher um plugin…',
      fieldBaseUrl: 'URL base',
      fieldUsername: 'Usuário',
      fieldPassword: 'Senha',
      secretSet: '••• definido (deixe em branco para manter)',
      enabledLabel: 'Ativado',
      save: 'Salvar',
      cancel: 'Cancelar',
      removeTitle: 'Remover {{name}}?',
      removeDescription: 'Isto exclui o conector e seus segredos. Mapeamentos que o utilizam falharão até serem reatribuídos.',
      testing: 'Testando…',
      testOk: 'Conectado. {{dataElements}} elementos de dados, {{orgUnits}} unidades organizacionais.',
      testFailed: 'Falha no teste: {{error}}',
      savedToast: 'Salvo {{name}}',
      removedToast: 'Removido {{name}}',
      errorToast: 'Erro do conector: {{error}}',
      noPlugins: 'Nenhum plugin de saída instalado. Instale um pelo Marketplace primeiro.',
    },
```

- [ ] **Step 3: Add the mapping-editor connector keys**

In `en.ts` under `dhis2.mappings.editor` (after `kindLabel`/`kindAggregate`/`kindTracker`, before the `tracker:` sub-object), add:
```typescript
        connector: 'Connector',
        pickConnector: 'Pick a connector…',
        noConnectors: 'No connectors configured — add one under Settings ▸ Connectors.',
```
In `fr.ts` same place:
```typescript
        connector: 'Connecteur',
        pickConnector: 'Choisir un connecteur…',
        noConnectors: 'Aucun connecteur configuré — ajoutez-en un dans Paramètres ▸ Connecteurs.',
```
In `pt.ts` same place:
```typescript
        connector: 'Conector',
        pickConnector: 'Escolher um conector…',
        noConnectors: 'Nenhum conector configurado — adicione um em Configurações ▸ Conectores.',
```

- [ ] **Step 4: Verify typecheck passes (proves en/fr/pt key parity)**

Run: `pnpm -C apps/web typecheck`
Expected: PASS. If a key is missing from fr/pt, `EnShape` fails compilation here — fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): i18n keys for connectors page + mapping connector picker (SP-5b)"
```

---

### Task 3: Connectors settings page (TDD)

**Files:**
- Create: `apps/web/src/pages/settings/Connectors.tsx`
- Test: `apps/web/src/pages/settings/Connectors.test.tsx`

Modelled on `Marketplace.tsx` (CRUD page with dialog + ConfirmDialog) and `Dhis2MappingEditor.tsx` (shadcn `Select` picker pattern). Uses `Table`, `Switch`, `Dialog`, `Select`, `Input`, `Button`, `ConfirmDialog`, sonner `toast`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/settings/Connectors.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasRole: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    listConnectors: vi.fn(), listSinkPlugins: vi.fn(), createConnector: vi.fn(),
    updateConnector: vi.fn(), deleteConnector: vi.fn(), testConnector: vi.fn() };
});
import * as api from '@/api';
import { Connectors } from './Connectors';

const conn = { id: 'c1', name: 'Prod DHIS2', pluginId: 'dhis2-sink', kind: 'sink', allowedHost: 'dhis2.example.org', enabled: true, createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  (api.listConnectors as any).mockResolvedValue([conn]);
  (api.listSinkPlugins as any).mockResolvedValue([{ id: 'dhis2-sink', version: '1.0.0', enabled: true }]);
});

describe('Connectors page', () => {
  it('lists connectors', async () => {
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    expect(await screen.findByText('Prod DHIS2')).toBeTruthy();
    expect(screen.getByText('dhis2.example.org')).toBeTruthy();
  });

  it('creates a connector via the dialog', async () => {
    (api.createConnector as any).mockResolvedValue({ ...conn, id: 'c2', name: 'New' });
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('add-connector'));
    fireEvent.change(await screen.findByTestId('connector-name'), { target: { value: 'New' } });
    // pick the plugin
    fireEvent.click(screen.getByTestId('connector-plugin'));
    fireEvent.click(await screen.findByText('dhis2-sink'));
    fireEvent.change(screen.getByTestId('connector-baseurl'), { target: { value: 'https://dhis2.example.org' } });
    fireEvent.change(screen.getByTestId('connector-username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByTestId('connector-password'), { target: { value: 'district' } });
    fireEvent.click(screen.getByTestId('connector-save'));
    await waitFor(() => expect(api.createConnector).toHaveBeenCalledWith({
      name: 'New', pluginId: 'dhis2-sink',
      config: { baseUrl: 'https://dhis2.example.org', username: 'admin', password: 'district' },
    }));
  });

  it('tests a connector and shows the metadata summary', async () => {
    (api.testConnector as any).mockResolvedValue({ ok: true, metadata: { dataElements: 12, orgUnits: 5, categoryOptionCombos: 3, programs: 1, programStages: 2 } });
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('test-c1'));
    await waitFor(() => expect(api.testConnector).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText(/12 data elements/i)).toBeTruthy();
  });

  it('removes a connector after confirm', async () => {
    (api.deleteConnector as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('remove-c1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.deleteConnector).toHaveBeenCalledWith('c1'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/web test Connectors`
Expected: FAIL — `Cannot find module './Connectors'` (page not created yet).

- [ ] **Step 3: Implement `Connectors.tsx`**

Create `apps/web/src/pages/settings/Connectors.tsx`:
```typescript
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  listConnectors, listSinkPlugins, createConnector, updateConnector, deleteConnector, testConnector,
  type Connector, type SinkPluginRef,
} from '@/api';

interface DraftState {
  id: string | null; // null = create
  name: string;
  pluginId: string;
  baseUrl: string;
  username: string;
  password: string; // blank on edit = keep existing
  enabled: boolean;
}

const emptyDraft = (): DraftState => ({ id: null, name: '', pluginId: '', baseUrl: '', username: '', password: '', enabled: true });

export function Connectors() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Connector[]>([]);
  const [plugins, setPlugins] = useState<SinkPluginRef[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Connector | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cs, ps] = await Promise.all([listConnectors(), listSinkPlugins()]);
      setRows(cs); setPlugins(ps);
    } catch (e) {
      toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const openCreate = () => setDraft(emptyDraft());
  const openEdit = (c: Connector) =>
    setDraft({ id: c.id, name: c.name, pluginId: c.pluginId, baseUrl: '', username: '', password: '', enabled: c.enabled });

  const onSave = useCallback(async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const config: Record<string, string> = {};
      if (draft.baseUrl) config.baseUrl = draft.baseUrl;
      if (draft.username) config.username = draft.username;
      if (draft.password) config.password = draft.password;
      if (draft.id === null) {
        await createConnector({ name: draft.name, pluginId: draft.pluginId, config });
      } else {
        // Only send config when the operator re-entered any secret (write-only).
        const hasConfig = Object.keys(config).length > 0;
        await updateConnector(draft.id, { name: draft.name, enabled: draft.enabled, ...(hasConfig ? { config } : {}) });
      }
      toast.success(t('settings.connectors.savedToast', { name: draft.name }));
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, t, load]);

  const onToggle = useCallback(async (c: Connector, enabled: boolean) => {
    try { await updateConnector(c.id, { enabled }); await load(); }
    catch (e) { toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onTest = useCallback(async (c: Connector) => {
    setTesting(c.id);
    setTestResult((r) => ({ ...r, [c.id]: t('settings.connectors.testing') }));
    try {
      const res = await testConnector(c.id);
      setTestResult((r) => ({
        ...r,
        [c.id]: res.ok
          ? t('settings.connectors.testOk', { dataElements: res.metadata.dataElements, orgUnits: res.metadata.orgUnits })
          : t('settings.connectors.testFailed', { error: res.error }),
      }));
    } catch (e) {
      setTestResult((r) => ({ ...r, [c.id]: t('settings.connectors.testFailed', { error: e instanceof Error ? e.message : String(e) }) }));
    } finally {
      setTesting(null);
    }
  }, [t]);

  const onRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const c = pendingRemove;
    setPendingRemove(null);
    try { await deleteConnector(c.id); toast.success(t('settings.connectors.removedToast', { name: c.name })); await load(); }
    catch (e) { toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingRemove, t, load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="connectors-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{t('settings.connectors.heading')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.connectors.description')}</p>
        </div>
        <Button data-testid="add-connector" onClick={openCreate} disabled={plugins.length === 0}>
          {t('settings.connectors.add')}
        </Button>
      </div>

      {plugins.length === 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          {t('settings.connectors.noPlugins')}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t('settings.connectors.empty')}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.connectors.colName')}</TableHead>
              <TableHead>{t('settings.connectors.colPlugin')}</TableHead>
              <TableHead>{t('settings.connectors.colHost')}</TableHead>
              <TableHead>{t('settings.connectors.colEnabled')}</TableHead>
              <TableHead className="text-right">{t('settings.connectors.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id} data-testid={`connector-row-${c.id}`}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.pluginId}</TableCell>
                <TableCell className="text-muted-foreground">{c.allowedHost ?? '—'}</TableCell>
                <TableCell>
                  <Switch checked={c.enabled} onCheckedChange={(v) => void onToggle(c, v)} aria-label={t('settings.connectors.enabledLabel')} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" data-testid={`test-${c.id}`} disabled={testing === c.id} onClick={() => void onTest(c)}>
                      {t('settings.connectors.test')}
                    </Button>
                    <Button variant="outline" size="sm" data-testid={`edit-${c.id}`} onClick={() => openEdit(c)}>
                      {t('settings.connectors.edit')}
                    </Button>
                    <Button variant="ghost" size="sm" data-testid={`remove-${c.id}`} onClick={() => setPendingRemove(c)}>
                      {t('settings.connectors.remove')}
                    </Button>
                  </div>
                  {testResult[c.id] ? (
                    <div className="mt-1 text-right text-xs text-muted-foreground" data-testid={`test-result-${c.id}`}>{testResult[c.id]}</div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / edit dialog */}
      <Dialog open={draft !== null} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>{draft?.id === null ? t('settings.connectors.newTitle') : t('settings.connectors.editTitle')}</DialogTitle>
          {draft ? (
            <div className="grid gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-muted-foreground">{t('settings.connectors.fieldName')}</span>
                <Input data-testid="connector-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-muted-foreground">{t('settings.connectors.fieldPlugin')}</span>
                <Select value={draft.pluginId} onValueChange={(v) => setDraft({ ...draft, pluginId: v })}>
                  <SelectTrigger data-testid="connector-plugin"><SelectValue placeholder={t('settings.connectors.pickPlugin')} /></SelectTrigger>
                  <SelectContent>
                    {plugins.map((p) => <SelectItem key={p.id} value={p.id}>{p.id}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1">
                <span className="text-muted-foreground">{t('settings.connectors.fieldBaseUrl')}</span>
                <Input data-testid="connector-baseurl" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder={draft.id === null ? 'https://dhis2.example.org' : t('settings.connectors.secretSet')} />
              </label>
              <label className="grid gap-1">
                <span className="text-muted-foreground">{t('settings.connectors.fieldUsername')}</span>
                <Input data-testid="connector-username" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                  placeholder={draft.id === null ? '' : t('settings.connectors.secretSet')} />
              </label>
              <label className="grid gap-1">
                <span className="text-muted-foreground">{t('settings.connectors.fieldPassword')}</span>
                <Input data-testid="connector-password" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                  placeholder={draft.id === null ? '' : t('settings.connectors.secretSet')} />
              </label>
              {draft.id !== null ? (
                <label className="flex items-center gap-2">
                  <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} aria-label={t('settings.connectors.enabledLabel')} />
                  <span className="text-muted-foreground">{t('settings.connectors.enabledLabel')}</span>
                </label>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDraft(null)}>{t('settings.connectors.cancel')}</Button>
                <Button data-testid="connector-save" disabled={busy || !draft.name || !draft.pluginId} onClick={() => void onSave()}>
                  {t('settings.connectors.save')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={t('settings.connectors.removeTitle', { name: pendingRemove?.name ?? '' })}
        description={t('settings.connectors.removeDescription')}
        confirmLabel={t('settings.connectors.remove')}
        destructive
        onConfirm={() => { void onRemove(); }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C apps/web test Connectors`
Expected: PASS (4 tests). If the Radix `Select` open doesn't fire in jsdom, match the editor test's pattern — `fireEvent.click` on the trigger then click the item text; the repo's `Select` test confirms this works in jsdom.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/Connectors.tsx apps/web/src/pages/settings/Connectors.test.tsx
git commit -m "feat(web): Settings Connectors page — list/create/edit/test/remove (SP-5b)"
```

---

### Task 4: Wire the route + SUB_NAV

**Files:**
- Modify: `apps/web/src/pages/settings/SettingsShell.tsx:14-17`
- Modify: `apps/web/src/pages/settings/SettingsShell.test.tsx`
- Modify: `apps/web/src/App.tsx:17` (import) + `:45` (route, after the marketplace route)

- [ ] **Step 1: Add the failing SettingsShell test assertion**

In `apps/web/src/pages/settings/SettingsShell.test.tsx`, add (inside the existing `describe`):
```typescript
  it('shows the Connectors nav link for lab_admin', async () => {
    // (render helper identical to the other tests in this file)
    render(
      <MemoryRouter initialEntries={['/settings/dhis2']}>
        <Routes><Route path="/settings/*" element={<SettingsShell />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Connectors' })).toBeTruthy();
  });
```
(Use the file's existing imports/mocks/render shape — if it already mocks `useAuth` with `hasRole: () => true`, reuse it; do not duplicate mocks.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C apps/web test SettingsShell`
Expected: FAIL — no link named "Connectors" yet.

- [ ] **Step 3: Add the SUB_NAV entry**

In `SettingsShell.tsx`, add to `SUB_NAV` (after the `dhis2` entry, before `marketplace`):
```typescript
  { labelKey: 'settings.subNav.connectors', to: '/settings/connectors', roles: ['lab_admin'] },
```

- [ ] **Step 4: Add the route in App.tsx**

Add the import near the other settings imports (after line 17 `import { Marketplace } ...`):
```typescript
import { Connectors } from '@/pages/settings/Connectors';
```
Add the route inside the `/settings` parent `<Route>` (after the `marketplace` route at line 45):
```tsx
        <Route path="connectors" element={<RequireRole role="lab_admin"><Connectors /></RequireRole>} />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C apps/web test SettingsShell`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/settings/SettingsShell.tsx apps/web/src/pages/settings/SettingsShell.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): route + nav for Settings Connectors page (SP-5b)"
```

---

### Task 5: Connector picker on the DHIS2 mapping editor (TDD)

**Files:**
- Modify: `apps/web/src/pages/Dhis2MappingEditor.tsx`
- Test: `apps/web/src/pages/Dhis2MappingEditor.test.tsx`

The editor must let the operator choose which connector receives this mapping's push, persisting `connectorId` at the top level of the saved `definition` (the host reads `mapping.connectorId`).

- [ ] **Step 1: Inspect the existing editor test for its mock shape**

Read `apps/web/src/pages/Dhis2MappingEditor.test.tsx` first so the new case reuses the file's existing `@/api` mock (it already mocks `fetchReports`, `getDhis2Metadata`, `getDhis2EventSources`, `saveDhis2Mapping`, etc.). Add `listConnectors` to that mock and return one connector.

- [ ] **Step 2: Write the failing test case**

Add to `Dhis2MappingEditor.test.tsx` (adapt to the file's render helper + mock object):
```typescript
  it('saves the chosen connectorId into the mapping definition', async () => {
    (api.listConnectors as any).mockResolvedValue([{ id: 'c1', name: 'Prod DHIS2', pluginId: 'dhis2-sink', kind: 'sink', allowedHost: 'h', enabled: true, createdAt: '', updatedAt: '' }]);
    (api.saveDhis2Mapping as any).mockResolvedValue({ id: 'm', name: 'm', definition: {} });
    // render editor in "new" mode (no :id), fill name, pick the connector, save
    renderEditor(); // file's helper
    fireEvent.change(await screen.findByTestId('mapping-name'), { target: { value: 'm' } });
    fireEvent.click(screen.getByTestId('connector-select'));
    fireEvent.click(await screen.findByText('Prod DHIS2'));
    fireEvent.click(screen.getByTestId('save-mapping'));
    await waitFor(() => {
      const [, body] = (api.saveDhis2Mapping as any).mock.calls[0];
      expect(body.definition.connectorId).toBe('c1');
    });
  });
```
Remember to add `listConnectors: vi.fn()` to the file's `vi.mock('@/api', ...)` return object, and a `beforeEach` default `(api.listConnectors as any).mockResolvedValue([])` so the other existing tests still pass.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C apps/web test Dhis2MappingEditor`
Expected: FAIL — no `connector-select` element / `connectorId` undefined.

- [ ] **Step 4: Implement the connector picker**

In `Dhis2MappingEditor.tsx`:

1. Add the import:
```typescript
import { /* existing imports… */ listConnectors, type Connector } from '@/api';
```
2. Add state (near the other `useState`s):
```typescript
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connectorId, setConnectorId] = useState('');
```
3. In the load `useEffect`, fetch connectors alongside the existing `Promise.all` and load the saved value. Change the existing line:
```typescript
        const [reps, srcs, m] = await Promise.all([fetchReports(), getDhis2EventSources(), getDhis2Metadata()]);
        setReports(reps); setEventSources(srcs); setMeta(m);
```
to:
```typescript
        const [reps, srcs, m, conns] = await Promise.all([fetchReports(), getDhis2EventSources(), getDhis2Metadata(), listConnectors()]);
        setReports(reps); setEventSources(srcs); setMeta(m); setConnectors(conns);
```
And in the existing-record load branch (after `setMappingId(rec.id); setName(rec.name);`), read it:
```typescript
          setConnectorId((d as { connectorId?: string }).connectorId ?? '');
```
4. Include it in `def()` — add `...(connectorId ? { connectorId } : {})` to **both** returned objects, and add `connectorId` to the `useCallback` dependency array:
```typescript
    const d: AggregateMappingDef = {
      kind: 'aggregate', id: mappingId, name,
      ...(connectorId ? { connectorId } : {}),
      source: { kind: 'report', reportId },
      // …unchanged…
    };
```
```typescript
      const d: TrackerMappingDef = {
        kind: 'tracker', id: mappingId, name,
        ...(connectorId ? { connectorId } : {}),
        source: { kind: 'event-source', sourceId },
        // …unchanged…
      };
```
```typescript
  }, [kind, mappingId, name, connectorId, reportId, /* …rest unchanged… */]);
```
5. Render the picker (place it right after the mapping-name `<label>` block, using the file's local `Picker` helper):
```tsx
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t('dhis2.mappings.editor.connector')}</span>
          <Picker testid="connector-select" value={connectorId} onChange={setConnectorId}
            placeholder={t('dhis2.mappings.editor.pickConnector')}
            options={connectors.filter((c) => c.enabled).map((c) => ({ value: c.id, label: c.name }))} />
          {connectors.length === 0 ? (
            <span className="text-xs text-amber-600">{t('dhis2.mappings.editor.noConnectors')}</span>
          ) : null}
        </label>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C apps/web test Dhis2MappingEditor`
Expected: PASS (existing cases + the new one).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/Dhis2MappingEditor.tsx apps/web/src/pages/Dhis2MappingEditor.test.tsx
git commit -m "feat(web): connector picker on DHIS2 mapping editor sets definition.connectorId (SP-5b)"
```

---

### Task 6: Mapping picker + Test button on the workflow `dhis2-push` node (TDD)

**Files:**
- Modify: `apps/web/src/workflows/components/node-forms/dhis2-push-form.tsx`
- Test: `apps/web/src/workflows/components/node-forms/dhis2-push-form.test.tsx` (create)

The node selects a **mapping**; the mapping carries `connectorId`, so the node needs **no** connector field. Improve UX: replace the free-text "Mapping ID" with a picker (using the node-forms' own shared `Select` to match every sibling form in that subsystem), and add a Test button that resolves the mapping's connector and runs `testConnector`, showing the result inline.

Note: the workflow node-form subsystem (`node-forms/*`) deliberately uses its own native-styled `Select`/`TextInput` from `./shared` and literal English strings (not i18n) — match that local convention here. The shadcn rule applies to app pages, not this n8n-style side panel.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/workflows/components/node-forms/dhis2-push-form.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listDhis2Mappings: vi.fn(), getDhis2Mapping: vi.fn(), testConnector: vi.fn() };
});
import * as api from '@/api';
import { Dhis2PushForm } from './dhis2-push-form';

const node = (config: Record<string, unknown> = {}) => ({ id: 'n1', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Push', config } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  (api.listDhis2Mappings as any).mockResolvedValue([{ id: 'amr-mapping', name: 'AMR', kind: 'aggregate' }]);
});

describe('Dhis2PushForm', () => {
  it('lists mappings in a picker and updates config on select', async () => {
    const update = vi.fn();
    render(<Dhis2PushForm node={node()} update={update} />);
    const select = await screen.findByTestId('dhis2-mapping-select');
    fireEvent.change(select, { target: { value: 'amr-mapping' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ mappingId: 'amr-mapping' }) });
  });

  it('tests the selected mapping connector and shows the result', async () => {
    (api.getDhis2Mapping as any).mockResolvedValue({ id: 'amr-mapping', name: 'AMR', definition: { connectorId: 'c1' } });
    (api.testConnector as any).mockResolvedValue({ ok: true, metadata: { dataElements: 7, orgUnits: 2, categoryOptionCombos: 0, programs: 0, programStages: 0 } });
    render(<Dhis2PushForm node={node({ mappingId: 'amr-mapping' })} update={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('dhis2-test'));
    await waitFor(() => expect(api.testConnector).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText(/7 data elements/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C apps/web test dhis2-push-form`
Expected: FAIL — no `dhis2-mapping-select` / `dhis2-test` elements.

- [ ] **Step 3: Implement the form changes**

Replace `apps/web/src/workflows/components/node-forms/dhis2-push-form.tsx` with:
```typescript
import { useCallback, useEffect, useState } from 'react';
import type { NodeFormProps } from './index';
import { FormField, TextInput, Select, inputClass } from './shared';
import { Button } from '@/components/ui/button';
import { listDhis2Mappings, getDhis2Mapping, testConnector, type Dhis2MappingSummary } from '@/api';

export function Dhis2PushForm({ node, update }: NodeFormProps) {
  const data = node.data as {
    label?: string;
    config?: { mappingId?: string; period?: string; dryRun?: boolean };
  };
  const config = data.config ?? {};
  const [mappings, setMappings] = useState<Dhis2MappingSummary[]>([]);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { void listDhis2Mappings().then(setMappings).catch(() => setMappings([])); }, []);

  const onTest = useCallback(async () => {
    const mappingId = config.mappingId;
    if (!mappingId) { setTestMsg('Select a mapping first.'); return; }
    setTesting(true); setTestMsg('Testing…');
    try {
      const rec = await getDhis2Mapping(mappingId);
      const connectorId = (rec.definition as { connectorId?: string }).connectorId;
      if (!connectorId) { setTestMsg('This mapping has no connector configured (set it in Settings › DHIS2).'); return; }
      const res = await testConnector(connectorId);
      setTestMsg(res.ok ? `Connected. ${res.metadata.dataElements} data elements, ${res.metadata.orgUnits} org units.` : `Test failed: ${res.error}`);
    } catch (e) {
      setTestMsg(`Test failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  }, [config.mappingId]);

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Mapping" hint="A DHIS2 mapping from Settings › DHIS2. The mapping carries the connector to push to.">
        <Select
          data-testid="dhis2-mapping-select"
          value={config.mappingId ?? ''}
          onChange={(e) => update({ config: { ...config, mappingId: e.target.value } })}
        >
          <option value="">Select a mapping…</option>
          {mappings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </FormField>
      <FormField label="Period" hint="DHIS2 period string, e.g. 202401, 2024Q1, 2024W01.">
        <TextInput
          value={config.period ?? ''}
          onChange={(e) => update({ config: { ...config, period: e.target.value } })}
          placeholder="202401"
        />
      </FormField>
      <div className="flex items-center gap-2">
        <input
          id="dhis2-dryrun"
          type="checkbox"
          className={inputClass + ' mt-0 h-4 w-4 cursor-pointer'}
          checked={config.dryRun ?? false}
          onChange={(e) => update({ config: { ...config, dryRun: e.target.checked } })}
        />
        <label htmlFor="dhis2-dryrun" className="cursor-pointer text-sm text-foreground">
          Dry run (validate only, do not submit)
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" data-testid="dhis2-test" disabled={testing} onClick={() => void onTest()}>
          Test connection
        </Button>
        {testMsg ? <span className="text-xs text-muted-foreground" data-testid="dhis2-test-result">{testMsg}</span> : null}
      </div>
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-amber-400">
        The selected mapping must point at an enabled connector (Settings › Connectors). Without it the node will error at run time.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C apps/web test dhis2-push-form`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workflows/components/node-forms/dhis2-push-form.tsx apps/web/src/workflows/components/node-forms/dhis2-push-form.test.tsx
git commit -m "feat(web): dhis2-push node mapping picker + connection test (SP-5b)"
```

---

### Task 7: Docs sweep — replace removed `DHIS2_*` env vars with the connector flow

**Files:**
- Modify: `apps/web/src/docs/0.1.0/en/dhis2.md`
- Modify: `apps/web/src/docs/0.1.0/fr/dhis2.md`
- Modify: `apps/web/src/docs/0.1.0/pt/dhis2.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `docs/OPERATOR-GUIDE.md`

`DHIS2_BASE_URL/USERNAME/PASSWORD` were removed in SP-4 (connection now lives in encrypted **connectors**; only `REPORTING_TARGET_ADAPTER=dhis2` (gate), `DHIS2_SYNC_ENABLED`, and `SECRETS_ENCRYPTION_KEY` remain in env). No tests — verify by grepping that no operator doc still tells the reader to set the removed vars.

- [ ] **Step 1: Fix `apps/web/src/docs/0.1.0/en/dhis2.md`**

Replace the "## Connecting" block (the `Set the DHIS2 connection in your environment:` paragraph + the fenced env block, lines ~5-15) with:
```markdown
## Connecting

DHIS2 connection details (base URL, username, password) live in an encrypted **Connector**, not in environment variables. Create one under **Settings ▸ Connectors**: pick the `dhis2-sink` plugin, enter the base URL and credentials, then click **Test connection** to verify reachability and pull a metadata summary. Secrets are encrypted at rest and never shown again.

Two environment values still apply:

```text
REPORTING_TARGET_ADAPTER=dhis2     # enables DHIS2 reporting-target wiring
SECRETS_ENCRYPTION_KEY=<base64>    # 32-byte key (openssl rand -base64 32) — required to store/read connector secrets
DHIS2_SYNC_ENABLED=true            # optional, enables scheduled/event-driven sync
```

Each DHIS2 mapping selects which connector receives its push (see **Mapping** below).
```

- [ ] **Step 2: Fix `fr/dhis2.md` and `pt/dhis2.md`**

Apply the equivalent change to the `## Connexion` (fr) and `## Conexão` (pt) sections — drop the `DHIS2_BASE_URL/USERNAME/PASSWORD` lines from the fenced block, keep `REPORTING_TARGET_ADAPTER=dhis2` + add `SECRETS_ENCRYPTION_KEY`, and add a sentence that the connection now lives in a Connector configured under Settings ▸ Connectors / Paramètres ▸ Connecteurs / Configurações ▸ Conectores. Mirror the en prose, translated.

fr fenced block becomes:
```text
REPORTING_TARGET_ADAPTER=dhis2
SECRETS_ENCRYPTION_KEY=<base64>
DHIS2_SYNC_ENABLED=true
```
with a lead-in: `Les informations de connexion DHIS2 sont stockées dans un **Connecteur** chiffré (Paramètres ▸ Connecteurs), pas dans des variables d’environnement. Deux variables d’environnement restent nécessaires :`

pt fenced block identical to fr's; lead-in: `As informações de conexão do DHIS2 ficam em um **Conector** criptografado (Configurações ▸ Conectores), não em variáveis de ambiente. Duas variáveis de ambiente ainda se aplicam:`

- [ ] **Step 3: Fix `docs/CONFIGURATION.md`**

In the env-var table (lines ~69-73), remove the `DHIS2_BASE_URL`, `DHIS2_USERNAME`, `DHIS2_PASSWORD` rows. Keep `REPORTING_TARGET_ADAPTER` and `DHIS2_SYNC_ENABLED`, and add a `SECRETS_ENCRYPTION_KEY` row plus an updated `REPORTING_TARGET_ADAPTER` effect:
```markdown
| `REPORTING_TARGET_ADAPTER` | `none\|dhis2` | `none` | Enables DHIS2 reporting-target wiring. Connection details live in a Connector (Settings ▸ Connectors), not env vars. |
| `SECRETS_ENCRYPTION_KEY` | base64 (32 bytes) | required to use secret-bearing connectors | AES-256-GCM key for connector secrets at rest. Generate with `openssl rand -base64 32`. |
| `DHIS2_SYNC_ENABLED` | boolean string | `true` | Enables scheduled/event-driven DHIS2 sync processing. |
```
And fix the troubleshooting row (line ~136):
```markdown
| DHIS2 push fails with a connector error | No connector configured, the connector is disabled, or `SECRETS_ENCRYPTION_KEY` is unset. | Create/enable a connector under Settings ▸ Connectors and set `SECRETS_ENCRYPTION_KEY`. |
```

- [ ] **Step 4: Fix `docs/OPERATOR-GUIDE.md`**

Replace the DHIS2 intro sentence (line ~155):
```markdown
Use DHIS2 for aggregate `dataValueSet` and tracker event pushes. Set `REPORTING_TARGET_ADAPTER=dhis2` and `SECRETS_ENCRYPTION_KEY` (`openssl rand -base64 32`), then create a DHIS2 connector under **Settings ▸ Connectors** (base URL + credentials, encrypted at rest) and select it from each mapping.
```

- [ ] **Step 5: Verify no operator doc still references the removed vars**

Run:
```bash
git grep -nE 'DHIS2_BASE_URL|DHIS2_USERNAME|DHIS2_PASSWORD' -- 'apps/web/src/docs/**' 'docs/CONFIGURATION.md' 'docs/OPERATOR-GUIDE.md'
```
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/docs/0.1.0/en/dhis2.md apps/web/src/docs/0.1.0/fr/dhis2.md apps/web/src/docs/0.1.0/pt/dhis2.md docs/CONFIGURATION.md docs/OPERATOR-GUIDE.md
git commit -m "docs(dhis2): connector-based connection replaces removed DHIS2_* env vars (SP-5b)"
```

---

### Task 8: Full gate + finish the branch

- [ ] **Step 1: Run the full gate**

Run:
```bash
pnpm turbo run typecheck lint test build && pnpm depcruise
```
Expected: all green. If `@openldr/web#test` shows the known turbo parallel flake, re-run isolated and trust that:
```bash
pnpm -C apps/web test
```

- [ ] **Step 2: Finish the development branch**

Use `superpowers:finishing-a-development-branch`: merge `feat/dhis2-sink-sp5b` to **local `main`** (fast-forward / clean merge), do **NOT** push, then remove the branch + worktree. Re-run the full gate on `main` post-merge to confirm green.

- [ ] **Step 3: Update memory**

Update the `dhis2-sink-plugin-workstream` memory file: mark SP-5b COMPLETE (merge commit, what landed: connector api client + Connectors page + route/nav + mapping-editor connector picker + push-node mapping picker/test + docs sweep), and note SP-6 (live Docker DHIS2 e2e) is the only remaining milestone.

---

## Self-Review (completed against the spec §L5 + the SP-5b brief)

**Spec coverage:**
- Settings ▸ Connectors page (list name·plugin·host·enabled + create/edit + Test showing status+metadata, secrets write-only) → Task 3. ✅
- api.ts client (list/create/update/delete/test + listSinkPlugins) → Task 1. ✅
- Route + SUB_NAV + i18n en/fr/pt → Tasks 2 + 4. ✅
- Connector picker on `Dhis2MappingEditor` setting `definition.connectorId` → Task 5. ✅
- Workflow `dhis2-push` node: confirmed it needs **no** connector field (resolved from the mapping's `connectorId` per `dhis2-context.connectorIdOf`); added a Test button (+ mapping picker) → Task 6. ✅
- Deferred docs sweep (en/fr/pt dhis2.md + CONFIGURATION.md + OPERATOR-GUIDE.md) → Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; the only "adapt to file's existing helper" notes (Tasks 4-6) are because those test files already have render/mock helpers we must reuse, not placeholders — the new assertions/cases are spelled out.

**Type consistency:** `Connector`/`SinkPluginRef`/`ConnectorTestResult` defined in Task 1 are used verbatim in Tasks 3/5/6. `connectorId?` added to both mapping defs in Task 1, written by Task 5, read by Task 6. i18n keys defined in Task 2 are exactly those referenced in Tasks 3-5. API shapes match `apps/server/src/connectors-routes.ts`.

**Note for executor:** if the `Select` Radix interactions in jsdom need the `fireEvent.click(trigger) → click(item-text)` pattern (Task 3) vs. native `<select>` `fireEvent.change` (Task 6 uses the node-forms native `Select`), follow each test as written — they intentionally differ because the page uses shadcn `Select` and the node form uses the native styled `Select`.
