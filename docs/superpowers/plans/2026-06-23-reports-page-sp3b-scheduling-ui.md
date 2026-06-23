# Reports Page — SP-3b (Scheduling UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The frontend for report scheduling on the SP-3a backend — a Schedules drawer (list / create / edit / enable-toggle / run-now / delete), a Schedule dialog (frequency + day picker + output format + the report's non-date params), and a "Scheduled Runs" tab in the History drawer with authenticated download — completing the corlix-parity reports page.

**Architecture:** All `apps/web`. New shadcn primitives (`Switch` dep-free, `Tabs` on `@radix-ui/react-tabs`); `api.ts` client helpers hitting the SP-3a routes; a `ScheduleDialog` (modal) spawned from a `ReportSchedulesDrawer` (Sheet); the "Schedules" menu item enabled for `lab_admin`/`lab_manager`; a "Scheduled Runs" tab added to `ReportHistoryDrawer`.

**Tech Stack:** React, react-i18next, shadcn/Radix, `@radix-ui/react-tabs` (new), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-23-reports-page-sp3b-scheduling-ui-design.md`

**Conventions (read before starting):**
- shadcn primitives live in `apps/web/src/components/ui/`; `cn` from `@/lib/cn`. `Badge` variants are `default | secondary | outline` (NO `destructive` — for a failed badge use `variant="outline"` + `className="border-destructive/40 text-destructive"`).
- Component tests use the side-effect `import '@/i18n';` for real `t()`. Scope a single web test with `npx vitest run <path>` from `apps/web` (the `pnpm test -- <file>` passthrough doesn't filter). Web `lint` is a no-op — `tsc --noEmit` is the static gate.
- i18n parity across en/fr/pt is enforced by `apps/web/src/i18n/parity.test.ts` — add new keys to all three.
- Mock `useAuth`: `vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: {...}, loading: false, hasRole: () => true }) }))`.
- SP-3a routes (all live): `GET/POST /api/reports/:id/schedules`, `PATCH/DELETE /api/reports/schedules/:sid`, `POST /api/reports/schedules/:sid/run`, `GET /api/reports/schedule-runs`, `GET /api/reports/schedule-runs/:runId/download`. POST/PATCH/DELETE/run are gated to `lab_admin`/`lab_manager` server-side.
- Gate per task: `npx vitest run <file>` + `pnpm --filter @openldr/web typecheck`. Full gate at the end.

---

## Task 1: `Switch` primitive (dependency-free)

**Files:**
- Create: `apps/web/src/components/ui/switch.tsx`
- Test: `apps/web/src/components/ui/switch.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from './switch';

