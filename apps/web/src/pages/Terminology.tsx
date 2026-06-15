import { useEffect, useState, type ReactNode } from 'react';
import { Library, MoreHorizontal, ChevronRight } from 'lucide-react';
import { AppShell } from '../shell/AppShell';
import {
  listPublishers,
  listCodingSystems,
  deletePublisher,
  deleteCodingSystem,
  publisherDeletionImpact,
  systemDeletionImpact,
  type Publisher,
  type CodingSystem,
  type Term,
} from '../api';
import { TermsTable } from '../terminology/TermsTable';
import { publisherSections } from '../terminology/publisherSections';
import { PublisherDialog } from '../terminology/PublisherDialog';
import { CodingSystemDialog } from '../terminology/CodingSystemDialog';
import { DangerConfirmDialog } from '../terminology/DangerConfirmDialog';
import { TermDialog } from '../terminology/TermDialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { TablePagination } from '../components/ui/table-pagination';

// ── helpers ──────────────────────────────────────────────────────────────────

function roleLabel(role: string): string {
  if (role === 'local') return 'Local';
  if (role === 'standard') return 'Standard';
  return 'External';
}

// ── confirm-state shape ───────────────────────────────────────────────────────

interface ConfirmState {
  title: string;
  confirmName: string;
  confirmLabel: string;
  summary: ReactNode;
  onConfirm: () => void;
}

// ── component ─────────────────────────────────────────────────────────────────

