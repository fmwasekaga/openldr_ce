# SP-B — Marketplace Version Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse shows **one card per plugin id** (the latest version), not one card per bundle directory — fixing the duplicate `whonet-sqlite` cards (v1.0.0 + v1.1.0) and the "100 versions fill the page" problem — and the plugin **detail page gets a version selector** to view/install a specific version.

**Architecture:** The local registry currently lists one `RegistryListing` per bundle *directory*, so multiple versions of one plugin show as separate cards. We add a pure `collapseByLatest()` that groups listings by `id`, keeps the highest-semver one as the card, and attaches a `versions: { version, ref }[]` list. `LocalRegistrySource.list()` collapses its per-dir listings; `HttpRegistrySource.list()` (already one entry per id via `latestVersion`) sets a single-element `versions`. The web carries `versions` to the detail page, which renders a dropdown; selecting a version refetches that version's detail by its `ref` and targets install/rollback at it.

**Tech Stack:** TypeScript, zod (existing manifest/index schemas), React + shadcn `Select`, Vitest.

## Recon (verified)
- `packages/marketplace/src/registry-source.ts` — `RegistryListing` (lines 6-18, has ref/id/version/…; **no `versions`**); `LocalRegistrySource.list()` (36-51) pushes one listing per dir; `HttpRegistrySource.list()` (89-96) maps index entries (already one per id, `e.latestVersion`). Existing test: `registry-source.test.ts`.
- No semver-compare util in `packages/marketplace` — inline a small one. Version strings are SEMVER (validated by `artifactManifestSchema`).
- Server list: `apps/server/src/marketplace-routes.ts` `GET /api/marketplace/available` (~65-83) maps `source.list()` → response bundles.
- Web: `apps/web/src/api.ts` `AvailableArtifact` (~910-924, no `versions`); `listAvailableArtifacts` (~956). `apps/web/src/pages/settings/marketplace/util.ts` `CardEntry` (4-17) + `availableToEntry` (30-36). `PackageDetail.tsx` fetches detail via `getAvailableArtifact(entry.ref)` (line 38) and installs via `onInstall(entry, ...)`; the right sidebar "Details" section (~137-144) is where a version row/selector fits.

---

### Task 1: `collapseByLatest` + registry sources carry `versions` (TDD)

**Files:** Modify `packages/marketplace/src/registry-source.ts`; Test: `packages/marketplace/src/registry-source.test.ts`.

- [ ] **Step 1: Failing test for `collapseByLatest`**

Add to `registry-source.test.ts` (import `collapseByLatest` — to be exported):
```typescript
import { collapseByLatest } from './registry-source';

const L = (ref: string, id: string, version: string) => ({ ref, id, version, type: 'plugin', publisher: null });

describe('collapseByLatest', () => {
  it('returns one listing per id, choosing the highest semver, with all versions attached', () => {
    const out = collapseByLatest([
      L('whonet-narrow', 'whonet-sqlite', '1.0.0'),
      L('whonet-wide', 'whonet-sqlite', '1.1.0'),
      L('dhis2-sink', 'dhis2-sink', '0.1.0'),
    ]);
    expect(out).toHaveLength(2);
    const whonet = out.find((l) => l.id === 'whonet-sqlite')!;
    expect(whonet.version).toBe('1.1.0');            // latest is the card
    expect(whonet.ref).toBe('whonet-wide');          // card ref = latest version's ref
    expect(whonet.versions).toEqual([                 // all versions, newest first
      { version: '1.1.0', ref: 'whonet-wide' },
      { version: '1.0.0', ref: 'whonet-narrow' },
    ]);
  });
  it('handles patch/minor/major ordering and a lone version', () => {
    const out = collapseByLatest([L('a-2', 'a', '2.0.0'), L('a-10', 'a', '10.0.0'), L('a-2-1', 'a', '2.1.0')]);
    expect(out).toHaveLength(1);
    expect(out[0].version).toBe('10.0.0');
    expect(out[0].versions!.map((v) => v.version)).toEqual(['10.0.0', '2.1.0', '2.0.0']);
  });
});
```
Run: `pnpm -C packages/marketplace test registry-source` → FAIL (`collapseByLatest` not exported).

- [ ] **Step 2: Implement `collapseByLatest` + semver compare + `versions` field**

