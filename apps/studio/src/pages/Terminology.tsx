import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Library, MoreHorizontal, ChevronRight } from 'lucide-react';
import { AppShell } from '../shell/AppShell';
import {
  listPublishers,
  listCodingSystems,
  listValueSets,
  getValueSet,
  deletePublisher,
  deleteCodingSystem,
  deleteValueSet,
  duplicateValueSet,
  importTerms,
  importValueSet,
  listOntologyDistributions,
  termsTemplateUrl,
  valueSetExportUrl,
  publisherDeletionImpact,
  systemDeletionImpact,
  uploadTerminologyDistribution,
  getTerminologyIngestJob,
  purgeTerminologyDistribution,
  type Publisher,
  type CodingSystem,
  type Term,
  type ValueSet,
  type ValueSetCatalogImportResult,
  type ValueSetSummary,
  type OntologyDistribution,
  type TerminologyIngestJobView,
} from '../api';
import { TermsTable } from '../terminology/TermsTable';
import { publisherSections } from '../terminology/publisherSections';
import { PublisherDialog } from '../terminology/PublisherDialog';
import { CodingSystemDialog } from '../terminology/CodingSystemDialog';
import { DangerConfirmDialog } from '../terminology/DangerConfirmDialog';
import { TermDialog } from '../terminology/TermDialog';
import { OntologyDistributionDialog } from '../terminology/ontology/OntologyDistributionDialog';
import { OntologyPickerDialog } from '../terminology/ontology/OntologyPickerDialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { StripedEmpty } from '../components/ui/striped-empty';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { TruncatedText } from '../components/ui/truncated-text';
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
import { ValueSetBuilder } from '../terminology/ValueSetBuilder';

// ── helpers ──────────────────────────────────────────────────────────────────

function roleLabel(role: string): string {
  if (role === 'local') return 'Local';
  if (role === 'standard') return 'Standard';
  return 'External';
}

function isLoincSystem(system: CodingSystem | null | undefined): boolean {
  return system?.url === 'http://loinc.org' || system?.systemCode.toUpperCase() === 'LOINC';
}

function isLoincPublisher(publisher: Publisher | null | undefined): boolean {
  return publisher?.name.toUpperCase() === 'LOINC';
}

