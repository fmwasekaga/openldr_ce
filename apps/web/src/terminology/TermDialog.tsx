import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { CodingSystem, Term, TermInput, TermMapping, TermStatus } from '../api';
import {
  createTerm,
  updateTerm,
  deleteTerm,
  listTermMappings,
  deleteTermMapping,
} from '../api';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { cn } from '../lib/cn';
import { TermMappingDialog } from './TermMappingDialog';

// ── runtime constants ─────────────────────────────────────────────────────────

const TERM_STATUS_VALUES: readonly TermStatus[] = [
  'ACTIVE',
  'DRAFT',
  'DEPRECATED',
  'DISABLED',
] as const;

// ── en.json labels (inlined — no i18n dependency in web) ─────────────────────
// Source: corlix/apps/desktop/src/renderer/i18n/locales/en.json
const L = {
  // terminology.term.*
  editTitle: 'Edit term',
  newTitle: 'New term',
  dialogHint: 'Terms are coded concepts (test, diagnosis, specimen, etc.) belonging to one coding system.',
  tabDetails: 'Details',
  tabMappings: 'Mappings',
  sectionGeneral: 'General',
  sectionLifecycle: 'Lifecycle',
  sectionMetadata: 'Metadata',
  termStatus: 'Status',
  statusOptions: {
    ACTIVE: 'Active',
    DRAFT: 'Draft',
    DEPRECATED: 'Deprecated',
    DISABLED: 'Disabled',
  } as Record<TermStatus, string>,
  replacedBy: 'Replaced by',
  replacedByHint:
    'For deprecated terms, the id of the term that supersedes this one. Consumers of the old code follow this pointer to the new term.',
  metadataLabel: 'Metadata (JSON)',
  metadataHint:
    'Optional JSON blob for system-specific extras. LOINC terms carry component / property / timeAspect / scaleType / methodType / loincSystem here.',
  metadataInvalid: 'Invalid JSON',
  deleteConfirm: (code: string) => `Delete term ${code}?`,
  // terminology.code / name / shortName / class / unit
  code: 'Code',
  name: 'Display name',
  shortName: 'Short name',
  termClass: 'Class',
  unit: 'Unit',
  // terminology.mapping.*
  mappingAdd: 'Add mapping',
  mappingEdit: 'Edit',
  mappingDelete: 'Delete',
  mappingDeleteConfirm: 'Delete this mapping?',
  mappingCountSummary: (forward: number, reverse: number) =>
    `${forward} outgoing, ${reverse} incoming`,
  mappingDirection: 'Dir',
  mappingDirForward: '→',
  mappingDirReverse: '←',
  mappingType: 'Type',
  mappingSystem: 'System',
  mappingCodeDisplay: 'Code & Display',
  mappingEmpty: 'No mappings on this term yet.',
  draftCreatedNotice: (system: string, code: string) =>
    `New DRAFT term added to ${system} for code ${code}. Open the Terms list to enrich or activate it.`,
  // common.*
  save: 'Save',
  saving: 'Saving…',
  create: 'Create',
  cancel: 'Cancel',
  delete: 'Delete',
  cannotBeUndone: 'This action cannot be undone.',
  actions: 'Actions',
  loading: 'Loading…',
  close: 'Close',
} as const;

// ── types ─────────────────────────────────────────────────────────────────────

type Tab = 'details' | 'mappings';

interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

// ── public contract ───────────────────────────────────────────────────────────

