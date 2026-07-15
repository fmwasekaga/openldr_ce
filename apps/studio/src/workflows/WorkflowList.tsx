import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { fetchWorkflows, createWorkflow, deleteWorkflow, type Workflow } from '@/api';

function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function isImportable(value: unknown): value is { name: string; description?: string | null; enabled?: boolean; definition: { nodes: unknown[]; edges: unknown[] } } {
  if (!value || typeof value !== 'object') return false;
  const v = value as { name?: unknown; definition?: unknown };
  if (typeof v.name !== 'string') return false;
  const def = v.definition as { nodes?: unknown; edges?: unknown } | undefined;
  return !!def && Array.isArray(def.nodes) && Array.isArray(def.edges);
}

export function WorkflowList() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchWorkflows()); }
    catch (e) { toast.error(`Failed to load workflows: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((w) => w.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    setActionError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isImportable(parsed)) {
        setActionError('Import JSON must include a name and a definition with nodes/edges arrays.');
        return;
      }
      await createWorkflow({
        id: newWorkflowId(),
        name: parsed.name,
        description: parsed.description ?? null,
        definition: parsed.definition,
        enabled: parsed.enabled ?? true,
        createdBy: null,
      });
      await load();
      setPage(0);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const exportWorkflow = (w: Workflow) => {
    const json = JSON.stringify({ name: w.name, description: w.description, definition: w.definition, enabled: w.enabled }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${w.name}.workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onDuplicate = useCallback(async (w: Workflow) => {
    try {
      await createWorkflow({
        id: newWorkflowId(), name: `${w.name} (copy)`, description: w.description,
        definition: w.definition, enabled: w.enabled, createdBy: null,
      });
      toast.success(`Duplicated ${w.name}`);
      await load();
    } catch (e) { toast.error(`Duplicate failed: ${e instanceof Error ? e.message : String(e)}`); }
  }, [load]);

  const onDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const w = pendingDelete; setPendingDelete(null);
    try { await deleteWorkflow(w.id); await load(); }
    catch (e) { toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`); }
  }, [pendingDelete, load]);

  return (
    <AppShell title="Workflows" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="workflow-list">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search workflows"
              className="h-8 w-72 text-xs"
              aria-label="Search workflows"
            />
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" aria-label="Workflow actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="workflow-new" onClick={() => navigate('/workflows/new')}>New</DropdownMenuItem>
                <DropdownMenuItem data-testid="workflow-import" onClick={() => fileRef.current?.click()}>Import</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Import workflow JSON"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void importJson(file);
              }}
            />
          </div>
          {actionError ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionError}</div> : null}
        </div>

        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {loading ? (
                <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="p-0"><LoadingState className="min-h-[16rem]" label="Loading…" /></TableCell></TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="p-0"><StripedEmpty className="min-h-[16rem]">{search ? 'No workflows match.' : 'No workflows yet.'}</StripedEmpty></TableCell></TableRow>
              ) : (
                pageRows.map((w) => (
                  <TableRow key={w.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => navigate(`/workflows/${w.id}`)}>
                    <TableCell>
                      <span className="font-medium" data-testid={`open-${w.id}`}>{w.name}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={w.enabled ? 'default' : 'outline'}>{w.enabled ? 'Enabled' : 'Disabled'}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(w.updatedAt)}</TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${w.name}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/workflows/${w.id}`)}>Open</DropdownMenuItem>
                          <DropdownMenuItem data-testid={`duplicate-${w.id}`} onClick={() => { void onDuplicate(w); }}>Duplicate</DropdownMenuItem>
                          <DropdownMenuItem data-testid={`export-${w.id}`} onClick={() => exportWorkflow(w)}>Export</DropdownMenuItem>
                          <DropdownMenuItem data-testid={`delete-${w.id}`} onClick={() => setPendingDelete(w)}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <TablePagination
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          leftSlot={<span className="text-muted-foreground">{filtered.length} workflows</span>}
        />

        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
          title={`Delete ${pendingDelete?.name ?? ''}?`}
          description="This permanently deletes the workflow design."
          confirmLabel="Delete"
          destructive
          onConfirm={() => { void onDelete(); }}
        />
      </div>
    </AppShell>
  );
}
