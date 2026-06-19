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
    rows.push({ key: `metadata-${change.path}`, label: `Metadata changed: ${change.path}`, kind: change.kind });
  }
  for (const change of diff.sections) {
    const suffix = change.kind === 'changed' ? `: ${change.path}` : '';
    rows.push({ key: `section-${change.sectionId}-${change.kind}-${'path' in change ? change.path : ''}`, label: `Section ${change.kind}: ${change.sectionId}${suffix}`, kind: change.kind });
  }
  for (const change of diff.fields) {
    const suffix = change.kind === 'changed' ? `: ${change.path}` : '';
    rows.push({ key: `field-${change.fieldId}-${change.kind}-${'path' in change ? change.path : ''}`, label: `Field ${change.kind}: ${change.fieldId}${suffix}`, kind: change.kind });
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>Compare form versions</DialogTitle>
        {latest ? <p className="text-xs text-muted-foreground">Published version {latest.versionLabel ?? latest.version}</p> : <p className="text-xs text-muted-foreground">No published versions.</p>}
        <div className="max-h-[60vh] overflow-auto">
          {latest && rows.length === 0 ? <p className="text-sm text-muted-foreground">No differences.</p> : rows.map((row) => (
            <div key={row.key} className="border-b border-border py-2 text-sm">
              <div className="font-medium">{row.label}</div>
              <div className="text-xs text-muted-foreground">{row.kind}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