In `registry-source.ts`, add `versions?: { version: string; ref: string }[];` to the `RegistryListing` interface, and add (top-level exports):
```typescript
/** Compare two semver strings. Returns >0 if a>b, <0 if a<b, 0 if equal. Numeric major.minor.patch;
 *  a release outranks a prerelease of the same core (1.0.0 > 1.0.0-rc.1). Inputs are schema-validated semver. */
export function compareSemver(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.split('-', 2);
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { nums, pre: pre ?? null };
  };
  const A = split(a), B = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (A.pre === B.pre) return 0;
  if (A.pre === null) return 1;   // release > prerelease
  if (B.pre === null) return -1;
  return A.pre < B.pre ? -1 : 1;  // lexical prerelease tiebreak
}

/** Group listings by plugin id → one listing per id (the highest-semver one as the card),
 *  with all available { version, ref } attached newest-first. Stable: ids sorted ascending. */
export function collapseByLatest(listings: RegistryListing[]): RegistryListing[] {
  const byId = new Map<string, RegistryListing[]>();
  for (const l of listings) {
    const arr = byId.get(l.id) ?? [];
    arr.push(l);
    byId.set(l.id, arr);
  }
  const out: RegistryListing[] = [];
  for (const id of [...byId.keys()].sort()) {
    const group = byId.get(id)!.slice().sort((x, y) => compareSemver(y.version, x.version)); // desc
    const latest = group[0];
    out.push({ ...latest, versions: group.map((g) => ({ version: g.version, ref: g.ref })) });
  }
  return out;
}
```

- [ ] **Step 3: Wire the sources**

`LocalRegistrySource.list()` — wrap the return: build the per-dir `out` array as today, then `return collapseByLatest(out);`.
`HttpRegistrySource.list()` — add `versions` to each mapped entry: `versions: [{ version: e.latestVersion, ref }]` (the HTTP index exposes only the latest per id; a multi-version index is out of scope — noted below).

- [ ] **Step 4: Run tests** — `pnpm -C packages/marketplace test registry-source` → PASS (collapse tests + existing tests still green). `pnpm -C packages/marketplace typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/marketplace/src/registry-source.ts packages/marketplace/src/registry-source.test.ts
git commit -m "feat(marketplace): collapse Browse listings by id (latest) + carry versions[] (SP-B)"
```

---

### Task 2: Thread `versions` to the web (API + types)

**Files:** `apps/server/src/marketplace-routes.ts`, `apps/web/src/api.ts`, `apps/web/src/pages/settings/marketplace/util.ts`.

- [ ] **Step 1: Server passthrough**

In `marketplace-routes.ts` `GET /api/marketplace/available`, the bundles are mapped from `source.list()` (each a `RegistryListing`). Add `versions: b.versions ?? []` to the mapped object (alongside ref/id/version/…). (Read the exact map block ~73-78 and add the field.)

- [ ] **Step 2: Web types**

`apps/web/src/api.ts`: add to `AvailableArtifact` (the interface ending ~924):
```typescript
  versions?: { version: string; ref: string }[];
```

`apps/web/src/pages/settings/marketplace/util.ts`: add `versions?: { version: string; ref: string }[];` to `CardEntry`, and in `availableToEntry` add `versions: b.versions ?? [],`.

- [ ] **Step 3: typecheck**

Run: `pnpm turbo run typecheck --filter=@openldr/server --filter=@openldr/web` → PASS.

- [ ] **Step 4: Commit**
```bash
git add apps/server/src/marketplace-routes.ts apps/web/src/api.ts apps/web/src/pages/settings/marketplace/util.ts
git commit -m "feat(marketplace): thread versions[] to the web available API + CardEntry (SP-B)"
```

---

### Task 3: Version selector on `PackageDetail` (TDD)

**Files:** `apps/web/src/pages/settings/marketplace/PackageDetail.tsx`; Test: `apps/web/src/pages/settings/marketplace/PackageDetail.test.tsx`.

The detail page currently fetches `getAvailableArtifact(entry.ref)`. Make the fetched ref a piece of state seeded from `entry.ref`; a version dropdown (when `entry.versions` has >1) lets the user switch, refetching that version's detail; install targets the selected ref.

- [ ] **Step 1: Failing test**

