import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Copy, Filter, RefreshCw, RotateCcw, X } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { TruncatedText } from '@/components/ui/truncated-text';
import { getAuditEvent, queryAudit, type AuditEvent, type AuditQuery } from '@/api';
import { JsonView } from '@/workflows/components/panels/json-view';

interface AuditFilters {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: AuditFilters = {
  action: '',
  entityType: '',
  entityId: '',
  actorId: '',
  from: '',
  to: '',
};

const FILTER_LABELS: Record<keyof AuditFilters, string> = {
  action: 'Action',
  entityType: 'Entity type',
  entityId: 'Entity ID',
  actorId: 'Actor',
  from: 'From',
  to: 'To',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function toIsoFromLocalInput(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function toAuditParams(filters: AuditFilters): Omit<AuditQuery, 'limit' | 'offset'> {
  const params: Omit<AuditQuery, 'limit' | 'offset'> = {};
  const action = filters.action.trim();
  const entityType = filters.entityType.trim();
  const entityId = filters.entityId.trim();
  const actorId = filters.actorId.trim();
  const from = toIsoFromLocalInput(filters.from);
  const to = toIsoFromLocalInput(filters.to);
  if (action) params.action = action;
  if (entityType) params.entityType = entityType;
  if (entityId) params.entityId = entityId;
  if (actorId) params.actorId = actorId;
  if (from) params.from = from;
  if (to) params.to = to;
  return params;
}

function ActionBadge({ action }: { action: string }) {
  const category = action.split('.')[0];
  const destructive = category === 'tamper' || category === 'delete' || action.endsWith('.delete');
  return (
    <Badge variant={destructive ? 'default' : 'secondary'} className={destructive ? 'border-transparent bg-destructive text-destructive-foreground' : undefined}>
      {action}
    </Badge>
  );
}

function AuditFilterField({
  id,
  label,
  value,
  placeholder,
  type = 'text',
  mono = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'datetime-local';
  mono?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px] uppercase text-muted-foreground">{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`h-8 text-xs ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function AuditFilterPopover({
  draftFilters,
  activeFilterCount,
  setDraftFilters,
  onApply,
}: {
  draftFilters: AuditFilters;
  activeFilterCount: number;
  setDraftFilters: Dispatch<SetStateAction<AuditFilters>>;
  onApply: () => void;
}) {
  const [open, setOpen] = useState(false);
  const apply = () => {
    onApply();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Filter className="h-3.5 w-3.5" />
          Filter
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[640px] p-0">
        <div className="grid gap-3 p-3 md:grid-cols-2">
          <AuditFilterField id="audit-filter-action" label="Action" value={draftFilters.action} placeholder="form.create" mono onChange={(value) => setDraftFilters((f) => ({ ...f, action: value }))} />
          <AuditFilterField id="audit-filter-entity-type" label="Entity type" value={draftFilters.entityType} placeholder="form" mono onChange={(value) => setDraftFilters((f) => ({ ...f, entityType: value }))} />
          <AuditFilterField id="audit-filter-entity-id" label="Entity ID" value={draftFilters.entityId} placeholder="form-1" mono onChange={(value) => setDraftFilters((f) => ({ ...f, entityId: value }))} />
          <AuditFilterField id="audit-filter-actor" label="Actor" value={draftFilters.actorId} placeholder="user id" mono onChange={(value) => setDraftFilters((f) => ({ ...f, actorId: value }))} />
          <div className="grid grid-cols-2 gap-2 md:col-span-2">
            <AuditFilterField id="audit-filter-from" label="From" value={draftFilters.from} type="datetime-local" onChange={(value) => setDraftFilters((f) => ({ ...f, from: value }))} />
            <AuditFilterField id="audit-filter-to" label="To" value={draftFilters.to} type="datetime-local" onChange={(value) => setDraftFilters((f) => ({ ...f, to: value }))} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <Button type="button" size="sm" className="h-7 text-xs" onClick={apply}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AuditFilterChips({ filters, onRemove }: { filters: AuditFilters; onRemove: (key: keyof AuditFilters) => void }) {
  const entries = Object.entries(filters).filter(([, value]) => value.trim() !== '') as Array<[keyof AuditFilters, string]>;
  if (entries.length === 0) return null;
  return (
    <div className="border-t border-border pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map(([key, value]) => (
          <button
            key={key}
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted/30 px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            onClick={() => onRemove(key)}
          >
            <span className="font-medium text-foreground">{FILTER_LABELS[key]}</span>
            <TruncatedText text={value} className="min-w-0 max-w-[14rem]" />
            <X className="h-3 w-3" />
          </button>
        ))}
      </div>
    </div>
  );
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={() => copyText(value)} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string | undefined | null; mono?: boolean }) {
  const text = value && value.trim() ? value : 'None';
  return (
    <div className="grid grid-cols-[8rem_1fr_auto] items-start gap-3 border-b border-border px-4 py-2 last:border-b-0">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className={mono ? 'break-all font-mono text-xs' : 'break-words text-sm'}>{text}</div>
      {value && value.trim() ? <CopyButton value={value} label={label} /> : <div className="h-7 w-7" />}
    </div>
  );
}