function isValueSetCatalogImportResult(value: ValueSet | ValueSetCatalogImportResult): value is ValueSetCatalogImportResult {
  return typeof (value as ValueSetCatalogImportResult).imported === 'number';
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
  const [valueSets, setValueSets] = useState<ValueSetSummary[]>([]);
  const [distributions, setDistributions] = useState<Record<string, OntologyDistribution>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── navigation ──────────────────────────────────────────────────────────────
  const [selectedPublisherId, setSelectedPublisherId] = useState('');
  const [selectedSystemId, setSelectedSystemId] = useState('');
  const [paneTab, setPaneTab] = useState<'systems' | 'valuesets'>('systems');
  const [vsSearch, setVsSearch] = useState('');
  const [vsSystem, setVsSystem] = useState('__all__');

  // ── pagination ──────────────────────────────────────────────────────────────
  const [systemPage, setSystemPage] = useState(0);
  const [systemPageSize, setSystemPageSize] = useState(25);

  // ── dialog states ───────────────────────────────────────────────────────────
  const [publisherDialogOpen, setPublisherDialogOpen] = useState(false);
  const [editingPublisher, setEditingPublisher] = useState<Publisher | null>(null);
  const [systemDialogOpen, setSystemDialogOpen] = useState(false);
  const [editingSystem, setEditingSystem] = useState<CodingSystem | null>(null);
  const [browseSystem, setBrowseSystem] = useState<CodingSystem | null>(null);
  const [distDialogSystem, setDistDialogSystem] = useState<CodingSystem | null>(null);
  const [termImportSystem, setTermImportSystem] = useState<CodingSystem | null>(null);
  const [distImportOpen, setDistImportOpen] = useState(false);
  const [distImportSystem, setDistImportSystem] = useState<CodingSystem | null>(null);
  const [importJobs, setImportJobs] = useState<Record<string, TerminologyIngestJobView>>({});
  const importPollRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // ── term dialog state (T12 will mount TermDialog consuming these) ────────────
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);
  const [termDialogOpen, setTermDialogOpen] = useState(false);
  const [termsReloadKey, setTermsReloadKey] = useState(0);
  const [editingValueSet, setEditingValueSet] = useState<ValueSet | null>(null);
  const [valueSetEditorOpen, setValueSetEditorOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const termImportFileRef = useRef<HTMLInputElement>(null);

  // ── danger confirm ──────────────────────────────────────────────────────────
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ── toast ───────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // ── load ────────────────────────────────────────────────────────────────────
  // Stable across renders in practice — only calls module-level API fns + setState.
  const reload = (): Promise<void> =>
    Promise.all([listPublishers(), listCodingSystems(), listValueSets(), listOntologyDistributions()])
      .then(([p, s, v, d]) => {
        setPublishers(p);
        setCodingSystems(s);
        setValueSets(v);
        setDistributions(Object.fromEntries(d.map((dist) => [dist.codingSystemId, dist])));
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e));
      });

  useEffect(() => {
    void reload();
  }, []);

  // Stop polling any in-flight distribution import jobs on unmount.
  useEffect(() => () => {
    Object.values(importPollRef.current).forEach(clearInterval);
  }, []);

  // Default-select the first publisher once data arrives.
  useEffect(() => {
    if (selectedPublisherId === '' && publishers.length > 0) {
      const sections = publisherSections(publishers, codingSystems, valueSets);
      if (sections.length > 0) {
        setSelectedPublisherId(sections[0].publisher.id);
      }
    }
  }, [publishers, codingSystems, valueSets, selectedPublisherId]);

  // Reset drill + page when publisher changes.
  useEffect(() => {
    setSelectedSystemId('');
    setSystemPage(0);
    setPaneTab('systems');
    setVsSearch('');
    setVsSystem('__all__');
    setToast(null);
  }, [selectedPublisherId]);

  // ── derived ─────────────────────────────────────────────────────────────────
  const sections = publisherSections(publishers, codingSystems, valueSets);
  const activeSection = sections.find((s) => s.publisher.id === selectedPublisherId) ?? null;
  const selectedSystem = codingSystems.find((s) => s.id === selectedSystemId) ?? null;
  const loincSystemInSection = activeSection?.systems.find(isLoincSystem) ?? null;
  const activeImportJob = loincSystemInSection ? importJobs[loincSystemInSection.id] : null;
  const pagedSystems = activeSection
    ? activeSection.systems.slice(systemPage * systemPageSize, systemPage * systemPageSize + systemPageSize)
    : [];
  const bothKinds = !!activeSection && activeSection.systems.length > 0 && activeSection.valueSets.length > 0;
  const filteredValueSets = (activeSection?.valueSets ?? []).filter((vs) => {
    if (vsSystem !== '__all__' && vs.primarySystem !== vsSystem) return false;
    const q = vsSearch.trim().toLowerCase();
    if (!q) return true;
    return (vs.title ?? '').toLowerCase().includes(q) || vs.url.toLowerCase().includes(q) || (vs.name ?? '').toLowerCase().includes(q);
  });
  const vsSystemOptions = Array.from(new Set((activeSection?.valueSets ?? []).map((v) => v.primarySystem).filter((s): s is string => !!s)));
  const systemLabel = (url: string): string => codingSystems.find((s) => s.url === url)?.systemCode ?? url.split('/').pop() ?? url;

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

  // ── value-set flows ──────────────────────────────────────────────────────────
  const openValueSet = async (id: string): Promise<void> => {
    try {
      setEditingValueSet(await getValueSet(id));
      setValueSetEditorOpen(true);
    } catch (e: unknown) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleValueSetDuplicate = async (id: string): Promise<void> => {
    try {
      const dup = await duplicateValueSet(id);
      await reload();
      setEditingValueSet(dup);
      setValueSetEditorOpen(true);
    } catch (e: unknown) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleValueSetDelete = (vs: ValueSetSummary): void => {
    setConfirm({
      title: 'Delete value set',
      confirmName: vs.title ?? vs.url,
      confirmLabel: 'Delete',
      summary: <span>Permanently delete &ldquo;{vs.title ?? vs.url}&rdquo;? This cannot be undone.</span>,
      onConfirm: async () => {
        try {
          await deleteValueSet(vs.id);
          setConfirm(null);
          await reload();
          setToast({ kind: 'ok', text: 'Value set deleted.' });
        } catch (e: unknown) {
          setConfirm(null);
          setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
        }
      },
    });
  };

  const handleVsImportFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const saved = await importValueSet(file);
      await reload();
      setToast({
        kind: 'ok',
        text: isValueSetCatalogImportResult(saved)
          ? `Imported ${saved.imported} value set(s); skipped ${saved.skipped}.`
          : `Imported value set "${saved.title ?? saved.url}".`,
      });
    } catch (err: unknown) {
      setToast({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // ── render ───────────────────────────────────────────────────────────────────
  const openTermImport = (system: CodingSystem): void => {
    setTermImportSystem(system);
    termImportFileRef.current?.click();
  };

  const handleTermImportFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    const system = termImportSystem;
    e.target.value = '';
    if (!file || !system) return;
    try {
      const result = await importTerms(system.id, file);
      setTermImportSystem(null);
      setTermsReloadKey((k) => k + 1);
      await reload();
      setToast({ kind: 'ok', text: `Imported ${result.imported} term(s) into ${system.systemName}.` });
    } catch (err: unknown) {
      setTermImportSystem(null);
      setToast({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const openDistImport = (system: CodingSystem | null): void => {
    if (!system) return;
    setDistImportSystem(system);
    setDistImportOpen(true);
  };

  const startPollingImportJob = (codingSystemId: string): void => {
    const existing = importPollRef.current[codingSystemId];
    if (existing) clearInterval(existing);
    const poll = async (): Promise<void> => {
      try {
        const job = await getTerminologyIngestJob(codingSystemId, 'loinc');
        setImportJobs((prev) => ({ ...prev, [codingSystemId]: job }));
        if (job.status === 'ready' || job.status === 'failed') {
          clearInterval(importPollRef.current[codingSystemId]);
          delete importPollRef.current[codingSystemId];
          if (job.status === 'ready') await reload();
        }
      } catch {
        clearInterval(importPollRef.current[codingSystemId]);
        delete importPollRef.current[codingSystemId];
      }
    };
    void poll();
    importPollRef.current[codingSystemId] = setInterval(() => void poll(), 3000);
  };

  const handleDistributionQueued = (_jobId: string): void => {
    setDistImportOpen(false);
    setToast({ kind: 'ok', text: "Import started — you’ll be notified when it completes." });
    if (distImportSystem) startPollingImportJob(distImportSystem.id);
  };

  const handlePurgeDistribution = async (system: CodingSystem | null): Promise<void> => {
    if (!system) return;
    try {
      await purgeTerminologyDistribution(system.id, 'loinc');
      setToast({ kind: 'ok', text: 'Stored distribution deleted.' });
    } catch (e: unknown) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <AppShell title="Terminology" fullBleed>
      <div className="ui-scope flex h-full flex-col">
        <input ref={fileInputRef} data-testid="valueset-import-input" type="file" accept=".json,.json.gz,.gz" className="hidden" onChange={(e) => void handleVsImportFile(e)} />
        <input
          ref={termImportFileRef}
          data-testid="term-import-input"
          type="file"
          accept=".csv,.txt,.tsv,.rrf,.jsonl,.ndjson,.json"
          className="hidden"
          onChange={(e) => void handleTermImportFile(e)}
        />
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
                    <TruncatedText text={p.name} className="min-w-0 flex-1 text-foreground" />
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
              <StripedEmpty className="flex-1">
                Select a publisher to browse its code systems and value sets.
              </StripedEmpty>
            ) : (
              <>
                {/* Breadcrumb */}
                <div className="flex h-9 items-center gap-1 border-b border-border px-3 text-xs text-muted-foreground">
                  <span className="text-foreground">{activeSection.publisher.name}</span>
                  {activeImportJob && (activeImportJob.status === 'queued' || activeImportJob.status === 'running') && (
                    <Badge variant="outline" className="text-[9px] uppercase">
                      {activeImportJob.status === 'queued'
                        ? 'Import queued'
                        : `Importing…${activeImportJob.total ? ` ${activeImportJob.processed}/${activeImportJob.total}` : ''}`}
                    </Badge>
                  )}
                  {selectedSystem && (
                    <>
                      <ChevronRight className="h-3 w-3" />
                      <span className="text-foreground">{selectedSystem.systemCode}</span>
                    </>
                  )}

                  {bothKinds && !selectedSystemId && (
                    <div className="ml-3 inline-flex items-center gap-0.5 rounded-md border border-border p-0.5">
                      <button
                        type="button"
                        onClick={() => setPaneTab('systems')}
                        className={`rounded px-2 py-0.5 text-[11px] ${paneTab === 'systems' ? 'bg-[rgba(70,130,180,0.16)] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        Code systems
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaneTab('valuesets')}
                        className={`rounded px-2 py-0.5 text-[11px] ${paneTab === 'valuesets' ? 'bg-[rgba(70,130,180,0.16)] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        Value sets
                      </button>
                    </div>
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

                      {isLoincPublisher(activeSection.publisher) && !selectedSystem && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={!loincSystemInSection} onClick={() => openDistImport(loincSystemInSection)}>
                            Import distribution...
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={!loincSystemInSection} onClick={() => void handlePurgeDistribution(loincSystemInSection)}>
                            Delete stored distribution
                          </DropdownMenuItem>
                        </>
                      )}

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
                          {/* Ontology items */}
                          <DropdownMenuItem
                            disabled={!selectedSystem || distributions[selectedSystem.id]?.indexStatus !== 'ready'}
                            onClick={() => {
                              if (selectedSystem) setBrowseSystem(selectedSystem);
                            }}
                          >
                            Browse ontology
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!selectedSystem}
                            onClick={() => {
                              if (selectedSystem) setDistDialogSystem(selectedSystem);
                            }}
                          >
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

                      {/* Term sub-menu - acts on the open code system */}
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Term</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {activeSection.publisher.role !== 'external' && (
                            <DropdownMenuItem
                              disabled={!selectedSystem}
                              onClick={() => {
                                if (selectedSystem) {
                                  setEditingTerm(null);
                                  setTermDialogOpen(true);
                                }
                              }}
                            >
                              New
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            disabled={!selectedSystem}
                            onClick={() => {
                              if (selectedSystem) openTermImport(selectedSystem);
                            }}
                          >
                            Import terms...
                          </DropdownMenuItem>
                          {(isLoincSystem(selectedSystem) || (!selectedSystem && isLoincPublisher(activeSection.publisher))) && (
                            <DropdownMenuItem
                              disabled={!(selectedSystem ?? loincSystemInSection)}
                              onClick={() => openDistImport(selectedSystem ?? loincSystemInSection)}
                            >
                              Import distribution...
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem disabled={!selectedSystem} asChild>
                            <a href={selectedSystem ? termsTemplateUrl(selectedSystem.id) : '#'} download>Download template</a>
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>

                      {/* Value set sub-menu */}
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Value set</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingValueSet(null);
                              setValueSetEditorOpen(true);
                            }}
                          >
                            New
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>Import...</DropdownMenuItem>
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
                {!selectedSystemId && activeSection.systems.length === 0 && activeSection.valueSets.length === 0 && (
                  <StripedEmpty className="flex-1 px-6">
                    No code systems or value sets yet. Use the ⋯ menu to add one.
                  </StripedEmpty>
                )}

                {/* Code-systems table */}
                {activeSection.systems.length > 0 && !selectedSystemId && (!bothKinds || paneTab === 'systems') && (
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
                                    <DropdownMenuItem onClick={() => openTermImport(s)}>
                                      Import terms...
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild>
                                      <a href={termsTemplateUrl(s.id)} download>Download terms template</a>
                                    </DropdownMenuItem>
                                    {isLoincSystem(s) && (
                                      <DropdownMenuItem onClick={() => openDistImport(s)}>
                                        Import distribution...
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    {/* Ontology items */}
                                    <DropdownMenuItem
                                      disabled={distributions[s.id]?.indexStatus !== 'ready'}
                                      onClick={() => setBrowseSystem(s)}
                                    >
                                      Browse ontology
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setDistDialogSystem(s)}>
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

                {activeSection.valueSets.length > 0 && !selectedSystemId && (!bothKinds || paneTab === 'valuesets') && (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <Select value={vsSystem} onValueChange={setVsSystem}>
                        <SelectTrigger className="h-8 w-56 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All systems</SelectItem>
                          {vsSystemOptions.map((u) => <SelectItem key={u} value={u}><span className="font-mono text-xs">{systemLabel(u)}</span></SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input value={vsSearch} onChange={(e) => setVsSearch(e.target.value)} placeholder="Search value sets..." className="h-8 max-w-md text-sm" />
                    </div>
                    <div className="flex-1 overflow-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-background">
                          <TableRow>
                            <TableHead className="text-xs uppercase tracking-wide">Title</TableHead>
                            <TableHead className="text-xs uppercase tracking-wide">URL</TableHead>
                            <TableHead className="w-32 text-xs uppercase tracking-wide">System</TableHead>
                            <TableHead className="w-24 text-xs uppercase tracking-wide">Source</TableHead>
                            <TableHead className="w-20 text-right text-xs uppercase tracking-wide">Codes</TableHead>
                            <TableHead className="w-24 text-xs uppercase tracking-wide">Status</TableHead>
                            <TableHead className="w-12" />
                          </TableRow>
                        </TableHeader>
                        <TableBody className="[&_tr:last-child]:border-b">
                          {filteredValueSets.length === 0 ? (
                            <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No value sets found.</TableCell></TableRow>
                          ) : filteredValueSets.map((vs) => (
                            <TableRow key={vs.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => void openValueSet(vs.id)}>
                              <TableCell className="text-foreground">{vs.title ?? vs.name ?? '-'}</TableCell>
                              <TableCell className="font-mono text-[11px] text-muted-foreground">{vs.url}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{vs.primarySystem ? systemLabel(vs.primarySystem) : '-'}</TableCell>
                              <TableCell>{vs.category ? <Badge variant="secondary">{vs.category}</Badge> : <span className="text-muted-foreground">-</span>}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{vs.codeCount}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px] uppercase">{vs.status}</Badge></TableCell>
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => void openValueSet(vs.id)}>{vs.immutable ? 'View' : 'Edit'}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void handleValueSetDuplicate(vs.id)}>Duplicate</DropdownMenuItem>
                                    <DropdownMenuItem asChild><a href={valueSetExportUrl(vs.id)} download>Export</a></DropdownMenuItem>
                                    {!vs.immutable && (<><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleValueSetDelete(vs)}>Delete</DropdownMenuItem></>)}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
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

        <Sheet open={valueSetEditorOpen} onOpenChange={(o) => { if (!o) { setValueSetEditorOpen(false); setEditingValueSet(null); } }}>
          <SheetContent aria-describedby={undefined} className="w-full overflow-y-auto p-0 sm:max-w-2xl">
            <SheetHeader className="border-b border-border px-3 py-2">
              <SheetTitle className="text-sm">{editingValueSet?.title ?? editingValueSet?.url ?? 'New value set'}</SheetTitle>
            </SheetHeader>
            {valueSetEditorOpen && (
              <ValueSetBuilder
                key={editingValueSet?.id ?? 'new'}
                valueSet={editingValueSet}
                systems={codingSystems}
                defaultPublisherId={selectedPublisherId}
                onSaved={() => void reload()}
                onCancel={() => {
                  setValueSetEditorOpen(false);
                  setEditingValueSet(null);
                }}
                onExport={(id) => {
                  window.location.href = valueSetExportUrl(id);
                }}
                onDelete={(id) => {
                  const vs = valueSets.find((v) => v.id === id);
                  if (vs) handleValueSetDelete(vs);
                }}
                onDuplicate={(id) => void handleValueSetDuplicate(id)}
              />
            )}
          </SheetContent>
        </Sheet>

        <OntologyPickerDialog
          open={!!browseSystem}
          onOpenChange={(o) => {
            if (!o) setBrowseSystem(null);
          }}
          codingSystemId={browseSystem?.id ?? ''}
          systemName={browseSystem?.systemName ?? ''}
          ontologyType={browseSystem ? distributions[browseSystem.id]?.ontologyType : undefined}
          mode="browse"
          onPick={() => {}}
          title={browseSystem ? `Browse ${browseSystem.systemName}` : undefined}
        />

        <OntologyDistributionDialog
          open={!!distDialogSystem}
          onOpenChange={(o) => {
            if (!o) setDistDialogSystem(null);
          }}
          codingSystemId={distDialogSystem?.id ?? ''}
          systemName={distDialogSystem?.systemName ?? ''}
          onChanged={() => void reload()}
        />

        <ImportDistributionDialog
          open={distImportOpen}
          onOpenChange={setDistImportOpen}
          codingSystemId={distImportSystem?.id ?? ''}
          systemType="loinc"
          onQueued={(jobId) => handleDistributionQueued(jobId)}
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
            systems={codingSystems}
            distributions={distributions}
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

function ImportDistributionDialog({ open, onOpenChange, codingSystemId, systemType, onQueued }: {
  open: boolean; onOpenChange: (v: boolean) => void; codingSystemId: string; systemType: string; onQueued: (jobId: string) => void;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setFile(null); setVersion(''); setAccepted(false); setBusy(false); setPct(0); setError(null); } }, [open]);
  const canImport = !!file && accepted && !busy;
  const handleImport = async (): Promise<void> => {
    if (!canImport || !file) return;
    setBusy(true); setError(null);
    try {
      const { jobId } = await uploadTerminologyDistribution(codingSystemId, systemType, file, accepted, version.trim() || null, setPct);
      onQueued(jobId);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-full p-0 sm:max-w-lg">
        <div className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">Import distribution</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-muted-foreground">
            Upload an extracted distribution packaged as a .zip. It is stored and imported in the background.
          </DialogDescription>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="distFile">Distribution .zip</Label>
            <Input id="distFile" type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="distVersion">Version (optional)</Label>
            <Input id="distVersion" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2.82" />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="distLicense" checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} />
            <Label htmlFor="distLicense" className="text-xs leading-4">
              I have accepted the license for this distribution.
            </Label>
          </div>
          {busy && <div className="text-xs text-muted-foreground">Uploading… {Math.round(pct * 100)}%</div>}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleImport()} disabled={!canImport}>
            {busy ? 'Uploading…' : 'Upload & import'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
