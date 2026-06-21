# DHIS2 Admin UI — SP-C2 (Tracker Mapping Editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tracker mappings first-class — declare event-source columns, dispatch tracker validation, and turn the SP-C1 mapping editor into a dual-mode (aggregate + tracker) editor.

**Architecture:** Add a static `columns` array to the `EventSource` model + a `GET /api/dhis2/event-sources` route; make the mapping `validate`/PUT bodies a kind-discriminated union and dispatch validation by kind; widen the web api + rewrite `Dhis2MappingEditor` to support both kinds with a kind selector.

**Tech Stack:** TypeScript, Fastify + Vitest + zod, React + react-router + react-i18next + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-21-dhis2-admin-ui-sp-c2-design.md`
**Builds on (now on `main`):** SP-C1 (`Dhis2MappingEditor.tsx`, the mappings CRUD/validate/report-columns/metadata routes, `aggregateDefinition` zod, `api.ts` mappings client, `@openldr/dhis2` server dep), SP-B (metadata cache).

---

## File Structure

- Modify `packages/reporting/src/eventsource-types.ts` — add `columns` to `EventSource`.
- Modify `packages/reporting/src/reports/amr-isolates.ts` (+ create `amr-isolates.test.ts`) — declare columns.
- Modify `packages/bootstrap/src/index.ts` — `ReportingApi.eventSources()`.
- Modify `apps/server/src/dhis2-routes.ts` (+ `dhis2-routes.test.ts`) — `trackerDefinition`, union validate/PUT, validate dispatch, `GET /api/dhis2/event-sources`.
- Modify `apps/web/src/api.ts` — `getDhis2EventSources`, `TrackerMappingDef`, widen save/validate.
- Modify `apps/web/src/pages/Dhis2MappingEditor.tsx` (+ `.test.tsx`) — dual-mode editor.
- Modify `apps/web/src/i18n/index.ts` — tracker + kind keys.

---

## Task 1: EventSource columns + `ReportingApi.eventSources()`

**Files:**
- Modify: `packages/reporting/src/eventsource-types.ts`
- Modify: `packages/reporting/src/reports/amr-isolates.ts`
- Test: `packages/reporting/src/reports/amr-isolates.test.ts`
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/reporting/src/reports/amr-isolates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { amrIsolates } from './amr-isolates';

describe('amr-isolates event source', () => {
  it('declares its output columns', () => {
    expect(amrIsolates.columns.map((c) => c.key)).toEqual(['id', 'facility', 'eventDate', 'antibiotic', 'result']);
    expect(amrIsolates.columns.every((c) => typeof c.label === 'string' && c.label.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/reporting test -- --run amr-isolates.test.ts`
Expected: FAIL — `amrIsolates.columns` is undefined.

- [ ] **Step 3: Add `columns` to the type + the source**

In `packages/reporting/src/eventsource-types.ts`, add the field to `EventSource` (after `name`):

```ts
  columns: { key: string; label: string }[];
```

In `packages/reporting/src/reports/amr-isolates.ts`, add the `columns` property to the `amrIsolates` object (after `name: 'AMR isolates (per AST result)',`):

```ts
  columns: [
    { key: 'id', label: 'Isolate ID' },
    { key: 'facility', label: 'Facility' },
    { key: 'eventDate', label: 'Event date' },
    { key: 'antibiotic', label: 'Antibiotic' },
    { key: 'result', label: 'Result (S/I/R)' },
  ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/reporting test -- --run amr-isolates.test.ts && pnpm --filter @openldr/reporting typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Add `eventSources()` to ReportingApi**

In `packages/bootstrap/src/index.ts`:
- Add `eventSourceCatalog` to the `@openldr/reporting` import (the line importing `getEventSource`):

```ts
import { getReport, reportSummaries, getEventSource, eventSourceCatalog, type ReportResult, type ReportSummary } from '@openldr/reporting';
```

- Add to the `ReportingApi` interface (after `runEventSource(...)`):

```ts
  eventSources(): { id: string; name: string; columns: { key: string; label: string }[] }[];
