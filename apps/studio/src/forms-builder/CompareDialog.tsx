import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getFormVersion, listFormVersions, type FormVersionSummary } from '../api';
import { diffFormSchemas, normalizeFormSchema, type FormSchema, type FormSchemaDiff } from '@openldr/forms/pure';

interface CompareRow {
  key: string;
  label: string;
  kind: string;
}

function flattenDiff(diff: FormSchemaDiff): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const change of diff.metadata) {
    rows.push({ key: `metadata-${change.path}`, label: `Metadata · ${change.path}`, kind: change.kind });
  }
  for (const change of diff.sections) {
    const suffix = change.kind === 'changed' ? ` · ${change.path}` : '';
    rows.push({ key: `section-${change.sectionId}-${change.kind}-${'path' in change ? change.path : ''}`, label: `Section ${change.sectionId}${suffix}`, kind: change.kind });
  }
  for (const change of diff.fields) {
    const suffix = change.kind === 'changed' ? ` · ${change.path}` : '';
    rows.push({ key: `field-${change.fieldId}-${change.kind}-${'path' in change ? change.path : ''}`, label: `Field ${change.fieldId}${suffix}`, kind: change.kind });
  }
  return rows;
}

export function CompareDialog({ formId, current, open, onOpenChange }: { formId: string | null; current: FormSchema; open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [rows, setRows] = useState<CompareRow[]>([]);

  useEffect(() => {
    if (!open || !formId) return;
    let cancelled = false;
    void listFormVersions(formId).then(async (loaded) => {
      if (cancelled) return;
      setVersions(loaded);
      const first = loaded[0];
      if (!first) {
        setRows([]);
        return;
      }
      const snapshot = await getFormVersion(formId, first.version);
      if (cancelled) return;
      setRows(flattenDiff(diffFormSchemas(normalizeFormSchema(snapshot.schema), current)));
    });
    return () => { cancelled = true; };
  }, [open, formId, current]);

  const latest = versions[0];
  const latestLabel = latest ? (latest.versionLabel ?? `v${latest.version}`) : '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Compare form versions</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {latest ? (
              <>Draft vs published <span className="font-medium text-foreground">{latestLabel}</span></>
            ) : (
              'No published versions yet.'
            )}
          </p>
        </div>

        {!latest ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium">No published versions yet</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              Publish this form to create a snapshot you can compare the current draft against.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium">No differences</p>
            <p className="mt-1 text-xs text-muted-foreground">The draft matches published {latestLabel}.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-6 py-2 text-xs text-muted-foreground">
              <span>{rows.length} change{rows.length === 1 ? '' : 's'} since {latestLabel}</span>
            </div>
            <div className="max-h-[55vh] divide-y divide-border overflow-auto">
              {rows.map((row) => {
                const meta = kindMeta(row.kind);
                return (
                  <div key={row.key} className="flex items-start gap-3 px-6 py-2.5">
                    <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                    <span className="text-sm leading-5">{row.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function kindMeta(kind: string): { label: string; cls: string } {
  if (kind === 'added') return { label: 'Added', cls: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600' };
  if (kind === 'removed') return { label: 'Removed', cls: 'border-destructive/30 bg-destructive/15 text-destructive' };
  return { label: 'Changed', cls: 'border-amber-500/30 bg-amber-500/15 text-amber-600' };
}
