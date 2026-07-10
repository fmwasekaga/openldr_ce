import { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import type { NodeFormProps } from './index';
import type { ActionNodeData } from '../../lib/types';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import { uploadWorkflowFile } from '@/api';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import { FormField, TextInput } from './shared';

const XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Config form for the Excel Template node. Upload a branded .xlsx once (the key
 *  fills in automatically); `columns` is a comma-separated ordered field list. */
export function ExcelTemplateForm({ node, update }: NodeFormProps) {
  const data = node.data as ActionNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => update({ config: { ...config, ...p } });
  const columns = Array.isArray(config.columns) ? (config.columns as string[]).join(', ') : '';
  const pw = (config.password as { connectorId?: string; key?: string } | undefined) ?? {};

  const workflowId = useWorkflowStore((s) => s.workflowId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!workflowId) { setError('Save the workflow first, then upload the template.'); return; }
    setError(null);
    setUploading(true);
    try {
      const ref = await uploadWorkflowFile(workflowId, file);
      patch({ templateRef: ref.objectKey });
      setUploadedName(ref.fileName ?? file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <FormField label="Label"><TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} /></FormField>

      <FormField label="Template (.xlsx)" hint="Upload the branded template once — the key below fills in automatically.">
        <div className="space-y-2">
          <input ref={fileRef} type="file" accept={XLSX_ACCEPT} className="hidden" onChange={onFile} />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
              {config.templateRef ? 'Replace template' : 'Upload template'}
            </Button>
            {uploadedName && <TruncatedText text={uploadedName} className="min-w-0 text-xs text-muted-foreground" />}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <TextInput
            value={String(config.templateRef ?? '')}
            onChange={(e) => patch({ templateRef: e.target.value })}
            placeholder="workflow-uploads/…/AMR_temp.xlsx (or paste a key)"
          />
        </div>
      </FormField>

      <FormField label="Start cell" hint="Top-left of the data write range, e.g. A2.">
        <TextInput value={String(config.startCell ?? 'A2')} onChange={(e) => patch({ startCell: e.target.value })} />
      </FormField>
      <FormField label="Columns (ordered)" hint="Comma-separated item fields, in template column order.">
        <TextInput value={columns} onChange={(e) => patch({ columns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
      </FormField>
      <FormField label="Auto-filter header cell" hint="e.g. A1. Leave blank to disable.">
        <TextInput value={String(config.autoFilter ?? '')} onChange={(e) => patch({ autoFilter: e.target.value })} />
      </FormField>
      <FormField label="File name" hint="Output attachment name; supports templating.">
        <TextInput value={String(config.fileName ?? '')} onChange={(e) => patch({ fileName: e.target.value })} />
      </FormField>
      <FormField label="Password connector id" hint="Connector holding the report password (optional).">
        <TextInput value={pw.connectorId ?? ''} onChange={(e) => patch({ password: { ...pw, connectorId: e.target.value } })} />
      </FormField>
      <FormField label="Password secret key" hint="Config key of the password within that connector.">
        <TextInput value={pw.key ?? ''} onChange={(e) => patch({ password: { ...pw, key: e.target.value } })} />
      </FormField>
    </div>
  );
}