```

- Add to the `reporting` object literal (after the `list:` line):

```ts
    eventSources: () => eventSourceCatalog().map((s) => ({ id: s.id, name: s.name, columns: s.columns })),
```

- [ ] **Step 6: Typecheck bootstrap**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/reporting/src/eventsource-types.ts packages/reporting/src/reports/amr-isolates.ts packages/reporting/src/reports/amr-isolates.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(reporting): declare EventSource.columns + ReportingApi.eventSources()"
```

---

## Task 2: Server — event-sources route + tracker validate/PUT

**Files:**
- Modify: `apps/server/src/dhis2-routes.ts`
- Test: `apps/server/src/dhis2-routes.test.ts`

- [ ] **Step 1: Extend the test fakes + write failing tests**

In `apps/server/src/dhis2-routes.test.ts`, add `eventSources` to the `reporting` fake in `fakeCtx` (next to `run`/`list`):

```ts
      eventSources: () => [{ id: 'amr-isolates', name: 'AMR isolates', columns: [{ key: 'id', label: 'Isolate ID' }, { key: 'facility', label: 'Facility' }, { key: 'eventDate', label: 'Event date' }, { key: 'antibiotic', label: 'Antibiotic' }, { key: 'result', label: 'Result' }] }],
```

Append these tests:

```ts
describe('dhis2 event-sources + tracker mapping', () => {
  const tracker = {
    kind: 'tracker', id: 't1', name: 'Trk',
    source: { kind: 'event-source', sourceId: 'amr-isolates' },
    program: 'prog1', programStage: 'stage1',
    orgUnitColumn: 'facility', eventDateColumn: 'eventDate', idColumn: 'id',
    dataValues: [{ column: 'result', dataElement: 'de1' }],
  };

  it('GET /event-sources returns sources + columns', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin']);
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/event-sources' })).json();
    expect(body[0].id).toBe('amr-isolates');
    expect(body[0].columns.map((c: { key: string }) => c.key)).toContain('result');
  });

  it('event-sources rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['viewer']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/event-sources' })).statusCode).toBe(403);
  });

  it('validate dispatches tracker vs aggregate', async () => {
    const deps = fakeDeps();
    await deps.metadataCache.save({ dataElements: [{ id: 'de1', name: 'DE' }], orgUnits: [], categoryOptionCombos: [], programs: [{ id: 'prog1', name: 'P' }], programStages: [{ id: 'stage1', name: 'S', program: 'prog1' }] } as never);
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    // valid tracker → no problems
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: tracker })).json().problems).toEqual([]);
    // tracker with unknown program → a problem
    const badProg = { ...tracker, program: 'NOPE' };
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: badProg })).json().problems.length).toBeGreaterThan(0);
    // aggregate still validated by validateMapping
    const agg = { kind: 'aggregate', id: 'm1', name: 'Agg', source: { kind: 'report', reportId: 'test-volume' }, orgUnitColumn: 'month', columns: [{ column: 'count', dataElement: 'de1' }] };
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/mappings/validate', payload: agg })).json().problems).toEqual([]);
  });

  it('PUT accepts a tracker definition', async () => {
    const deps = fakeDeps();
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_admin'], deps);
    const res = await app.inject({ method: 'PUT', url: '/api/dhis2/mappings/t1', payload: { name: 'Trk', definition: tracker } });
    expect(res.statusCode).toBe(200);
    expect((await deps.mappingStore.get('t1'))?.definition).toMatchObject({ kind: 'tracker' });
    // a malformed tracker (missing program) → 400
    const bad = { name: 'Trk', definition: { ...tracker, program: undefined } };
    expect((await app.inject({ method: 'PUT', url: '/api/dhis2/mappings/t1', payload: bad })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: FAIL — event-sources 404; tracker validate/PUT 400.

- [ ] **Step 3: Add the tracker schema, union, dispatch, and route**

In `apps/server/src/dhis2-routes.ts`:
- Extend the import from `@openldr/dhis2` to add `validateTrackerMapping` + `TrackerMapping`:

```ts
import { validateMapping, validateTrackerMapping, type AggregateMapping, type TrackerMapping } from '@openldr/dhis2';
```

- After the `aggregateDefinition` declaration, add the tracker schema + a union, and change `mappingPutInput`:

```ts
const trackerColumn = z.object({ column: z.string().min(1), dataElement: z.string().min(1) });
const trackerDefinition = z.object({
  kind: z.literal('tracker'),
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.object({ kind: z.literal('event-source'), sourceId: z.string().min(1), params: z.record(z.string()).optional() }),
  program: z.string().min(1),
  programStage: z.string().min(1),
  orgUnitColumn: z.string().min(1),
  eventDateColumn: z.string().min(1),
  idColumn: z.string().min(1),
  dataValues: z.array(trackerColumn),
});
const mappingDefinition = z.union([aggregateDefinition, trackerDefinition]);
```

Change the existing `mappingPutInput` line:

```ts
const mappingPutInput = z.object({ name: z.string().min(1), definition: mappingDefinition });
```

- Replace the validate route body to parse the union and dispatch by kind:

```ts
  app.post('/api/dhis2/mappings/validate', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = mappingDefinition.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const cached = await deps.metadataCache.get();
    if (!cached) return { problems: ['no DHIS2 metadata cached — pull metadata from DHIS2 settings first'] };
    const problems = (p.data as { kind?: string }).kind === 'tracker'
      ? validateTrackerMapping(p.data as TrackerMapping, cached.metadata)
      : validateMapping(p.data as AggregateMapping, cached.metadata);
    return { problems };
  });