export function Terminology(): JSX.Element {
  // ── data ────────────────────────────────────────────────────────────────────
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [codingSystems, setCodingSystems] = useState<CodingSystem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── navigation ──────────────────────────────────────────────────────────────
  const [selectedPublisherId, setSelectedPublisherId] = useState('');
  const [selectedSystemId, setSelectedSystemId] = useState('');

  // ── pagination ──────────────────────────────────────────────────────────────
  const [systemPage, setSystemPage] = useState(0);
  const [systemPageSize, setSystemPageSize] = useState(25);

  // ── dialog states ───────────────────────────────────────────────────────────
  const [publisherDialogOpen, setPublisherDialogOpen] = useState(false);
  const [editingPublisher, setEditingPublisher] = useState<Publisher | null>(null);
  const [systemDialogOpen, setSystemDialogOpen] = useState(false);
  const [editingSystem, setEditingSystem] = useState<CodingSystem | null>(null);

  // ── term dialog state (T12 will mount TermDialog consuming these) ────────────
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);
  const [termDialogOpen, setTermDialogOpen] = useState(false);
  const [termsReloadKey, setTermsReloadKey] = useState(0);

  // ── danger confirm ──────────────────────────────────────────────────────────
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ── toast ───────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // ── load ────────────────────────────────────────────────────────────────────
  // Stable across renders in practice — only calls module-level API fns + setState.
  const reload = (): Promise<void> =>
    Promise.all([listPublishers(), listCodingSystems()])
      .then(([p, s]) => {
        setPublishers(p);
        setCodingSystems(s);
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e));
      });

  useEffect(() => {
    void reload();
  }, []);

  // Default-select the first publisher once data arrives.
  useEffect(() => {
    if (selectedPublisherId === '' && publishers.length > 0) {
      const sections = publisherSections(publishers, codingSystems);
      if (sections.length > 0) {
        setSelectedPublisherId(sections[0].publisher.id);
      }
    }
  }, [publishers, codingSystems, selectedPublisherId]);

  // Reset drill + page when publisher changes.
  useEffect(() => {
    setSelectedSystemId('');
    setSystemPage(0);
    setToast(null);
  }, [selectedPublisherId]);

  // ── derived ─────────────────────────────────────────────────────────────────
  const sections = publisherSections(publishers, codingSystems);
  const activeSection = sections.find((s) => s.publisher.id === selectedPublisherId) ?? null;
  const selectedSystem = codingSystems.find((s) => s.id === selectedSystemId) ?? null;
  const pagedSystems = activeSection
    ? activeSection.systems.slice(systemPage * systemPageSize, systemPage * systemPageSize + systemPageSize)
    : [];

  // ── delete flows ─────────────────────────────────────────────────────────────
  const handlePublisherDelete = async (pub: Publisher): Promise<void> => {
    try {
      const impact = await publisherDeletionImpact(pub.id);
      setConfirm({
        title: 'Delete publisher',
        confirmName: pub.name,
        confirmLabel: 'Delete',
        summary: (
          <span>
            Permanently deletes &ldquo;{pub.name}&rdquo; with {impact.systemCount} code system(s) and{' '}
            {impact.termCount} term(s). This action cannot be undone.
          </span>
        ),
        onConfirm: async () => {
          try {
            await deletePublisher(pub.id);
            setConfirm(null);
            setSelectedPublisherId('');
            await reload();
            setToast({ kind: 'ok', text: `Deleted publisher "${pub.name}".` });
          } catch (e: unknown) {
            setConfirm(null);
            setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
          }
        },
      });
    } catch (e: unknown) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleSystemDelete = async (sys: CodingSystem): Promise<void> => {
    try {
      const impact = await systemDeletionImpact(sys.id);
      setConfirm({
        title: 'Delete coding system',
        confirmName: sys.systemCode,
        confirmLabel: 'Delete',
        summary: (
          <span>
            Permanently deletes &ldquo;{sys.systemCode}&rdquo; with {impact.termCount} term(s) and{' '}
            {impact.mappingCount} mapping(s). This action cannot be undone.
          </span>
        ),
        onConfirm: async () => {
          try {
            await deleteCodingSystem(sys.id);
            setConfirm(null);
            setSelectedSystemId('');
            await reload();
            setToast({ kind: 'ok', text: `Deleted coding system ${sys.systemCode}.` });
          } catch (e: unknown) {
            setConfirm(null);
            setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
          }
        },
      });
    } catch (e: unknown) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <AppShell title="Terminology" fullBleed>
      <div className="ui-scope flex h-full flex-col">
        {loadError && (
          <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {loadError}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* ── Publisher rail ──────────────────────────────────────────── */}
          <div className="flex w-60 shrink-0 flex-col border-r border-border">
            {/* Rail header */}
            <div className="flex h-9 items-center border-b border-border px-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Publishers
            </div>

            {/* Publisher list */}
            <div className="flex-1 overflow-auto">
              {sections.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No publishers yet.</p>
              ) : (
                sections.map(({ publisher: p }) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPublisherId(p.id)}
                    className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors hover:bg-[rgba(70,130,180,0.08)] ${
                      selectedPublisherId === p.id
                        ? 'bg-[rgba(70,130,180,0.12)] shadow-[inset_2px_0_0_#4682b4]'
                        : ''
                    }`}
                  >
                    <Library className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-foreground">{p.name}</span>
                    <Badge variant="outline" className="text-[9px] uppercase">
                      {roleLabel(p.role)}
                    </Badge>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* ── Main pane ───────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {!activeSection ? (
              /* No publisher selected */
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Select a publisher to browse its code systems and value sets.
              </div>
            ) : (
              <>
                {/* Breadcrumb */}
                <div className="flex h-9 items-center gap-1 border-b border-border px-3 text-xs text-muted-foreground">
                  <span className="text-foreground">{activeSection.publisher.name}</span>
                  {selectedSystem && (
                    <>
                      <ChevronRight className="h-3 w-3" />
                      <span className="text-foreground">{selectedSystem.systemCode}</span>
                    </>
                  )}

                  <div className="flex-1" />

                  {/* ⋯ kebab menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label="Actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end">
                      {/* Publisher sub-menu */}
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Publisher</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingPublisher(null);
                              setPublisherDialogOpen(true);
                            }}
                          >
                            New
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingPublisher(activeSection.publisher);
                              setPublisherDialogOpen(true);
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                          {!activeSection.publisher.seeded && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => void handlePublisherDelete(activeSection.publisher)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>

                      {/* Code system sub-menu */}
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Code system</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingSystem(null);
                              setSystemDialogOpen(true);
                            }}
                          >
                            New
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!selectedSystem}
                            onClick={() => {
                              if (selectedSystem) {
                                setEditingSystem(selectedSystem);
                                setSystemDialogOpen(true);
                              }
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {/* Ontology items — disabled (SP2+) */}
                          <DropdownMenuItem disabled>
                            Browse ontology
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled>
                            Ontology distribution…
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={!selectedSystem}
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              if (selectedSystem) void handleSystemDelete(selectedSystem);
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Toast strip */}
                {toast && (
                  <div
                    className={
                      toast.kind === 'ok'
                        ? 'mx-3 mt-2 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-400'
                        : 'mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'
                    }
                  >
                    {toast.text}
                  </div>
                )}

                {/* Empty publisher hint */}
                {!selectedSystemId && activeSection.systems.length === 0 && (
                  <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    No code systems or value sets yet. Use the ⋯ menu to add one.
                  </div>
                )}

                {/* Code-systems table */}
                {activeSection.systems.length > 0 && !selectedSystemId && (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex-1 overflow-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-background">
                          <TableRow>
                            <TableHead className="text-xs uppercase tracking-wide">
                              Code
                            </TableHead>
                            <TableHead className="text-xs uppercase tracking-wide">
                              Name
                            </TableHead>
                            <TableHead className="text-xs uppercase tracking-wide">
                              URL
                            </TableHead>
                            <TableHead className="w-12" />
                          </TableRow>
                        </TableHeader>
                        <TableBody className="[&_tr:last-child]:border-b">
                          {pagedSystems.map((s) => (
                            <TableRow
                              key={s.id}
                              className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                              onClick={() => setSelectedSystemId(s.id)}
                            >
                              <TableCell>
                                <span className="font-mono text-xs text-primary">
                                  {s.systemCode}
                                </span>
                              </TableCell>
                              <TableCell className="text-foreground">
                                {s.systemName}
                              </TableCell>
                              <TableCell className="font-mono text-[11px] text-muted-foreground">
                                {s.url ?? '—'}
                              </TableCell>
                              <TableCell
                                onClick={(e) => e.stopPropagation()}
                              >
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      aria-label="Actions"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setEditingSystem(s);
                                        setSystemDialogOpen(true);
                                      }}
                                    >
                                      Edit coding system
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {/* Ontology items — disabled (SP2+) */}
                                    <DropdownMenuItem disabled>
                                      Browse ontology
                                    </DropdownMenuItem>
                                    <DropdownMenuItem disabled>
                                      Ontology distribution…
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => void handleSystemDelete(s)}
                                    >
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <TablePagination
                      page={systemPage}
                      pageSize={systemPageSize}
                      total={activeSection.systems.length}
                      onPageChange={setSystemPage}
                      onPageSizeChange={(n) => {
                        setSystemPageSize(n);
                        setSystemPage(0);
                      }}
                      leftSlot={
                        <span className="text-muted-foreground">
                          {activeSection.systems.length}{' '}
                          {activeSection.systems.length === 1
                            ? 'code system'
                            : 'code systems'}
                        </span>
                      }
                    />
                  </div>
                )}

                {/* Drilled terms pane */}
                {selectedSystemId && (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setSelectedSystemId('')}
                      >
                        ← Code systems
                      </Button>
                    </div>
                    <TermsTable
                      systemId={selectedSystem!.id}
                      reloadKey={termsReloadKey}
                      onOpenTerm={(t) => {
                        setEditingTerm(t);
                        setTermDialogOpen(true);
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Dialogs ──────────────────────────────────────────────────────── */}
        <PublisherDialog
          open={publisherDialogOpen}
          publisher={editingPublisher}
          onOpenChange={setPublisherDialogOpen}
          onSaved={(p) => {
            setPublisherDialogOpen(false);
            void reload().then(() => setSelectedPublisherId(p.id));
          }}
        />

        <CodingSystemDialog
          open={systemDialogOpen}
          system={editingSystem}
          defaultPublisherId={selectedPublisherId}
          onOpenChange={setSystemDialogOpen}
          onSaved={() => {
            setSystemDialogOpen(false);
            void reload();
          }}
        />

        {confirm && (
          <DangerConfirmDialog
            open
            onOpenChange={(o) => {
              if (!o) setConfirm(null);
            }}
            title={confirm.title}
            confirmName={confirm.confirmName}
            confirmLabel={confirm.confirmLabel}
            summary={confirm.summary}
            onConfirm={confirm.onConfirm}
          />
        )}

        {termDialogOpen && selectedSystem && (
          <TermDialog
            open
            system={selectedSystem}
            term={editingTerm}
            onOpenChange={setTermDialogOpen}
            onSaved={() => {
              setTermDialogOpen(false);
              setTermsReloadKey((k) => k + 1);
            }}
            onDeleted={() => {
              setTermDialogOpen(false);
              setTermsReloadKey((k) => k + 1);
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
