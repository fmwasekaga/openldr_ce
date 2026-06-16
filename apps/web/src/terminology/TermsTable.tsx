import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Upload, Download, Plus } from 'lucide-react';
import {
  searchTerms,
  importTerms,
  termsTemplateUrl,
  deleteTerm,
  type Term,
} from '../api';
import { statusBadgeClass } from './statusBadge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { TablePagination } from '../components/ui/table-pagination';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { ConfirmDialog } from '../components/ui/confirm-dialog';

// ── constants ─────────────────────────────────────────────────────────────────

// Radix Select.Item rejects empty-string values, so we use a sentinel for "All".
const ALL_STATUS = '__all__';

const STATUS_OPTIONS = [
  { value: ALL_STATUS, label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'DEPRECATED', label: 'Deprecated' },
  { value: 'DISABLED', label: 'Disabled' },
] as const;

const DEBOUNCE_MS = 200;

// ── component ─────────────────────────────────────────────────────────────────

export function TermsTable({
  systemId,
  reloadKey,
  onOpenTerm,
}: {
  systemId: string;
  reloadKey?: number;
  onOpenTerm: (term: Term | null) => void;
}): JSX.Element {
  // ── search/filter state ──────────────────────────────────────────────────────
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // ── data state ───────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<Term[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [localReload, setLocalReload] = useState(0);

  // ── delete confirm state ─────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<Term | null>(null);

  // ── action error banner ───────────────────────────────────────────────────────
  const [actionError, setActionError] = useState<string | null>(null);

  // ── import busy state + hidden file input ────────────────────────────────────
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── debounce q ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // ── reset page on filter change ───────────────────────────────────────────────
  useEffect(() => {
    setPage(0);
  }, [debouncedQ, status]);

  // ── fetch ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    searchTerms(systemId, {
      q: debouncedQ || undefined,
      status: status || undefined,
      limit: pageSize,
      offset: page * pageSize,
    })
      .then(({ rows: r, total: t }) => {
        if (!cancelled) {
          setRows(r);
          setTotal(t);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [systemId, debouncedQ, status, page, pageSize, reloadKey, localReload]);

  // ── import handler ────────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // reset so the same file can be selected again
    e.target.value = '';
    setActionError(null);
    setImportBusy(true);
    try {
      await importTerms(systemId, file);
      setActionError(null);
      setLocalReload((n) => n + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
  };

  // ── delete handler ────────────────────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const code = confirmDelete.code;
    setConfirmDelete(null);
    setActionError(null);
    try {
      await deleteTerm(systemId, code);
      setActionError(null);
      setLocalReload((n) => n + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search terms…"
          className="h-8 max-w-md text-sm"
        />

        <Select
          value={status === '' ? ALL_STATUS : status}
          onValueChange={(v) => setStatus(v === ALL_STATUS ? '' : v)}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {/* Hidden file input for source terminology imports */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.tsv,.rrf,.jsonl,.ndjson,.json"
          className="hidden"
          onChange={(e) => void handleFileChange(e)}
        />

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={importBusy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          {importBusy ? 'Importing…' : 'Import'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          asChild
        >
          <a href={termsTemplateUrl(systemId)} download>
            <Download className="h-3.5 w-3.5" />
            Template
          </a>
        </Button>

        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onOpenTerm(null)}
        >
          <Plus className="h-3.5 w-3.5" />
          New term
        </Button>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {actionError}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-32 text-xs uppercase tracking-wide">Code</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Name</TableHead>
              <TableHead className="w-28 text-xs uppercase tracking-wide">Class</TableHead>
              <TableHead className="w-20 text-xs uppercase tracking-wide">Unit</TableHead>
              <TableHead className="w-24 text-xs uppercase tracking-wide">Status</TableHead>
              <TableHead className="w-24 text-right text-xs uppercase tracking-wide">Mappings</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child]:border-b">
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Searching…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No terms found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.code}
                  className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                  onClick={() => onOpenTerm(r)}
                >
                  <TableCell>
                    <span className="font-mono text-xs text-primary">{r.code}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-foreground">{r.display}</span>
                      {r.shortName && (
                        <div className="text-[11px] text-muted-foreground">{r.shortName}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.class ? (
                      <Badge variant="secondary">{r.class}</Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {r.unit ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusBadgeClass(r.status)}
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.mappingCount ? (
                      <span className="text-foreground">{r.mappingCount}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
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
                        <DropdownMenuItem onClick={() => onOpenTerm(r)}>
                          View
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setConfirmDelete(r)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(0);
        }}
        leftSlot={
          <span className="text-muted-foreground">{total} terms</span>
        }
      />

      {/* Delete confirm dialog — one shared instance */}
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
        title="Delete term"
        description={
          confirmDelete
            ? `Permanently delete "${confirmDelete.display ?? confirmDelete.code}" (${confirmDelete.code})? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}