```

- Add the event-sources route (next to the other GET routes, e.g. after `report-columns`):

```ts
  app.get('/api/dhis2/event-sources', { preHandler: requireRole('lab_admin') }, async () => ctx.reporting.eventSources());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts && pnpm --filter @openldr/server typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/dhis2-routes.ts apps/server/src/dhis2-routes.test.ts
git commit -m "feat(dhis2): event-sources route + tracker validate/PUT (kind union)"
```

---

## Task 3: Web — api client (event-sources + tracker types + widen)

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Add types + functions, widen save/validate**

In `apps/web/src/api.ts`, find the SP-C1 DHIS2 mappings block and:
- Add after the `AggregateMappingDef` interface:

```ts
export interface TrackerColumnMapping { column: string; dataElement: string }
export interface TrackerMappingDef {
  kind: 'tracker';
  id: string;
  name: string;
  source: { kind: 'event-source'; sourceId: string; params?: Record<string, string> };
  program: string;
  programStage: string;
  orgUnitColumn: string;
  eventDateColumn: string;
  idColumn: string;
  dataValues: TrackerColumnMapping[];
}
export type MappingDef = AggregateMappingDef | TrackerMappingDef;
export interface Dhis2EventSource { id: string; name: string; columns: { key: string; label: string }[] }
```

- Change the `saveDhis2Mapping` and `validateDhis2Mapping` signatures to accept the union:

```ts
export async function saveDhis2Mapping(id: string, body: { name: string; definition: MappingDef }): Promise<Dhis2MappingRecord> {
  const r = await authFetch(`/api/dhis2/mappings/${encodeURIComponent(id)}`, jbody(body, 'PUT'));
  if (!r.ok) throw new Error(`save mapping failed: ${r.status}`);
  return r.json();
}
export async function validateDhis2Mapping(def: MappingDef): Promise<string[]> {
  const r = await authFetch('/api/dhis2/mappings/validate', jbody(def, 'POST'));
  if (!r.ok) throw new Error(`validate failed: ${r.status}`);
  return (await r.json()).problems as string[];
}
```

- Add the event-sources getter (after `getDhis2Metadata`):

```ts
export async function getDhis2EventSources(): Promise<Dhis2EventSource[]> {
  const r = await authFetch('/api/dhis2/event-sources');
  if (!r.ok) throw new Error(`event sources failed: ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: clean (the existing editor still passes `AggregateMappingDef`, which is assignable to `MappingDef`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(dhis2): web api event-sources + tracker mapping types"
```

---

## Task 4: Web — dual-mode editor (aggregate + tracker)

**Files:**
- Modify: `apps/web/src/pages/Dhis2MappingEditor.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/pages/Dhis2MappingEditor.test.tsx`

- [ ] **Step 1: Add i18n keys**

In `apps/web/src/i18n/index.ts`, inside the `dhis2.mappings.editor` object (after the existing keys, before its closing `}`), add:

```ts
          kindLabel: 'Mapping type',
          kindAggregate: 'Aggregate',
          kindTracker: 'Tracker',
          tracker: {
            sourceEventSource: 'Source event source',
            pickEventSource: 'Pick an event source…',
            program: 'Program',
            pickProgram: 'Pick a program…',
            programStage: 'Program stage',
            pickStage: 'Pick a stage…',
            orgUnitColumn: 'OrgUnit column',
            eventDateColumn: 'Event date column',
            idColumn: 'ID column',
            pickColumn: 'Pick a column…',
            dataValues: 'Column → dataElement',
            eventColumn: 'Event-source column',
            dataElement: 'DataElement',
            addRow: 'Add row',
            remove: 'Remove',
          },
```

(The `editor.trackerNotice` / `notFound` keys stay; `trackerNotice` becomes unused — leave it, removing it is optional cleanup.)

- [ ] **Step 2: Update the editor test (replace the read-only test, add a tracker test)**

Replace the entire body of `apps/web/src/pages/Dhis2MappingEditor.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    fetchReports: vi.fn(),
    getDhis2Metadata: vi.fn(),
    getReportColumns: vi.fn(),
    getDhis2EventSources: vi.fn(),
    getDhis2Mapping: vi.fn(),
    saveDhis2Mapping: vi.fn(),
    validateDhis2Mapping: vi.fn(),
  };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { fetchReports, getDhis2Metadata, getReportColumns, getDhis2EventSources, saveDhis2Mapping, getDhis2Mapping } from '@/api';
import { Dhis2MappingEditor } from './Dhis2MappingEditor';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dhis2/mappings/new" element={<Dhis2MappingEditor />} />
        <Route path="/dhis2/mappings/:id" element={<Dhis2MappingEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (fetchReports as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'test-volume', name: 'Test Volume', description: '' }]);
  (getDhis2Metadata as ReturnType<typeof vi.fn>).mockResolvedValue({
    dataElements: [{ id: 'de1', name: 'DE One' }], categoryOptionCombos: [{ id: 'coc1', name: 'COC One' }],
    orgUnits: [], programs: [{ id: 'prog1', name: 'Program One' }],
    programStages: [{ id: 'stage1', name: 'Stage One', program: 'prog1' }, { id: 'stageX', name: 'Other', program: 'progOther' }],
    pulledAt: '2026-01-01T00:00:00.000Z',
  });
  (getReportColumns as ReturnType<typeof vi.fn>).mockResolvedValue([{ key: 'month', label: 'Month' }, { key: 'count', label: 'Count' }]);
  (getDhis2EventSources as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 'amr-isolates', name: 'AMR isolates', columns: [{ key: 'id', label: 'Isolate ID' }, { key: 'facility', label: 'Facility' }, { key: 'eventDate', label: 'Event date' }, { key: 'result', label: 'Result' }] },
  ]);
});

describe('DHIS2 mapping editor — aggregate', () => {
  it('builds and saves a new aggregate mapping', async () => {
    (saveDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mapping-x', name: 'My Map', definition: {} });
    renderAt('/dhis2/mappings/new');
    fireEvent.change(await screen.findByTestId('mapping-name'), { target: { value: 'My Map' } });
    fireEvent.change(screen.getByTestId('report-select'), { target: { value: 'test-volume' } });
    await waitFor(() => expect(getReportColumns).toHaveBeenCalledWith('test-volume'));
    fireEvent.change(screen.getByTestId('orgunit-column-select'), { target: { value: 'month' } });
    fireEvent.click(screen.getByTestId('add-column'));
    fireEvent.change(screen.getByTestId('column-key-0'), { target: { value: 'count' } });
    fireEvent.change(screen.getByTestId('column-de-0'), { target: { value: 'de1' } });
    fireEvent.click(screen.getByTestId('save-mapping'));
    await waitFor(() => expect(saveDhis2Mapping).toHaveBeenCalled());
    const [, body] = (saveDhis2Mapping as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.definition.kind).toBe('aggregate');
    expect(body.definition.orgUnitColumn).toBe('month');
    expect(body.definition.columns).toEqual([{ column: 'count', dataElement: 'de1' }]);
  });
});

describe('DHIS2 mapping editor — tracker', () => {
  it('builds and saves a new tracker mapping', async () => {
    (saveDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mapping-y', name: 'Trk', definition: {} });
    renderAt('/dhis2/mappings/new');
    await screen.findByTestId('mapping-name');
    // switch to tracker
    fireEvent.change(screen.getByTestId('kind-select'), { target: { value: 'tracker' } });
    fireEvent.change(screen.getByTestId('mapping-name'), { target: { value: 'Trk' } });
    fireEvent.change(screen.getByTestId('event-source-select'), { target: { value: 'amr-isolates' } });
    fireEvent.change(screen.getByTestId('program-select'), { target: { value: 'prog1' } });
    // program-stage options should be filtered to prog1 (Stage One only)
    const stageSel = screen.getByTestId('program-stage-select');
    expect(stageSel.querySelectorAll('option')).toHaveLength(2); // placeholder + Stage One
    fireEvent.change(stageSel, { target: { value: 'stage1' } });
    fireEvent.change(screen.getByTestId('tracker-orgunit-select'), { target: { value: 'facility' } });
    fireEvent.change(screen.getByTestId('tracker-eventdate-select'), { target: { value: 'eventDate' } });
    fireEvent.change(screen.getByTestId('tracker-id-select'), { target: { value: 'id' } });
    fireEvent.click(screen.getByTestId('add-datavalue'));
    fireEvent.change(screen.getByTestId('dv-col-0'), { target: { value: 'result' } });
    fireEvent.change(screen.getByTestId('dv-de-0'), { target: { value: 'de1' } });
    fireEvent.click(screen.getByTestId('save-mapping'));
    await waitFor(() => expect(saveDhis2Mapping).toHaveBeenCalled());
    const [, body] = (saveDhis2Mapping as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.definition).toMatchObject({
      kind: 'tracker', name: 'Trk', source: { kind: 'event-source', sourceId: 'amr-isolates' },
      program: 'prog1', programStage: 'stage1', orgUnitColumn: 'facility', eventDateColumn: 'eventDate', idColumn: 'id',
      dataValues: [{ column: 'result', dataElement: 'de1' }],
    });
  });

  it('loads the tracker form when editing a tracker mapping', async () => {
    (getDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1', name: 'Trk',
      definition: { kind: 'tracker', id: 't1', name: 'Trk', source: { kind: 'event-source', sourceId: 'amr-isolates' }, program: 'prog1', programStage: 'stage1', orgUnitColumn: 'facility', eventDateColumn: 'eventDate', idColumn: 'id', dataValues: [{ column: 'result', dataElement: 'de1' }] },
    });
    renderAt('/dhis2/mappings/t1');
    // tracker form is shown (program select present), not a read-only notice
    expect(await screen.findByTestId('program-select')).toBeTruthy();
    expect((screen.getByTestId('event-source-select') as HTMLSelectElement).value).toBe('amr-isolates');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run Dhis2MappingEditor.test.tsx`
Expected: FAIL — `kind-select`/tracker testids absent.

- [ ] **Step 4: Rewrite the editor as dual-mode**

Replace the entire contents of `apps/web/src/pages/Dhis2MappingEditor.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchReports, getDhis2Metadata, getReportColumns, getDhis2EventSources, getDhis2Mapping, saveDhis2Mapping, validateDhis2Mapping,
  type ReportSummary, type Dhis2MetadataLists, type ReportColumn2, type Dhis2EventSource,
  type AggregateMappingDef, type AggregateColumnMapping, type TrackerMappingDef, type MappingDef,
} from '@/api';

type Kind = 'aggregate' | 'tracker';
type AggRow = { column: string; dataElement: string; categoryOptionCombo: string };
type TrkRow = { column: string; dataElement: string };
const SELECT = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

export function Dhis2MappingEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === undefined;

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [eventSources, setEventSources] = useState<Dhis2EventSource[]>([]);
  const [meta, setMeta] = useState<Dhis2MetadataLists | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const [kind, setKind] = useState<Kind>('aggregate');
  const [mappingId, setMappingId] = useState('');
  const [name, setName] = useState('');
  const [problems, setProblems] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Aggregate state
  const [reportId, setReportId] = useState('');
  const [reportColumns, setReportColumns] = useState<ReportColumn2[]>([]);
  const [aggOrgUnitColumn, setAggOrgUnitColumn] = useState('');
  const [periodColumn, setPeriodColumn] = useState('');
  const [aggRows, setAggRows] = useState<AggRow[]>([]);

  // Tracker state
  const [sourceId, setSourceId] = useState('');
  const [program, setProgram] = useState('');
  const [programStage, setProgramStage] = useState('');
  const [trkOrgUnitColumn, setTrkOrgUnitColumn] = useState('');
  const [eventDateColumn, setEventDateColumn] = useState('');
  const [idColumn, setIdColumn] = useState('');
  const [trkRows, setTrkRows] = useState<TrkRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [reps, srcs, m] = await Promise.all([fetchReports(), getDhis2EventSources(), getDhis2Metadata()]);
        setReports(reps); setEventSources(srcs); setMeta(m);
        if (isNew) { setMappingId(`mapping-${crypto.randomUUID()}`); return; }
        try {
          const rec = await getDhis2Mapping(id!);
          const d = rec.definition as Record<string, unknown> & {
            kind?: string; source?: { reportId?: string; sourceId?: string };
            orgUnitColumn?: string; periodColumn?: string; columns?: AggregateColumnMapping[];
            program?: string; programStage?: string; eventDateColumn?: string; idColumn?: string; dataValues?: TrkRow[];
          };
          setMappingId(rec.id); setName(rec.name);
          if (d.kind === 'tracker') {
            setKind('tracker');
            setSourceId(d.source?.sourceId ?? '');
            setProgram(d.program ?? '');
            setProgramStage(d.programStage ?? '');
            setTrkOrgUnitColumn(d.orgUnitColumn ?? '');
            setEventDateColumn(d.eventDateColumn ?? '');
            setIdColumn(d.idColumn ?? '');
            setTrkRows((d.dataValues ?? []).map((r) => ({ column: r.column, dataElement: r.dataElement })));
          } else {
            setKind('aggregate');
            setReportId(d.source?.reportId ?? '');
            setAggOrgUnitColumn(d.orgUnitColumn ?? '');
            setPeriodColumn(d.periodColumn ?? '');
            setAggRows((d.columns ?? []).map((c) => ({ column: c.column, dataElement: c.dataElement, categoryOptionCombo: c.categoryOptionCombo ?? '' })));
            if (d.source?.reportId) setReportColumns(await getReportColumns(d.source.reportId).catch(() => []));
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes('404')) setNotFound(true);
          else setError(e instanceof Error ? e.message : String(e));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onReport = useCallback(async (rid: string) => {
    setReportId(rid); setProblems(null);
    if (!rid) { setReportColumns([]); return; }
    try { setReportColumns(await getReportColumns(rid)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setReportColumns([]); }
  }, []);

  const srcColumns = useMemo(() => eventSources.find((s) => s.id === sourceId)?.columns ?? [], [eventSources, sourceId]);
  const stages = useMemo(() => (meta?.programStages ?? []).filter((s) => s.program === program), [meta, program]);
  const metaEmpty = (meta?.dataElements.length ?? 0) === 0;

  const def = useCallback((): MappingDef => {
    if (kind === 'tracker') {
      const d: TrackerMappingDef = {
        kind: 'tracker', id: mappingId, name,
        source: { kind: 'event-source', sourceId },
        program, programStage, orgUnitColumn: trkOrgUnitColumn, eventDateColumn, idColumn,
        dataValues: trkRows.filter((r) => r.column && r.dataElement).map((r) => ({ column: r.column, dataElement: r.dataElement })),
      };
      return d;
    }
    const d: AggregateMappingDef = {
      kind: 'aggregate', id: mappingId, name,
      source: { kind: 'report', reportId },
      orgUnitColumn: aggOrgUnitColumn,
      ...(periodColumn ? { periodColumn } : {}),
      columns: aggRows.filter((r) => r.column && r.dataElement).map((r): AggregateColumnMapping => ({ column: r.column, dataElement: r.dataElement, ...(r.categoryOptionCombo ? { categoryOptionCombo: r.categoryOptionCombo } : {}) })),
    };
    return d;
  }, [kind, mappingId, name, reportId, aggOrgUnitColumn, periodColumn, aggRows, sourceId, program, programStage, trkOrgUnitColumn, eventDateColumn, idColumn, trkRows]);

  const onValidate = useCallback(async () => {
    try { setProblems(await validateDhis2Mapping(def())); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [def]);
  const onSave = useCallback(async () => {
    try { await saveDhis2Mapping(mappingId, { name, definition: def() }); navigate('/dhis2/mappings'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [mappingId, name, def, navigate]);

  if (loading) return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div></AppShell>;
  if (notFound) return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('dhis2.mappings.editor.notFound')}</div></AppShell>;

  return (
    <AppShell title={isNew ? t('dhis2.mappings.editor.newTitle') : t('dhis2.mappings.editor.editTitle')}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-mapping-editor">
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        {metaEmpty ? <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">{t('dhis2.mappings.editor.noMetadata')}</div> : null}

        {isNew ? (
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.mappings.editor.kindLabel')}</span>
            <select data-testid="kind-select" className={SELECT} value={kind} onChange={(e) => { setKind(e.target.value as Kind); setProblems(null); }}>
              <option value="aggregate">{t('dhis2.mappings.editor.kindAggregate')}</option>
              <option value="tracker">{t('dhis2.mappings.editor.kindTracker')}</option>
            </select>
          </label>
        ) : null}

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t('dhis2.mappings.editor.mappingName')}</span>
          <Input data-testid="mapping-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        {kind === 'aggregate' ? (
          <>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{t('dhis2.mappings.editor.sourceReport')}</span>
              <select data-testid="report-select" className={SELECT} value={reportId} onChange={(e) => void onReport(e.target.value)}>
                <option value="">{t('dhis2.mappings.editor.pickReport')}</option>
                {reports.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.orgUnitColumn')}</span>
                <select data-testid="orgunit-column-select" className={SELECT} value={aggOrgUnitColumn} onChange={(e) => setAggOrgUnitColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.pickColumn')}</option>
                  {reportColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.periodColumn')}</span>
                <select data-testid="period-column-select" className={SELECT} value={periodColumn} onChange={(e) => setPeriodColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.pickColumn')}</option>
                  {reportColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('dhis2.mappings.editor.columns')}</span>
                <Button variant="outline" size="sm" data-testid="add-column" onClick={() => setAggRows((r) => [...r, { column: '', dataElement: '', categoryOptionCombo: '' }])}>{t('dhis2.mappings.editor.addColumn')}</Button>
              </div>
              {aggRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2" data-testid={`column-row-${i}`}>
                  <select data-testid={`column-key-${i}`} className={SELECT} value={row.column} onChange={(e) => setAggRows((r) => r.map((x, j) => j === i ? { ...x, column: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.reportColumn')}</option>
                    {reportColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <select data-testid={`column-de-${i}`} className={SELECT} disabled={metaEmpty} value={row.dataElement} onChange={(e) => setAggRows((r) => r.map((x, j) => j === i ? { ...x, dataElement: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.dataElement')}</option>
                    {(meta?.dataElements ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <select data-testid={`column-coc-${i}`} className={SELECT} disabled={metaEmpty} value={row.categoryOptionCombo} onChange={(e) => setAggRows((r) => r.map((x, j) => j === i ? { ...x, categoryOptionCombo: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.coc')}</option>
                    {(meta?.categoryOptionCombos ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => setAggRows((r) => r.filter((_, j) => j !== i))}>{t('dhis2.mappings.editor.remove')}</Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.sourceEventSource')}</span>
              <select data-testid="event-source-select" className={SELECT} value={sourceId} onChange={(e) => { setSourceId(e.target.value); setProblems(null); }}>
                <option value="">{t('dhis2.mappings.editor.tracker.pickEventSource')}</option>
                {eventSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.program')}</span>
                <select data-testid="program-select" className={SELECT} disabled={metaEmpty} value={program} onChange={(e) => { setProgram(e.target.value); setProgramStage(''); }}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickProgram')}</option>
                  {(meta?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.programStage')}</span>
                <select data-testid="program-stage-select" className={SELECT} disabled={metaEmpty || !program} value={programStage} onChange={(e) => setProgramStage(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickStage')}</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.orgUnitColumn')}</span>
                <select data-testid="tracker-orgunit-select" className={SELECT} value={trkOrgUnitColumn} onChange={(e) => setTrkOrgUnitColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickColumn')}</option>
                  {srcColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.eventDateColumn')}</span>
                <select data-testid="tracker-eventdate-select" className={SELECT} value={eventDateColumn} onChange={(e) => setEventDateColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickColumn')}</option>
                  {srcColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.idColumn')}</span>
                <select data-testid="tracker-id-select" className={SELECT} value={idColumn} onChange={(e) => setIdColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickColumn')}</option>
                  {srcColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('dhis2.mappings.editor.tracker.dataValues')}</span>
                <Button variant="outline" size="sm" data-testid="add-datavalue" onClick={() => setTrkRows((r) => [...r, { column: '', dataElement: '' }])}>{t('dhis2.mappings.editor.tracker.addRow')}</Button>
              </div>
              {trkRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2" data-testid={`dv-row-${i}`}>
                  <select data-testid={`dv-col-${i}`} className={SELECT} value={row.column} onChange={(e) => setTrkRows((r) => r.map((x, j) => j === i ? { ...x, column: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.tracker.eventColumn')}</option>
                    {srcColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <select data-testid={`dv-de-${i}`} className={SELECT} disabled={metaEmpty} value={row.dataElement} onChange={(e) => setTrkRows((r) => r.map((x, j) => j === i ? { ...x, dataElement: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.tracker.dataElement')}</option>
                    {(meta?.dataElements ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => setTrkRows((r) => r.filter((_, j) => j !== i))}>{t('dhis2.mappings.editor.tracker.remove')}</Button>
                </div>
              ))}
            </div>
          </>
        )}

        {problems !== null ? (
          <div className="rounded-md border border-border px-3 py-2 text-sm" data-testid="validate-problems">
            {problems.length === 0 ? t('dhis2.mappings.editor.noProblems') : <ul className="list-disc pl-5 text-destructive">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button variant="outline" data-testid="validate-mapping" onClick={() => void onValidate()}>{t('dhis2.mappings.editor.validate')}</Button>
          <Button data-testid="save-mapping" onClick={() => void onSave()}>{t('dhis2.mappings.editor.save')}</Button>
          <Button variant="ghost" onClick={() => navigate('/dhis2/mappings')}>{t('dhis2.mappings.editor.cancel')}</Button>
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: Run the editor test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run Dhis2MappingEditor.test.tsx && pnpm --filter @openldr/web typecheck`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/Dhis2MappingEditor.tsx apps/web/src/pages/Dhis2MappingEditor.test.tsx apps/web/src/i18n/index.ts
git commit -m "feat(dhis2): dual-mode mapping editor (aggregate + tracker)"
```

---

## Task 5: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo typecheck lint test build && pnpm depcruise`
Expected: all green. (If a `@openldr/*#typecheck`/`#build`/`#test` task fails once under full-parallel turbo, re-run — this repo has a known `@openldr/dashboards` dist read-during-write race; a direct `pnpm --filter <pkg> <task>` confirms the real state.)

- [ ] **Step 2: Fix any real failures minimally and re-run.** Do not proceed until green.

- [ ] **Step 3: Commit any gate fixups (if needed)**

```bash
git add -A
git commit -m "chore(dhis2): gate fixups for SP-C2"
```

---

## Notes / Out of Scope

- SP-D (operations: dry-run/push/history/schedule); editable `source.params`; additional event sources; live DHIS2 acceptance (tests use fakes).
- The SP-C1 `editor.trackerNotice` i18n key becomes unused (harmless; optional cleanup).