function JsonSection({ title, value }: { title: string; value?: unknown }) {
  const hasValue = value != null;
  return (
    <section className="border-t border-border">
      <div className="flex items-center justify-between px-4 py-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      </div>
      <div className="mx-4 mb-4">
        {hasValue ? (
          // Read-only, theme-aware CodeMirror JSON viewer (its own copy button lives
          // top-right). max-h-72 + internal scroller keeps long payloads inside the sheet.
          <JsonView data={value} emptyLabel="None recorded." />
        ) : (
          <p className="text-xs text-muted-foreground">None recorded.</p>
        )}
      </div>
    </section>
  );
}

function AuditEventSheet({ event, onOpenChange }: { event: AuditEvent | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={event !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{event ? event.action : 'Audit event'}</SheetTitle>
          <SheetDescription>
            {event ? `${formatTimestamp(event.occurredAt)} by ${event.actorName}` : 'Audit event details'}
          </SheetDescription>
        </SheetHeader>
        {event ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b border-border">
              <DetailRow label="Event ID" value={event.id} mono />
              <DetailRow label="Timestamp" value={event.occurredAt} mono />
              <DetailRow label="Actor" value={`${event.actorName}${event.actorId ? ` (${event.actorId})` : ''}`} />
              <DetailRow label="Actor type" value={event.actorType} mono />
              <DetailRow label="Action" value={event.action} mono />
              <DetailRow label="Entity type" value={event.entityType} mono />
              <DetailRow label="Entity ID" value={event.entityId} mono />
            </div>
            <JsonSection title="Before" value={event.before} />
            <JsonSection title="After" value={event.after} />
            <JsonSection title="Metadata" value={event.metadata} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function Audit() {
  const [draftFilters, setDraftFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const activeFilterCount = useMemo(() => Object.values(filters).filter((value) => value.trim() !== '').length, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await queryAudit({ ...toAuditParams(filters), limit: pageSize, offset: page * pageSize });
      setEvents(result.events);
      setTotal(result.total);
    } catch (err) {
      setEvents([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  const applyFilters = () => {
    setFilters({ ...draftFilters });
    setPage(0);
  };

  const resetFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(0);
  };

  const removeFilter = (key: keyof AuditFilters) => {
    const next = { ...filters, [key]: '' };
    setFilters(next);
    setDraftFilters(next);
    setPage(0);
  };

  const openEvent = async (event: AuditEvent) => {
    setSelected(event);
    try {
      setSelected(await getAuditEvent(event.id));
    } catch {
      setSelected(event);
    }
  };

  return (
    <AppShell title="Audit" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <form
          className="flex flex-col gap-2 border-b border-border px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <AuditFilterPopover draftFilters={draftFilters} activeFilterCount={activeFilterCount} setDraftFilters={setDraftFilters} onApply={applyFilters} />
            {activeFilterCount > 0 && (
              <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground" onClick={resetFilters}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">Newest events first.</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            </Button>
          </div>
          <AuditFilterChips filters={filters} onRemove={removeFilter} />
          <button type="submit" className="hidden" aria-hidden="true">Apply</button>
        </form>

        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-48 text-xs uppercase">Timestamp</TableHead>
                <TableHead className="w-40 text-xs uppercase">Actor</TableHead>
                <TableHead className="w-48 text-xs uppercase">Action</TableHead>
                <TableHead className="w-36 text-xs uppercase">Entity type</TableHead>
                <TableHead className="text-xs uppercase">Entity ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {loading ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : error ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-destructive">{error}</TableCell></TableRow>
              ) : events.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No audit events.</TableCell></TableRow>
              ) : (
                events.map((event) => (
                  <TableRow key={event.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => { void openEvent(event); }} title="Open audit event details">
                    <TableCell><span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatTimestamp(event.occurredAt)}</span></TableCell>
                    <TableCell className="text-sm">{event.actorName}</TableCell>
                    <TableCell><ActionBadge action={event.action} /></TableCell>
                    <TableCell className="font-mono text-xs">{event.entityType}</TableCell>
                    <TableCell><span className="font-mono text-xs text-muted-foreground">{event.entityId}</span></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          leftSlot={<span className="text-muted-foreground">{total} events</span>}
        />

        <AuditEventSheet event={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} />
      </div>
    </AppShell>
  );
}