describe('Switch', () => {
  it('toggles via onCheckedChange and reflects aria-checked', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="enabled" />);
    const sw = screen.getByRole('switch', { name: 'enabled' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `npx vitest run src/components/ui/switch.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (ported from corlix, dependency-free)**

```tsx
import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Minimal accessible toggle switch — no external dependency. */
export function Switch({ checked, onCheckedChange, disabled, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest['aria-label']}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled && 'cursor-not-allowed opacity-50',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-background transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/switch.test.tsx` → PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/switch.tsx apps/web/src/components/ui/switch.test.tsx
git commit -m "feat(web): Switch shadcn primitive (dependency-free toggle)"
```

---

## Task 2: `Tabs` primitive

**Files:**
- Modify: `apps/web/package.json` (add `@radix-ui/react-tabs`)
- Create: `apps/web/src/components/ui/tabs.tsx`
- Test: `apps/web/src/components/ui/tabs.test.tsx`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @openldr/web add @radix-ui/react-tabs`
Confirm it appears under `dependencies` in `apps/web/package.json`.

- [ ] **Step 2: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

describe('Tabs', () => {
  it('switches panels on trigger click', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel-a</TabsContent>
        <TabsContent value="b">panel-b</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('panel-a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByText('panel-b')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/ui/tabs.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement (ported from corlix)**

```tsx
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex h-9 items-center justify-start gap-1 border-b border-border', className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-t-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors',
      'hover:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('flex-1 focus-visible:outline-none', className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/ui/tabs.test.tsx` → PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/tabs.tsx apps/web/src/components/ui/tabs.test.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): Tabs shadcn primitive (@radix-ui/react-tabs)"
```

---

## Task 3: `api.ts` — schedule types + helpers

**Files:**
- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/api.schedules.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, fetchScheduleRuns, downloadScheduleRun } from './api';

afterEach(() => vi.restoreAllMocks());

describe('schedule api', () => {
  it('createSchedule POSTs the body and returns the record', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 's1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createSchedule('amr-resistance', { frequency: 'weekly', dayOfWeek: 1, outputFormat: 'pdf', params: {} })).resolves.toEqual({ id: 's1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/amr-resistance/schedules', expect.objectContaining({ method: 'POST' }));
  });

  it('updateSchedule PATCHes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 's1', enabled: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await updateSchedule('s1', { enabled: false });
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/schedules/s1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('deleteSchedule + runScheduleNow + fetchSchedules + fetchScheduleRuns hit the right urls', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(
      url.includes('schedule-runs') ? JSON.stringify({ runs: [], total: 0 }) : '[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteSchedule('s1');
    await runScheduleNow('s1');
    await fetchSchedules('amr-resistance');
    await expect(fetchScheduleRuns({ reportId: 'amr-resistance', limit: 5 })).resolves.toEqual({ runs: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/schedules/s1', expect.objectContaining({ method: 'DELETE' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/schedules/s1/run', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/amr-resistance/schedules');
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/schedule-runs?reportId=amr-resistance&limit=5');
  });

  it('downloadScheduleRun fetches the blob', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x']), { status: 200 })));
    await expect(downloadScheduleRun('run1')).resolves.toBeUndefined();
  });

  it('mutating helpers reject on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
    await expect(deleteSchedule('s1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api.schedules.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement (append to `apps/web/src/api.ts`)**

```ts
export interface ReportSchedule {
  id: string;
  reportId: string;
  params: Record<string, string>;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  outputFormat: 'csv' | 'xlsx' | 'pdf';
  enabled: boolean;
  lastRunAt: string | null;
  nextDueAt: string | null;
  createdBy: string | null;
}
export interface ReportScheduleRun {
  id: string;
  scheduleId: string;
  reportId: string;
  reportName: string;
  runAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  outputFormat: string;
  objectKey: string | null;
  byteSize: number | null;
  rowCount: number | null;
  status: 'success' | 'failed';
  errorMessage: string | null;
}
export interface ScheduleInput {
  frequency: ReportSchedule['frequency'];
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  outputFormat: ReportSchedule['outputFormat'];
  params?: Record<string, string>;
}

export async function fetchSchedules(reportId: string): Promise<ReportSchedule[]> {
  const res = await authFetch(`/api/reports/${encodeURIComponent(reportId)}/schedules`);
  if (!res.ok) throw new Error(`schedules ${reportId} failed: ${res.status}`);
  return res.json() as Promise<ReportSchedule[]>;
}
export async function createSchedule(reportId: string, body: ScheduleInput): Promise<ReportSchedule> {
  const res = await authFetch(`/api/reports/${encodeURIComponent(reportId)}/schedules`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create schedule failed: ${res.status}`);
  return res.json() as Promise<ReportSchedule>;
}
export async function updateSchedule(sid: string, patch: Partial<ScheduleInput> & { enabled?: boolean }): Promise<ReportSchedule> {
  const res = await authFetch(`/api/reports/schedules/${encodeURIComponent(sid)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update schedule failed: ${res.status}`);
  return res.json() as Promise<ReportSchedule>;
}
export async function deleteSchedule(sid: string): Promise<void> {
  const res = await authFetch(`/api/reports/schedules/${encodeURIComponent(sid)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete schedule failed: ${res.status}`);
}
export async function runScheduleNow(sid: string): Promise<void> {
  const res = await authFetch(`/api/reports/schedules/${encodeURIComponent(sid)}/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`run schedule failed: ${res.status}`);
}
export async function fetchScheduleRuns(
  opts: { reportId?: string; scheduleId?: string; limit?: number; offset?: number } = {},
): Promise<{ runs: ReportScheduleRun[]; total: number }> {
  const qs = new URLSearchParams();
  if (opts.reportId) qs.set('reportId', opts.reportId);
  if (opts.scheduleId) qs.set('scheduleId', opts.scheduleId);
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const q = qs.toString();
  const res = await authFetch(`/api/reports/schedule-runs${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error(`schedule runs failed: ${res.status}`);
  return res.json() as Promise<{ runs: ReportScheduleRun[]; total: number }>;
}
export async function downloadScheduleRun(runId: string): Promise<void> {
  const res = await authFetch(`/api/reports/schedule-runs/${encodeURIComponent(runId)}/download`);
  if (!res.ok) throw new Error(`download schedule run failed: ${res.status}`);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="?([^"]+)"?/.exec(cd);
  const filename = m?.[1] ?? runId;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api.schedules.test.ts` → PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/api.schedules.test.ts
git commit -m "feat(web): schedule api types + CRUD/run-now/runs/download helpers"
```

---

## Task 4: i18n keys (`reports.scheduling.*`)

**Files:** `apps/web/src/i18n/en.ts`, `fr.ts`, `pt.ts`

- [ ] **Step 1: Add the `schedules` block inside the `reports` namespace in en.ts**

```ts
    scheduling: {
      title: 'Schedules',
      new: 'New Schedule',
      frequency: 'Frequency',
      daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly',
      dayOfWeek: 'Day of week', dayOfMonth: 'Day of month',
      outputFormat: 'Output format',
      dateWindowAuto: 'Date window: auto (covers the last period)',
      runNow: 'Run now', edit: 'Edit', delete: 'Delete',
      deleteConfirm: 'Delete this schedule?',
      nextRun: 'Next', lastRun: 'Last',
      empty: 'No schedules yet.',
      saveError: 'Could not save the schedule.',
      loadError: 'Could not load schedules.',
      save: 'Save', cancel: 'Cancel',
      activity: 'Activity', scheduledRuns: 'Scheduled Runs',
      colStatus: 'Status', colPeriod: 'Period',
      statusSuccess: 'OK', statusFailed: 'Failed',
      runsLoadError: 'Could not load scheduled runs.',
      noRuns: 'No scheduled runs yet.',
      download: 'Download',
    },
```

- [ ] **Step 2: Mirror into fr.ts and pt.ts (same key order/nesting)**

French:
```ts
    scheduling: {
      title: 'Planifications', new: 'Nouvelle planification', frequency: 'Fréquence',
      daily: 'Quotidien', weekly: 'Hebdomadaire', monthly: 'Mensuel', quarterly: 'Trimestriel',
      dayOfWeek: 'Jour de la semaine', dayOfMonth: 'Jour du mois', outputFormat: 'Format de sortie',
      dateWindowAuto: 'Période : automatique (période précédente)',
      runNow: 'Exécuter', edit: 'Modifier', delete: 'Supprimer',
      deleteConfirm: 'Supprimer cette planification ?',
      nextRun: 'Prochaine', lastRun: 'Dernière', empty: 'Aucune planification.',
      saveError: 'Impossible d’enregistrer la planification.', loadError: 'Impossible de charger les planifications.',
      save: 'Enregistrer', cancel: 'Annuler', activity: 'Activité', scheduledRuns: 'Exécutions planifiées',
      colStatus: 'Statut', colPeriod: 'Période', statusSuccess: 'OK', statusFailed: 'Échec',
      runsLoadError: 'Impossible de charger les exécutions planifiées.', noRuns: 'Aucune exécution planifiée.',
      download: 'Télécharger',
    },
```

Portuguese:
```ts
    scheduling: {
      title: 'Agendamentos', new: 'Novo agendamento', frequency: 'Frequência',
      daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal', quarterly: 'Trimestral',
      dayOfWeek: 'Dia da semana', dayOfMonth: 'Dia do mês', outputFormat: 'Formato de saída',
      dateWindowAuto: 'Janela de datas: automática (período anterior)',
      runNow: 'Executar', edit: 'Editar', delete: 'Excluir',
      deleteConfirm: 'Excluir este agendamento?',
      nextRun: 'Próxima', lastRun: 'Última', empty: 'Nenhum agendamento.',
      saveError: 'Não foi possível salvar o agendamento.', loadError: 'Não foi possível carregar os agendamentos.',
      save: 'Salvar', cancel: 'Cancelar', activity: 'Atividade', scheduledRuns: 'Execuções agendadas',
      colStatus: 'Status', colPeriod: 'Período', statusSuccess: 'OK', statusFailed: 'Falhou',
      runsLoadError: 'Não foi possível carregar as execuções agendadas.', noRuns: 'Nenhuma execução agendada.',
      download: 'Baixar',
    },
```

- [ ] **Step 3: Run parity**

Run: `npx vitest run src/i18n/parity.test.ts` → PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): i18n keys for report scheduling (en/fr/pt)"
```

---

## Task 5: `ScheduleDialog`

**Files:**
- Create: `apps/web/src/reports/ScheduleDialog.tsx`
- Test: `apps/web/src/reports/ScheduleDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

const createSchedule = vi.fn(async () => ({ id: 's1' }));
vi.mock('../api', () => ({ createSchedule, updateSchedule: vi.fn(async () => ({ id: 's1' })) }));

import { ScheduleDialog } from './ScheduleDialog';
import type { ReportParamMeta } from '../api';

const parameters: ReportParamMeta[] = [
  { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
  { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
];

beforeEach(() => createSchedule.mockClear());

describe('ScheduleDialog', () => {
  it('creates a schedule with the selected frequency + params', async () => {
    const onSaved = vi.fn();
    render(
      <ScheduleDialog open reportId="amr-resistance" parameters={parameters}
        options={{ facility: ['F1'] }} initialParams={{ facility: 'F1' }}
        onClose={() => {}} onSaved={onSaved} />,
    );
    // default frequency is monthly → day-of-month picker visible, no day-of-week
    expect(screen.queryByText(/day of week|jour de la semaine|dia da semana/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save|enregistrer|salvar/i }));
    await waitFor(() => expect(createSchedule).toHaveBeenCalledWith('amr-resistance', expect.objectContaining({
      frequency: 'monthly', outputFormat: expect.any(String), params: { facility: 'F1' },
    })));
    expect(onSaved).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reports/ScheduleDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createSchedule, updateSchedule, type ReportSchedule, type ReportParamMeta, type ScheduleInput } from '../api';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ALL = '__all__';
const WEEKDAYS: { value: string; key: string }[] = [
  { value: '1', key: 'Mon' }, { value: '2', key: 'Tue' }, { value: '3', key: 'Wed' },
  { value: '4', key: 'Thu' }, { value: '5', key: 'Fri' }, { value: '6', key: 'Sat' }, { value: '0', key: 'Sun' },
];

interface Props {
  open: boolean;
  reportId: string;
  parameters: ReportParamMeta[];
  options: Record<string, string[]>;
  initialParams: Record<string, string>;
  existing?: ReportSchedule;
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleDialog({ open, reportId, parameters, options, initialParams, existing, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [frequency, setFrequency] = useState<ScheduleInput['frequency']>(existing?.frequency ?? 'monthly');
  const [dayOfWeek, setDayOfWeek] = useState(String(existing?.dayOfWeek ?? 1));
  const [dayOfMonth, setDayOfMonth] = useState(String(existing?.dayOfMonth ?? 1));
  const [outputFormat, setOutputFormat] = useState<ScheduleInput['outputFormat']>(existing?.outputFormat ?? 'xlsx');
  const [params, setParams] = useState<Record<string, string>>(existing?.params ?? initialParams ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const paramFields = parameters.filter((p) => p.type !== 'daterange');
  const setParam = (id: string, v: string | undefined) => {
    setParams((prev) => {
      const next = { ...prev };
      if (v === undefined || v === '') delete next[id];
      else next[id] = v;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    const body: ScheduleInput = {
      frequency,
      dayOfWeek: frequency === 'weekly' ? Number(dayOfWeek) : null,
      dayOfMonth: frequency === 'monthly' ? Number(dayOfMonth) : null,
      outputFormat,
      params,
    };
    try {
      if (existing) await updateSchedule(existing.id, body);
      else await createSchedule(reportId, body);
      onSaved();
      onClose();
    } catch {
      setError(t('reports.scheduling.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{existing ? t('reports.scheduling.edit') : t('reports.scheduling.new')}</DialogTitle>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase text-muted-foreground">{t('reports.scheduling.frequency')}</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduleInput['frequency'])}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{t('reports.scheduling.daily')}</SelectItem>
                <SelectItem value="weekly">{t('reports.scheduling.weekly')}</SelectItem>
                <SelectItem value="monthly">{t('reports.scheduling.monthly')}</SelectItem>
                <SelectItem value="quarterly">{t('reports.scheduling.quarterly')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {frequency === 'weekly' && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs uppercase text-muted-foreground">{t('reports.scheduling.dayOfWeek')}</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => <SelectItem key={d.value} value={d.value}>{d.key}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {frequency === 'monthly' && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs uppercase text-muted-foreground">{t('reports.scheduling.dayOfMonth')}</Label>
              <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase text-muted-foreground">{t('reports.scheduling.outputFormat')}</Label>
            <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as ScheduleInput['outputFormat'])}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xlsx">XLSX</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {paramFields.map((p) => (
            <div key={p.id} className="flex flex-col gap-1">
              <Label className="text-xs uppercase text-muted-foreground">{p.label}</Label>
              {p.type === 'select' ? (
                <Select
                  value={params[p.id] ?? ALL}
                  onValueChange={(v) => setParam(p.id, v === ALL ? undefined : v)}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('reports.all')}</SelectItem>
                    {(p.optionsKey ? options[p.optionsKey] ?? [] : []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input className="h-9" value={params[p.id] ?? ''} onChange={(e) => setParam(p.id, e.target.value)} placeholder={p.label} />
              )}
            </div>
          ))}

          <p className="text-xs text-muted-foreground">{t('reports.scheduling.dateWindowAuto')}</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('reports.scheduling.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>{t('reports.scheduling.save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

> Verify `DialogContent`/`DialogTitle` are exported from `@/components/ui/dialog` (they are). If `DialogContent` requires a `DialogTitle` child for a11y (Radix warns otherwise), it's already provided.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/reports/ScheduleDialog.test.tsx` → PASS. Then `pnpm --filter @openldr/web typecheck` — clean. (If Radix Select inside a Radix Dialog has portal/pointer quirks under jsdom that break the test's Save click, the Save button is a plain `<Button>` outside the Selects so the click should work; the test only changes nothing and saves defaults.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ScheduleDialog.tsx apps/web/src/reports/ScheduleDialog.test.tsx
git commit -m "feat(web): ScheduleDialog (frequency/day/format + non-date params)"
```

---

## Task 6: `ReportSchedulesDrawer`

**Files:**
- Create: `apps/web/src/reports/ReportSchedulesDrawer.tsx`
- Test: `apps/web/src/reports/ReportSchedulesDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

const fetchSchedules = vi.fn(async () => [
  { id: 's1', reportId: 'amr-resistance', params: {}, frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, outputFormat: 'pdf', enabled: true, lastRunAt: null, nextDueAt: '2026-03-16T06:00:00Z', createdBy: 'u1' },
]);
const updateSchedule = vi.fn(async () => ({}));
const runScheduleNow = vi.fn(async () => {});
const deleteSchedule = vi.fn(async () => {});
vi.mock('../api', () => ({ fetchSchedules, updateSchedule, runScheduleNow, deleteSchedule }));
vi.mock('./ScheduleDialog', () => ({ ScheduleDialog: () => <div>schedule-dialog</div> }));

import { ReportSchedulesDrawer } from './ReportSchedulesDrawer';

beforeEach(() => { fetchSchedules.mockClear(); updateSchedule.mockClear(); runScheduleNow.mockClear(); });

function setup() {
  render(<ReportSchedulesDrawer open reportId="amr-resistance" parameters={[]} options={{}} currentParams={{}} onClose={() => {}} />);
}

describe('ReportSchedulesDrawer', () => {
  it('lists schedules and toggling the switch updates it', async () => {
    setup();
    await screen.findByRole('switch');
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(updateSchedule).toHaveBeenCalledWith('s1', { enabled: false }));
  });

  it('run-now fires runScheduleNow', async () => {
    setup();
    await screen.findByRole('switch');
    fireEvent.click(screen.getByRole('button', { name: /run now|exécuter|executar/i }));
    await waitFor(() => expect(runScheduleNow).toHaveBeenCalledWith('s1'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reports/ReportSchedulesDrawer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Play, Pencil, Trash2 } from 'lucide-react';
import { fetchSchedules, updateSchedule, runScheduleNow, deleteSchedule, type ReportSchedule, type ReportParamMeta } from '../api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ScheduleDialog } from './ScheduleDialog';

interface Props {
  open: boolean;
  reportId: string;
  parameters: ReportParamMeta[];
  options: Record<string, string[]>;
  currentParams: Record<string, string>;
  onClose: () => void;
}

function freqLabel(s: ReportSchedule, t: (k: string) => string): string {
  const f = t(`reports.scheduling.${s.frequency}`);
  if (s.frequency === 'weekly') return `${f} · ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dayOfWeek ?? 1]}`;
  if (s.frequency === 'monthly') return `${f} · ${s.dayOfMonth ?? 1}`;
  return f;
}

export function ReportSchedulesDrawer({ open, reportId, parameters, options, currentParams, onClose }: Props) {
  const { t } = useTranslation();
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(undefined);
    fetchSchedules(reportId)
      .then((s) => { setSchedules(s); setLoading(false); })
      .catch(() => { setError(t('reports.scheduling.loadError')); setLoading(false); });
  }, [reportId, t]);

  useEffect(() => { if (open) reload(); }, [open, reload]);

  const onToggle = async (s: ReportSchedule) => {
    try { await updateSchedule(s.id, { enabled: !s.enabled }); reload(); }
    catch { setError(t('reports.scheduling.saveError')); }
  };
  const onRun = async (s: ReportSchedule) => {
    try { await runScheduleNow(s.id); } catch { setError(t('reports.scheduling.saveError')); }
  };
  const onDelete = async (id: string) => {
    setConfirmId(null);
    try { await deleteSchedule(id); reload(); } catch { setError(t('reports.scheduling.saveError')); }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-[560px] gap-0 p-0">
        <SheetHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3">
          <div>
            <SheetTitle>{t('reports.scheduling.title')}</SheetTitle>
            <SheetDescription>{reportId}</SheetDescription>
          </div>
          <Button size="sm" className="h-8" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1 h-3.5 w-3.5" />{t('reports.scheduling.new')}
          </Button>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {error && <div className="px-2 py-1 text-sm text-destructive">{error}</div>}
          {loading ? (
            <div className="p-2 text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : schedules.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">{t('reports.scheduling.empty')}</div>
          ) : (
            schedules.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{freqLabel(s, t)}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{s.outputFormat}</Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t('reports.scheduling.nextRun')}: {s.nextDueAt ? new Date(s.nextDueAt).toLocaleString() : '—'}
                    {' · '}{t('reports.scheduling.lastRun')}: {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '—'}
                  </div>
                </div>
                <Switch checked={s.enabled} onCheckedChange={() => void onToggle(s)} aria-label={`enabled-${s.id}`} />
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('reports.scheduling.runNow')} title={t('reports.scheduling.runNow')} onClick={() => void onRun(s)}>
                  <Play className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('reports.scheduling.edit')} onClick={() => { setEditing(s); setDialogOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('reports.scheduling.delete')} onClick={() => setConfirmId(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>

      {dialogOpen && (
        <ScheduleDialog
          open={dialogOpen}
          reportId={reportId}
          parameters={parameters}
          options={options}
          initialParams={currentParams}
          existing={editing ?? undefined}
          onClose={() => setDialogOpen(false)}
          onSaved={reload}
        />
      )}
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(o) => { if (!o) setConfirmId(null); }}
        title={t('reports.scheduling.deleteConfirm')}
        onConfirm={() => { if (confirmId) void onDelete(confirmId); }}
      />
    </Sheet>
  );
}
```

> Check `ConfirmDialog`'s exact prop names by reading `@/components/ui/confirm-dialog.tsx` — it has `open`, `onOpenChange`, `onConfirm`, `title`, and possibly `description`/`confirmLabel`. Supply what it requires; if `description` is required, pass `t('reports.scheduling.deleteConfirm')` for it too. If a simpler approach is preferred, a `window.confirm` is acceptable, but the repo has `ConfirmDialog` — prefer it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/reports/ReportSchedulesDrawer.test.tsx` → PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportSchedulesDrawer.tsx apps/web/src/reports/ReportSchedulesDrawer.test.tsx
git commit -m "feat(web): ReportSchedulesDrawer (list/toggle/run-now/edit/delete + dialog)"
```

---

## Task 7: Enable the Schedules item in `ReportActionsMenu`

**Files:**
- Modify: `apps/web/src/reports/ReportActionsMenu.tsx`
- Modify: `apps/web/src/reports/ReportActionsMenu.test.tsx`

- [ ] **Step 1: Update the test**

Replace `apps/web/src/reports/ReportActionsMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ReportActionsMenu } from './ReportActionsMenu';

function openMenu() {
  const trigger = screen.getByRole('button', { name: /actions|more/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('ReportActionsMenu', () => {
  it('fires onOpenHistory when Run History is clicked', async () => {
    const onOpenHistory = vi.fn();
    render(<ReportActionsMenu onOpenHistory={onOpenHistory} onOpenSchedules={() => {}} canManageSchedules />);
    openMenu();
    fireEvent.click(await screen.findByText(/run history|historique|histórico/i));
    expect(onOpenHistory).toHaveBeenCalled();
  });

  it('fires onOpenSchedules when a manager clicks Schedules', async () => {
    const onOpenSchedules = vi.fn();
    render(<ReportActionsMenu onOpenHistory={() => {}} onOpenSchedules={onOpenSchedules} canManageSchedules />);
    openMenu();
    fireEvent.click(await screen.findByText(/schedules|planifications|agendamentos/i));
    expect(onOpenSchedules).toHaveBeenCalled();
  });

  it('keeps Schedules disabled for a non-manager', async () => {
    render(<ReportActionsMenu onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules={false} />);
    openMenu();
    const item = (await screen.findByText(/schedules|planifications|agendamentos/i)).closest('[role="menuitem"]');
    expect(item?.hasAttribute('data-disabled') || item?.getAttribute('aria-disabled') === 'true').toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reports/ReportActionsMenu.test.tsx`
Expected: FAIL — `onOpenSchedules`/`canManageSchedules` not supported.

- [ ] **Step 3: Update the component**

```tsx
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

interface Props {
  onOpenHistory?: () => void;
  onOpenSchedules?: () => void;
  canManageSchedules?: boolean;
}

/** SP-3b: Run History (SP-2) and Schedules (manager-only) are live. */
export function ReportActionsMenu({ onOpenHistory, onOpenSchedules, canManageSchedules }: Props) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onOpenHistory?.()}>
          {t('reports.runHistory')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canManageSchedules}
          title={canManageSchedules ? undefined : t('reports.comingSoon')}
          onSelect={() => { if (canManageSchedules) onOpenSchedules?.(); }}
        >
          {t('reports.schedules')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

> `t('reports.schedules')` is the existing menu-label key (a STRING, from SP-1). The new schedule strings live under a SEPARATE object block `reports.scheduling.*` (Task 4) precisely because i18next cannot have both a string `reports.schedules` and an object `reports.schedules.*`. This plan already uses `reports.scheduling.*` everywhere for the new strings and keeps `t('reports.schedules')` for the menu label — no collision.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/reports/ReportActionsMenu.test.tsx` → PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportActionsMenu.tsx apps/web/src/reports/ReportActionsMenu.test.tsx
git commit -m "feat(web): enable role-gated Schedules item in ReportActionsMenu"
```

---

## Task 8: "Scheduled Runs" tab in `ReportHistoryDrawer`

**Files:**
- Modify: `apps/web/src/reports/ReportHistoryDrawer.tsx`
- Modify: `apps/web/src/reports/ReportHistoryDrawer.test.tsx`

- [ ] **Step 1: Update the test**

Add a test (keep the existing one). Extend the `../api` mock to include `fetchScheduleRuns` + `downloadScheduleRun`:

```tsx
// in the existing vi.mock('../api', ...) add:
//   fetchScheduleRuns: vi.fn(async () => ({ runs: [{ id: 'run1', scheduleId: 's1', reportId: 'amr-resistance', reportName: 'AMR', runAt: '2026-03-16T06:05:00Z', periodStart: null, periodEnd: null, outputFormat: 'csv', objectKey: 'k', byteSize: 4, rowCount: 1, status: 'success', errorMessage: null }], total: 1 })),
//   downloadScheduleRun: vi.fn(async () => {}),

it('shows scheduled runs in the second tab with a download', async () => {
  const api = await import('../api');
  render(<ReportHistoryDrawer open reportId="amr-resistance" onClose={() => {}} onApplyParams={() => {}} />);
  fireEvent.click(await screen.findByRole('tab', { name: /scheduled runs|exécutions planifiées|execuções agendadas/i }));
  fireEvent.click(await screen.findByRole('button', { name: /download|télécharger|baixar/i }));
  await waitFor(() => expect(api.downloadScheduleRun).toHaveBeenCalledWith('run1'));
});
```

(Ensure `fireEvent`, `waitFor` are imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reports/ReportHistoryDrawer.test.tsx`
Expected: FAIL — no tabs / scheduled runs.

- [ ] **Step 3: Implement**

Rewrite `apps/web/src/reports/ReportHistoryDrawer.tsx` to wrap the body in `Tabs`. Keep the existing Activity table; add a Scheduled Runs panel that lazily loads `fetchScheduleRuns`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { fetchReportRuns, fetchScheduleRuns, downloadScheduleRun, type ReportRun, type ReportScheduleRun } from '../api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface Props {
  open: boolean;
  reportId: string;
  onClose: () => void;
  onApplyParams: (params: Record<string, string>) => void;
}

export function ReportHistoryDrawer({ open, reportId, onClose, onApplyParams }: Props) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('activity');
  const [schedRuns, setSchedRuns] = useState<ReportScheduleRun[]>([]);
  const [schedError, setSchedError] = useState<string>();
  const [schedLoaded, setSchedLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab('activity');
    setSchedLoaded(false);
    let active = true;
    setLoading(true);
    setError(undefined);
    fetchReportRuns({ reportId, limit: 50 })
      .then((res) => { if (active) { setRuns(res.runs); setLoading(false); } })
      .catch(() => { if (active) { setError(t('reports.history.loadError')); setLoading(false); } });
    return () => { active = false; };
  }, [open, reportId, t]);

  // Lazily load scheduled runs the first time that tab is shown.
  useEffect(() => {
    if (tab !== 'scheduled' || schedLoaded) return;
    setSchedLoaded(true);
    setSchedError(undefined);
    fetchScheduleRuns({ reportId, limit: 50 })
      .then((res) => setSchedRuns(res.runs))
      .catch(() => setSchedError(t('reports.scheduling.runsLoadError')));
  }, [tab, schedLoaded, reportId, t]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-[560px] flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('reports.history.title')}</SheetTitle>
          <SheetDescription>{reportId}</SheetDescription>
        </SheetHeader>
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="px-3">
            <TabsTrigger value="activity">{t('reports.scheduling.activity')}</TabsTrigger>
            <TabsTrigger value="scheduled">{t('reports.scheduling.scheduledRuns')}</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="min-h-0 overflow-auto">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
            ) : error ? (
              <div className="p-4 text-sm text-destructive">{error}</div>
            ) : runs.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">{t('reports.history.empty')}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reports.history.colFormat')}</TableHead>
                    <TableHead>{t('reports.history.colRows')}</TableHead>
                    <TableHead>{t('reports.history.colUser')}</TableHead>
                    <TableHead>{t('reports.history.colWhen')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => { onApplyParams(r.params); onClose(); }}>
                      <TableCell><Badge variant="secondary">{r.format}</Badge></TableCell>
                      <TableCell className="tabular-nums">{r.rowCount ?? '—'}</TableCell>
                      <TableCell>{r.userName ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="scheduled" className="min-h-0 overflow-auto">
            {schedError ? (
              <div className="p-4 text-sm text-destructive">{schedError}</div>
            ) : schedRuns.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">{t('reports.scheduling.noRuns')}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reports.history.colFormat')}</TableHead>
                    <TableHead>{t('reports.scheduling.colStatus')}</TableHead>
                    <TableHead>{t('reports.history.colWhen')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedRuns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><Badge variant="secondary">{r.outputFormat}</Badge></TableCell>
                      <TableCell>
                        {r.status === 'success'
                          ? <Badge variant="outline">{t('reports.scheduling.statusSuccess')}</Badge>
                          : <Badge variant="outline" className="border-destructive/40 text-destructive" title={r.errorMessage ?? ''}>{t('reports.scheduling.statusFailed')}</Badge>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(r.runAt).toLocaleString()}</TableCell>
                      <TableCell>
                        {r.objectKey && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void downloadScheduleRun(r.id)}>
                            <Download className="mr-1 h-3.5 w-3.5" />{t('reports.scheduling.download')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/reports/ReportHistoryDrawer.test.tsx` → PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reports/ReportHistoryDrawer.tsx apps/web/src/reports/ReportHistoryDrawer.test.tsx
git commit -m "feat(web): Scheduled Runs tab in ReportHistoryDrawer (download)"
```

---

## Task 9: Wire schedules into `Reports.tsx`

**Files:**
- Modify: `apps/web/src/pages/Reports.tsx`
- Modify: `apps/web/src/pages/Reports.test.tsx`

- [ ] **Step 1: Update the page test**

Extend `apps/web/src/pages/Reports.test.tsx`: add `useAuth` mock (manager) and a test that opening Schedules from the menu mounts the drawer. Add to the top (alongside the existing mocks):

```tsx
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));
vi.mock('../reports/ReportSchedulesDrawer', () => ({
  ReportSchedulesDrawer: ({ open }: { open: boolean }) => (open ? <div>schedules-drawer</div> : null),
}));
```

Add the `../api` mock keys it now needs (the page imports `fetchReports`/`fetchReport`/`fetchReportOptions`/`logReportRun` — already mocked; no new api needed for this test since the drawer is mocked).

Test:
```tsx
it('opens the Schedules drawer for a manager', async () => {
  render(<MemoryRouter><Reports /></MemoryRouter>);
  fireEvent.click(await screen.findByText('AMR Resistance Rate'));
  const trigger = screen.getByRole('button', { name: /actions|more/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByText(/schedules|planifications|agendamentos/i));
  expect(await screen.findByText('schedules-drawer')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/Reports.test.tsx`
Expected: FAIL — schedules not wired.

- [ ] **Step 3: Wire the page**

In `apps/web/src/pages/Reports.tsx`:
- Import the drawer + auth:
```ts
import { ReportSchedulesDrawer } from '../reports/ReportSchedulesDrawer';
import { useAuth } from '@/auth/AuthProvider';
```
- Inside the component, add:
```ts
  const { hasRole } = useAuth();
  const canManageSchedules = hasRole('lab_admin') || hasRole('lab_manager');
  const [schedulesOpen, setSchedulesOpen] = useState(false);
```
- Change the actions menu:
```tsx
                <ReportActionsMenu
                  onOpenHistory={() => setHistoryOpen(true)}
                  onOpenSchedules={() => setSchedulesOpen(true)}
                  canManageSchedules={canManageSchedules}
                />
```
- Add the schedules drawer next to the existing `ReportHistoryDrawer` render (the `{selected && (...)}` block):
```tsx
        {selected && (
          <ReportSchedulesDrawer
            open={schedulesOpen}
            reportId={selected.id}
            parameters={selected.parameters}
            options={options}
            currentParams={params}
            onClose={() => setSchedulesOpen(false)}
          />
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/Reports.test.tsx` → PASS. Then `pnpm --filter @openldr/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Reports.tsx apps/web/src/pages/Reports.test.tsx
git commit -m "feat(web): wire Schedules drawer into the reports page (role-gated)"
```

---

## Task 10: Full gate + memory

- [ ] **Step 1: Full gate**

Run: `pnpm -w turbo typecheck lint test build`
Expected: green. If `@openldr/web#test` flakes (known Dhis2/Terminology parallel flake), re-run `pnpm --filter @openldr/web test` in isolation. Fix any real failures.

- [ ] **Step 2: Depcruise**

Run: `pnpm -w depcruise`
Expected: clean. New web files import only from `@/components/*`, `../api`, `react-i18next`, `lucide-react`, `@radix-ui/react-tabs`.

- [ ] **Step 3: Update memory**

Edit `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\reports-page-workstream.md`: mark **SP-3b (scheduling UI) COMPLETE** — `Switch`(dep-free)+`Tabs`(@radix-ui/react-tabs) primitives, schedule api helpers, `ScheduleDialog`, `ReportSchedulesDrawer`, role-gated "Schedules" menu item, "Scheduled Runs" tab in the history drawer, `Reports.tsx` wiring; note the i18n collision resolution (new block is `reports.scheduling.*`, the menu label stays `reports.schedules`). Mark the **whole reports workstream (SP-1/2/3a/3b + sidebar polish) complete**. Update the matching MEMORY.md line.

- [ ] **Step 4: Commit (if the gate required fixes)**

```bash
git add -A
git commit -m "chore(reports): SP-3b gate green"
```

---

## Self-Review Notes (for the implementer)

- **i18n key collision (resolved in this plan):** `reports.schedules` is already a STRING (the menu label, SP-1), so the new strings use a separate object block **`reports.scheduling.*`** (Task 4 names the block `scheduling: { … }`; Tasks 5/6/8 use `t('reports.scheduling.X')`; Task 7's menu item keeps `t('reports.schedules')`). The plan is already consistent — just don't re-introduce `reports.schedules.*` (object) when implementing Task 4.
- **Spec coverage:** primitives → Tasks 1–2; api → Task 3; i18n → Task 4; dialog → Task 5; drawer → Task 6; menu item → Task 7; scheduled-runs tab → Task 8; page wiring → Task 9; gate → Task 10.
- **Type consistency:** `ReportSchedule`/`ReportScheduleRun`/`ScheduleInput` defined once (Task 3) and consumed by the dialog/drawer/history-tab. `ScheduleDialog` props (`reportId, parameters, options, initialParams, existing, onClose, onSaved`) match how the drawer (Task 6) and page (Task 9) construct it. `ReportActionsMenu` props (`onOpenHistory, onOpenSchedules, canManageSchedules`) match the page (Task 9).
- **`canManageSchedules`:** UI gate is convenience; the SP-3a routes enforce the role server-side too.
- **Verify-before-delete-not-applicable:** no deletions in SP-3b.