export function TermDialog({
  open,
  onOpenChange,
  system,
  term,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  system: CodingSystem;
  term: Term | null;
  onSaved: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const editing = term !== null;

  // ── tab ──────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('details');

  // ── form state ───────────────────────────────────────────────────────────────
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [shortName, setShortName] = useState('');
  const [termClass, setTermClass] = useState('');
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState<TermStatus>('ACTIVE');
  const [replacedBy, setReplacedBy] = useState('');
  const [metadataText, setMetadataText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── confirm dialog ───────────────────────────────────────────────────────────
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // ── mappings state ───────────────────────────────────────────────────────────
  const [outgoing, setOutgoing] = useState<TermMapping[]>([]);
  const [reverse, setReverse] = useState<TermMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);

  // ── T13 state (TermMappingDialog) ────────────────────────────────────────────
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<TermMapping | null>(null);

  // ── seed form on open ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setActiveTab('details');
    setCode(term?.code ?? '');
    setDisplayName(term?.display ?? '');
    setShortName(term?.shortName ?? '');
    setTermClass(term?.class ?? '');
    setUnit(term?.unit ?? '');
    setStatus((term?.status as TermStatus | undefined) ?? 'ACTIVE');
    setReplacedBy(term?.replacedBy ?? '');
    setMetadataText(term?.metadata ? JSON.stringify(term.metadata, null, 2) : '');
    setError(null);
    setDraftNotice(null);
    setOutgoing([]);
    setReverse([]);
    setMappingsLoading(false);
  }, [open, term]);

  // ── load mappings ────────────────────────────────────────────────────────────
  const loadMappings = useCallback(async (): Promise<void> => {
    if (!term || !system.url) { setOutgoing([]); setReverse([]); return; }
    setMappingsLoading(true);
    try {
      const result = await listTermMappings(system.url, term.code);
      setOutgoing(result.outgoing);
      setReverse(result.reverse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMappingsLoading(false);
    }
  }, [term, system.url]);

  useEffect(() => {
    if (open && activeTab === 'mappings' && term) {
      void loadMappings();
    }
  }, [open, activeTab, term, loadMappings]);

  // ── derived ──────────────────────────────────────────────────────────────────
  const canSave = code.trim().length > 0 && displayName.trim().length > 0;
  const totalMappings = outgoing.length + reverse.length;

  // ── save ─────────────────────────────────────────────────────────────────────
  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    // Validate metadata JSON
    let metadata: Record<string, unknown> | null = null;
    if (metadataText.trim()) {
      try {
        const parsed: unknown = JSON.parse(metadataText);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        } else {
          throw new Error('Metadata must be a JSON object');
        }
      } catch (e) {
        setError(`${L.metadataInvalid}: ${(e as Error).message}`);
        setSaving(false);
        return;
      }
    }

    try {
      const input: TermInput = {
        code: code.trim(),
        display: displayName.trim(),
        status,
        shortName: shortName.trim() || null,
        class: termClass.trim() || null,
        unit: unit.trim() || null,
        replacedBy: replacedBy.trim() || null,
        metadata,
      };
      if (editing && term) {
        await updateTerm(system.id, term.code, input);
      } else {
        await createTerm(system.id, input);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── delete term ──────────────────────────────────────────────────────────────
  const handleDelete = (): void => {
    if (!term) return;
    setConfirmState({
      title: L.deleteConfirm(term.code),
      description: L.cannotBeUndone,
      confirmLabel: L.delete,
      onConfirm: () => void performDelete(),
    });
  };

  const performDelete = async (): Promise<void> => {
    if (!term) return;
    setSaving(true);
    try {
      await deleteTerm(system.id, term.code);
      onDeleted();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── delete mapping ────────────────────────────────────────────────────────────
  const handleDeleteMapping = (m: TermMapping): void => {
    setConfirmState({
      title: L.mappingDeleteConfirm,
      description: L.cannotBeUndone,
      confirmLabel: L.delete,
      onConfirm: () => void performDeleteMapping(m),
    });
  };

  const performDeleteMapping = async (m: TermMapping): Promise<void> => {
    try {
      await deleteTermMapping(m.id);
      setOutgoing((prev) => prev.filter((x) => x.id !== m.id));
      setReverse((prev) => prev.filter((x) => x.id !== m.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          {/* Header */}
          <SheetHeader className="border-b border-border px-6 py-4">
            <SheetTitle>
              {editing ? L.editTitle : L.newTitle}
              <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                {system.systemCode}
              </span>
            </SheetTitle>
            <SheetDescription>{L.dialogHint}</SheetDescription>
          </SheetHeader>

          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-border px-4">
            <TabButton
              active={activeTab === 'details'}
              onClick={() => setActiveTab('details')}
            >
              {L.tabDetails}
            </TabButton>
            <TabButton
              active={activeTab === 'mappings'}
              disabled={!editing}
              onClick={() => setActiveTab('mappings')}
            >
              {L.tabMappings}
              {editing && totalMappings > 0 && (
                <Badge variant="secondary" className="ml-2 h-4 px-1.5 text-[10px]">
                  {totalMappings}
                </Badge>
              )}
            </TabButton>
            <div className="flex-1" />

            {/* Shared ⋯ actions menu — pinned to tab row */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={L.actions}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {activeTab === 'details' ? (
                  <>
                    <DropdownMenuItem
                      disabled={saving || !canSave}
                      onClick={() => void handleSave()}
                    >
                      {saving ? L.saving : editing ? L.save : L.create}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onOpenChange(false)}>
                      {L.cancel}
                    </DropdownMenuItem>
                    {editing && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={saving}
                          className="text-destructive focus:text-destructive"
                          onClick={handleDelete}
                        >
                          {L.delete}
                        </DropdownMenuItem>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingMapping(null);
                        setMappingDialogOpen(true);
                      }}
                    >
                      {L.mappingAdd}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onOpenChange(false)}>
                      {L.cancel}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Body */}
          {activeTab === 'details' ? (
            <div className="flex-1 overflow-y-auto px-6">
              {/* General section */}
              <section>
                <h3 className="py-3 text-sm font-medium text-foreground">
                  {L.sectionGeneral}
                </h3>
                <div className="-mx-6 border-b border-border" />
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 py-4">
                  <Label htmlFor="termCode" className="whitespace-nowrap">
                    {L.code}
                  </Label>
                  <Input
                    id="termCode"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="20447-9"
                    className="font-mono"
                    disabled={editing}
                  />

                  <Label htmlFor="termDisplay" className="whitespace-nowrap">
                    {L.name}
                  </Label>
                  <Input
                    id="termDisplay"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="HIV 1 RNA (viral load)"
                  />

                  <Label htmlFor="termShort" className="whitespace-nowrap">
                    {L.shortName}
                  </Label>
                  <Input
                    id="termShort"
                    value={shortName}
                    onChange={(e) => setShortName(e.target.value)}
                    placeholder="HIV VL"
                  />

                  <Label htmlFor="termClass" className="whitespace-nowrap">
                    {L.termClass}
                  </Label>
                  <Input
                    id="termClass"
                    value={termClass}
                    onChange={(e) => setTermClass(e.target.value)}
                    placeholder="MICRO"
                  />

                  <Label htmlFor="termUnit" className="whitespace-nowrap">
                    {L.unit}
                  </Label>
                  <Input
                    id="termUnit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="copies/mL"
                    className="font-mono"
                  />
                </div>
                <div className="-mx-6 border-b border-border" />
              </section>

              {/* Lifecycle section */}
              <section>
                <h3 className="py-3 text-sm font-medium text-foreground">
                  {L.sectionLifecycle}
                </h3>
                <div className="-mx-6 border-b border-border" />
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 py-4">
                  <Label htmlFor="termStatus" className="whitespace-nowrap">{L.termStatus}</Label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as TermStatus)}
                  >
                    <SelectTrigger id="termStatus">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TERM_STATUS_VALUES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {L.statusOptions[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Label htmlFor="replacedBy" className="whitespace-nowrap">
                    {L.replacedBy}
                  </Label>
                  <Input
                    id="replacedBy"
                    value={replacedBy}
                    onChange={(e) => setReplacedBy(e.target.value)}
                    placeholder="term-abc123"
                    disabled={status !== 'DEPRECATED'}
                    className="font-mono"
                  />

                  <p className="col-span-2 text-[11px] text-muted-foreground">
                    {L.replacedByHint}
                  </p>
                </div>
                <div className="-mx-6 border-b border-border" />
              </section>

              {/* Metadata section */}
              <section>
                <h3 className="py-3 text-sm font-medium text-foreground">
                  {L.sectionMetadata}
                </h3>
                <div className="-mx-6 border-b border-border" />
                <div className="space-y-1.5 py-4">
                  <textarea
                    id="termMetadata"
                    aria-label={L.metadataLabel}
                    value={metadataText}
                    onChange={(e) => setMetadataText(e.target.value)}
                    rows={5}
                    spellCheck={false}
                    placeholder='{"component": "HIV 1 RNA"}'
                    className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <p className="text-[11px] text-muted-foreground">{L.metadataHint}</p>
                </div>
                <div className="-mx-6 border-b border-border" />
              </section>

              {error && (
                <div className="my-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>
          ) : (
            <MappingsTabBody
              outgoing={outgoing}
              reverse={reverse}
              loading={mappingsLoading}
              error={error}
              draftNotice={draftNotice}
              onDismissDraftNotice={() => setDraftNotice(null)}
              onEdit={(m) => {
                setEditingMapping(m);
                setMappingDialogOpen(true);
              }}
              onDelete={handleDeleteMapping}
            />
          )}
        </SheetContent>
      </Sheet>

      {term && (
        <TermMappingDialog
          open={mappingDialogOpen}
          onOpenChange={(o) => { setMappingDialogOpen(o); if (!o) setEditingMapping(null); }}
          fromTerm={{ system: system.url ?? '', code: term.code, display: term.display, systemCode: system.systemCode }}
          systems={[system]}
          mapping={editingMapping}
          onSaved={(_m, draftCreated) => {
            void loadMappings();
            if (draftCreated) setDraftNotice('A draft term was created in the target system for the new mapping.');
            setMappingDialogOpen(false);
            setEditingMapping(null);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmState !== null}
        onOpenChange={(o) => { if (!o) setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        description={confirmState?.description ?? ''}
        confirmLabel={confirmState?.confirmLabel ?? L.delete}
        cancelLabel={L.cancel}
        destructive
        onConfirm={() => {
          const action = confirmState?.onConfirm;
          setConfirmState(null);
          action?.();
        }}
      />
    </>
  );
}

// ── TabButton ─────────────────────────────────────────────────────────────────

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative h-10 px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="inline-flex items-center">{children}</span>
    </button>
  );
}

// ── MappingsTabBody ───────────────────────────────────────────────────────────

type MappingRow = TermMapping & { direction: 'forward' | 'reverse' };

function MappingsTabBody({
  outgoing,
  reverse,
  loading,
  error,
  draftNotice,
  onDismissDraftNotice,
  onEdit,
  onDelete,
}: {
  outgoing: TermMapping[];
  reverse: TermMapping[];
  loading: boolean;
  error: string | null;
  draftNotice: string | null;
  onDismissDraftNotice: () => void;
  onEdit: (m: TermMapping) => void;
  onDelete: (m: TermMapping) => void;
}): JSX.Element {
  const allRows = useMemo<MappingRow[]>(
    () => [
      ...outgoing.map((m) => ({ ...m, direction: 'forward' as const })),
      ...reverse.map((m) => ({ ...m, direction: 'reverse' as const })),
    ],
    [outgoing, reverse],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Summary line */}
      <div className="flex items-center border-b border-border px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {L.mappingCountSummary(outgoing.length, reverse.length)}
        </span>
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {draftNotice && (
        <div className="mx-4 mt-2 flex items-start justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-foreground">
          <span>{draftNotice}</span>
          <button
            type="button"
            className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={onDismissDraftNotice}
          >
            {L.close}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {L.loading}
          </div>
        ) : allRows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {L.mappingEmpty}
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-16 text-[10px] uppercase tracking-wide">
                  {L.mappingDirection}
                </TableHead>
                <TableHead className="w-24 text-[10px] uppercase tracking-wide">
                  {L.mappingType}
                </TableHead>
                <TableHead className="w-24 text-[10px] uppercase tracking-wide">
                  {L.mappingSystem}
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide">
                  {L.mappingCodeDisplay}
                </TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {allRows.map((row) => {
                const isReverse = row.direction === 'reverse';
                // Forward: show the target (toSystem/toCode/toDisplay)
                // Reverse: show the source (fromSystem/fromCode) — who pointed at us
                const displaySystem = isReverse ? row.fromSystem : row.toSystem;
                const displayCode = isReverse ? row.fromCode : row.toCode;
                const displayLabel = isReverse ? null : row.toDisplay;
                return (
                  <TableRow key={`${row.direction}-${row.id}`}>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="whitespace-nowrap text-[10px] uppercase"
                      >
                        {isReverse ? L.mappingDirReverse : L.mappingDirForward}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="whitespace-nowrap text-[10px] uppercase"
                      >
                        {row.mapType}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {displaySystem ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-mono text-xs text-primary">
                          {displayCode ?? '—'}
                        </span>
                        {displayLabel != null && (
                          <span className="truncate text-[11px] text-muted-foreground">
                            {displayLabel}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {!isReverse && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(row)}>
                              {L.mappingEdit}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => onDelete(row)}
                            >
                              {L.mappingDelete}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
