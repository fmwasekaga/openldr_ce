import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { fetchWorkflowDatasets, type WorkflowDatasetSummary } from '@/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TruncatedText } from '@/components/ui/truncated-text';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DatasetsDrawer({ open, onClose }: Props) {
  const [datasets, setDatasets] = useState<WorkflowDatasetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    fetchWorkflowDatasets()
      .then((res) => { if (active) { setDatasets(res); setLoading(false); } })
      .catch(() => { if (active) { setError('Failed to load datasets.'); setLoading(false); } });
    return () => { active = false; };
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-[560px] flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>Datasets</SheetTitle>
          <SheetDescription>Internal datasets materialized by workflow runs.</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">{error}</div>
          ) : datasets.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No datasets yet. Add a Materialize Dataset node and run a workflow to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.map((d) => (
                  <TableRow key={d.name}>
                    <TableCell className="font-mono text-xs">
                      <div>{d.name}</div>
                      {d.publishedTable && (
                        <TruncatedText
                          text={`SELECT data->>'<col>' FROM ${d.publishedTable}`}
                          className="mt-0.5 max-w-[220px] rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {d.rowCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {d.updatedAt ? new Date(d.updatedAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`/api/workflows/datasets/${encodeURIComponent(d.name)}.csv`}
                        download={`${d.name}.csv`}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-violet-400 transition-colors hover:bg-violet-500/10 hover:text-violet-300"
                      >
                        <Download className="h-3 w-3" />
                        CSV
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
