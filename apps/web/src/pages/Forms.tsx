import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileInput, MoreHorizontal, Plus, Upload } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { createForm, deleteForm, formQuestionnaireUrl, listForms, setFormStatus, type FormDefinition, type FormStatus, type FormSummary } from '@/api';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function StatusBadge({ status }: { status: FormStatus }) {
  if (status === 'published') return <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">Published</Badge>;
  if (status === 'archived') return <Badge variant="outline" className="text-muted-foreground">Archived</Badge>;
  return <Badge variant="secondary">Draft</Badge>;
}

function toSummary(form: FormDefinition): FormSummary {
  const sections = (form.schema as { sections?: Array<{ fields?: unknown[] }> } | null)?.sections ?? [];
  const fieldCount = sections.reduce((total, section) => total + (Array.isArray(section.fields) ? section.fields.length : 0), 0);
  return {
    id: form.id,
    name: form.name,
    versionLabel: form.versionLabel,
    status: form.status,
    active: form.active,
    fhirResourceType: form.fhirResourceType,
    fieldCount,
    updatedAt: form.updatedAt,
  };
}

function upsertForm(rows: FormSummary[], form: FormSummary): FormSummary[] {
  const index = rows.findIndex((row) => row.id === form.id);
  if (index === -1) return [...rows, form].sort((a, b) => a.name.localeCompare(b.name));
  const copy = [...rows];
  copy[index] = form;
  return copy;
}

function isImportableSchema(value: unknown): value is { name: string; fhirResourceType?: string | null; versionLabel?: string | null; targetPages?: string[] | null } {
  if (!value || typeof value !== 'object') return false;
  const schema = value as { name?: unknown; sections?: unknown };
  return typeof schema.name === 'string' && Array.isArray(schema.sections);
}

export function Forms() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<FormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [deleting, setDeleting] = useState<FormSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listForms());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? rows.filter((form) => form.name.toLowerCase().includes(q) || (form.fhirResourceType ?? '').toLowerCase().includes(q))
      : rows;
  }, [rows, search]);

  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    setActionError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isImportableSchema(parsed)) {
        setActionError('Import JSON must include a name and sections.');
        return;
      }
      const created = await createForm({
        name: parsed.name,
        versionLabel: parsed.versionLabel ?? null,
        fhirResourceType: parsed.fhirResourceType ?? null,
        targetPages: Array.isArray(parsed.targetPages) ? parsed.targetPages : ['forms'],
        schema: parsed,
      });
      setRows((prev) => upsertForm(prev, toSummary(created)));
      setPage(0);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const changeStatus = async (form: FormSummary, status: FormStatus) => {
    setActionError(null);
    try {
      const updated = await setFormStatus(form.id, status);
      setRows((prev) => upsertForm(prev, toSummary(updated)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setActionError(null);
    try {
      await deleteForm(deleting.id);
      setRows((prev) => prev.filter((row) => row.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <AppShell title="Forms" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search forms or FHIR type"
              className="h-8 w-72 text-xs"
              aria-label="Search forms"
            />
            <div className="flex-1" />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button size="sm" className="h-8 gap-1.5 text-xs" disabled aria-label="New form">
                      <Plus className="h-3.5 w-3.5" />
                      New form
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Form builder coming in a later sub-project</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
              Import form JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Import form JSON"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void importJson(file);
              }}
            />
          </div>
          {actionError ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionError}</div> : null}
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        </div>

        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>FHIR type</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {loading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{search ? 'No forms match.' : 'No forms yet.'}</TableCell></TableRow>
              ) : (
                pageRows.map((form) => (
                  <TableRow key={form.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => navigate(`/forms/${form.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <FileInput className="h-4 w-4 text-muted-foreground" />
                        {form.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      {form.fhirResourceType ? <Badge variant="outline">{form.fhirResourceType}</Badge> : <span className="text-muted-foreground">Custom</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{form.fieldCount}</TableCell>
                    <TableCell className="text-muted-foreground">{form.versionLabel || '-'}</TableCell>
                    <TableCell><StatusBadge status={form.status} /></TableCell>
                    <TableCell>{form.active ? <Badge variant="secondary">Active</Badge> : <span className="text-muted-foreground">Inactive</span>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(form.updatedAt)}</TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${form.name}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/forms/${form.id}`)}>View/Run</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { void changeStatus(form, 'published'); }} disabled={form.status === 'published'}>Publish</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { void changeStatus(form, 'archived'); }} disabled={form.status === 'archived'}>Archive</DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a href={formQuestionnaireUrl(form.id)} download={`${form.name}.questionnaire.json`}>Export</a>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDeleting(form)}>Delete</DropdownMenuItem>
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
          leftSlot={<span className="text-muted-foreground">{filtered.length} forms</span>}
        />

        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => { if (!open) setDeleting(null); }}
          title="Delete form"
          description={deleting ? `Delete ${deleting.name}? This cannot be undone.` : undefined}
          confirmLabel="Delete"
          destructive
          onConfirm={() => { void confirmDelete(); }}
        />
      </div>
    </AppShell>
  );
}