Add to `PackageDetail.test.tsx` (reuse its existing mocks/render; add a case):
```typescript
it('switches version and installs the selected ref', async () => {
  (api.getAvailableArtifact as any).mockImplementation((ref: string) =>
    Promise.resolve({ ref, id: 'whonet-sqlite', version: ref === 'whonet-narrow' ? '1.0.0' : '1.1.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [], compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0', payload: { kind: 'plugin' }, valid: true }));
  const onInstall = vi.fn();
  const entry = { ref: 'whonet-wide', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [], valid: true, installed: false, versions: [{ version: '1.1.0', ref: 'whonet-wide' }, { version: '1.0.0', ref: 'whonet-narrow' }] };
  render(<MemoryRouter><PackageDetail entry={entry as any} onBack={vi.fn()} onInstall={onInstall} onToggleEnabled={vi.fn()} onRollback={vi.fn()} onRemove={vi.fn()} /></MemoryRouter>);
  // switch to 1.0.0
  fireEvent.click(await screen.findByTestId('version-select'));
  fireEvent.click(await screen.findByText('1.0.0'));
  await waitFor(() => expect(api.getAvailableArtifact).toHaveBeenCalledWith('whonet-narrow'));
  fireEvent.click(await screen.findByTestId('detail-install'));
  expect(onInstall).toHaveBeenCalledWith(expect.objectContaining({ ref: 'whonet-narrow' }), expect.anything());
});
```
(Match the file's existing import style + `@/api` mock; ensure `getAvailableArtifact` is mockable. If `PackageDetail.test.tsx` doesn't exist, create it mirroring `Marketplace.test.tsx`'s mock setup.)

Run: `pnpm -C apps/web test PackageDetail` → FAIL.

- [ ] **Step 2: Implement the selector**

In `PackageDetail.tsx`:
1. Import shadcn `Select`: `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';`
2. Add state: `const [selectedRef, setSelectedRef] = useState(entry.ref);` (seed from the entry's ref). Reset when entry changes: in the existing effect's `setDetail(null)` area, also `setSelectedRef(entry.ref)`.
3. Change the fetch effect to depend on `selectedRef` and fetch it: replace `getAvailableArtifact(entry.ref)` with `getAvailableArtifact(selectedRef)`, and the effect dep `[entry.ref]` → `[selectedRef]`. Keep the `if (!entry.ref) return;` guard as `if (!selectedRef) return;`.
4. Build the install entry from the selected version so install targets it. Where `onInstall(entry, capabilities)` is called, pass a ref-overridden entry: `onInstall({ ...entry, ref: selectedRef, version: detail?.version ?? entry.version }, capabilities)`.
5. Render the dropdown in the right sidebar "Details" section (only when there's more than one version). After the Version `<dd>` row, add:
```tsx
{entry.versions && entry.versions.length > 1 ? (
  <div className="flex items-center justify-between gap-2">
    <dt className="text-muted-foreground">{t('settings.marketplace.version')}</dt>
    <dd>
      <Select value={selectedRef} onValueChange={setSelectedRef}>
        <SelectTrigger data-testid="version-select" className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {entry.versions.map((v) => <SelectItem key={v.ref} value={v.ref}>{v.version}</SelectItem>)}
        </SelectContent>
      </Select>
    </dd>
  </div>
) : null}
```
(Place it so it doesn't duplicate the static Version row — either replace the static Version `<dd>`'s value with the dropdown when multiple versions exist, or render the dropdown row and hide the static one. Keep the static single-version display when `versions.length <= 1`.)

- [ ] **Step 3: Run tests** — `pnpm -C apps/web test PackageDetail` → PASS (the new case + existing). `pnpm -C apps/web typecheck` → PASS.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/settings/marketplace/PackageDetail.tsx apps/web/src/pages/settings/marketplace/PackageDetail.test.tsx
git commit -m "feat(web): version selector on Marketplace detail (install/view a specific version) (SP-B)"
```

---

### Task 4: Full gate + finish

- [ ] **Step 1: Gate** — `pnpm turbo run typecheck lint test build && pnpm depcruise`. All green (re-run `pnpm -C apps/web test` isolated if the known web parallel flake appears).
- [ ] **Step 2: Finish** — `superpowers:finishing-a-development-branch`: merge `feat/marketplace-vnext-sp-b-versions` → local `main` (ff), NOT pushed, remove branch; re-run gate on main.
- [ ] **Step 3: Memory** — update the marketplace/extensibility umbrella note: SP-B done (Browse collapses by id + detail version selector); duplicate-version-cards bug closed. Next: SP-C.

---

## Self-Review

**Spec coverage (SP-B):** collapse Browse cards by id (latest) — Task 1 (`collapseByLatest`) + local/http wiring; version-switch on detail — Task 3. ✅
**Placeholder scan:** complete code in each step; the "place it so it doesn't duplicate the Version row" note in Task 3.5 is a concrete instruction with the JSX given. No TBD.
**Type consistency:** `versions: { version: string; ref: string }[]` is identical across `RegistryListing` (Task 1), the API response (Task 2), `AvailableArtifact` + `CardEntry` (Task 2), and consumed in Task 3. `collapseByLatest`/`compareSemver` signatures match their tests.
**Scope note (HTTP multi-version):** the HTTP index exposes only `latestVersion` per id, so the version dropdown shows multiple options only for the **local** registry (or once the index format carries a versions list — out of scope for SP-B; the dropdown simply shows one option for HTTP). Documented; not a gap.
