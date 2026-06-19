import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { createForm, getForm, publishForm, updateForm } from '../api';
import { createDefaultFormSchema, newField } from './builderModel';
import { LintSummary } from './LintSummary';
import { CompareDialog } from './CompareDialog';
import { useTemplateHistory } from './useTemplateHistory';
import { useBuilderKeyboard } from './useBuilderKeyboard';
import { lintFormSchema, normalizeFormSchema, type FieldType, type FormField, type FormSchema } from '@openldr/forms/pure';

const FIELD_TYPES: FieldType[] = [
  'text', 'number', 'date', 'datetime', 'boolean',
  'select', 'multiselect', 'phone', 'email', 'address',
  'identifier', 'attachment', 'organism', 'antibiogram',
  'reference', 'facility', 'group',
];

export function FormBuilderPage(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const [formId, setFormId] = useState<string | null>(id ?? null);
  const [name, setName] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [schema, setSchema] = useState<FormSchema>(() => createDefaultFormSchema('Untitled form'));
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const history = useTemplateHistory<FormSchema>(() => schema);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    void getForm(id)
      .then((loaded) => {
        if (cancelled) return;
        setFormId(loaded.id);
        setName(loaded.name);
        setVersionLabel(loaded.versionLabel ?? '');
        setStatus(loaded.status);
        setSchema(normalizeFormSchema(loaded.schema));
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const issues = useMemo(() => lintFormSchema(schema), [schema]);

  const selectedField = useMemo<FormField | null>(
    () => schema.fields.find((f) => f.id === selectedFieldId) ?? null,
    [schema.fields, selectedFieldId],
  );

  const addField = () => {
    history.pushHistory();
    const field = newField('New field', 'text');
    setSchema((prev) => ({ ...prev, fields: [...prev.fields, field] }));
    setSelectedFieldId(field.id);
  };

  const updateField = (updates: Partial<FormField>) => {
    if (!selectedFieldId) return;
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === selectedFieldId ? { ...f, ...updates } : f)),
    }));
  };

  const deleteField = (fieldId: string) => {
    history.pushHistory();
    setSchema((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== fieldId) }));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  };

  const applyHistory = (next: FormSchema | null) => { if (next) setSchema(next); };

  useBuilderKeyboard({
    focusSearch: () => document.getElementById('builder-field-search')?.focus(),
    next: () => undefined,
    previous: () => undefined,
    open: () => undefined,
    toggle: () => undefined,
    duplicate: () => undefined,
    remove: () => { if (selectedFieldId) deleteField(selectedFieldId); },
    selectAll: () => undefined,
    undo: () => applyHistory(history.undo()),
    redo: () => applyHistory(history.redo()),
    clear: () => setSelectedFieldId(null),
  });

  const save = async () => {
    const effectiveName = name.trim() || 'Untitled form';
    const nextSchema: FormSchema = { ...schema, name: effectiveName };
    const payload = { name: effectiveName, versionLabel: versionLabel || null, fhirResourceType: null, targetPages: schema.targetPages, schema: nextSchema };
    const saved = formId ? await updateForm(formId, payload) : await createForm(payload);
    setStatus(saved.status);
    if (!formId) {
      setFormId(saved.id);
      navigate(`/forms/${saved.id}/builder`, { replace: true });
    }
  };

  const publish = async () => {
    if (!formId) return;
    const published = await publishForm(formId, { versionLabel: versionLabel || null });
    setStatus(published.status);
  };

  return (
    <AppShell title="Form Builder" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Input
            aria-label="Form name"
            value={name}
            placeholder="Untitled form"
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-72 text-sm"
          />
          <Input
            aria-label="Version label"
            value={versionLabel}
            placeholder="Version (optional)"
            onChange={(e) => setVersionLabel(e.target.value)}
            className="h-8 w-40 text-sm"
          />
          <div className="flex-1" />
          <LintSummary issues={issues} />
          {status ? (
            <span className="rounded-md border border-border px-2 py-1 text-xs capitalize text-muted-foreground">{status}</span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Builder actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { void save(); }} disabled={loading}>
                Save draft
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { void publish(); }} disabled={!formId}>
                Publish
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCompareOpen(true)} disabled={!formId}>
                Compare
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => applyHistory(history.undo())} disabled={!history.canUndo}>
                Undo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyHistory(history.redo())} disabled={!history.canRedo}>
                Redo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/forms')}>Back to forms</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {error ? (
          <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {/* Two-column body: field list + inline editor */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Field list */}
          <div className="flex w-72 flex-col border-r border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span className="flex-1 text-xs font-semibold text-muted-foreground">
                Fields ({schema.fields.length})
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={addField}
                aria-label="Add field"
              >
                Add field
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {schema.fields.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted-foreground">No fields yet. Click &quot;Add field&quot; to start.</p>
              ) : (
                <ul>
                  {schema.fields.map((field) => (
                    <li key={field.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent ${selectedFieldId === field.id ? 'bg-accent font-medium' : ''}`}
                        onClick={() => setSelectedFieldId(field.id)}
                      >
                        <span className="flex-1 truncate">{field.displayLabel}</span>
                        <span className="shrink-0 text-muted-foreground">{field.fieldType}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete field ${field.displayLabel}`}
                          onClick={(e) => { e.stopPropagation(); deleteField(field.id); }}
                        >
                          ×
                        </Button>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Inline field editor */}
          <div className="flex-1 overflow-auto p-4">
            {selectedField ? (
              <div className="max-w-md space-y-4">
                <h2 className="text-sm font-semibold">Edit field</h2>

                <div className="space-y-1">
                  <Label htmlFor="field-display-label" className="text-xs">Display Label</Label>
                  <Input
                    id="field-display-label"
                    aria-label="Display label"
                    value={selectedField.displayLabel}
                    onChange={(e) => updateField({ displayLabel: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Field Type</Label>
                  <Select
                    value={selectedField.fieldType}
                    onValueChange={(v) => updateField({ fieldType: v as FieldType })}
                  >
                    <SelectTrigger aria-label="Field type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={selectedField.required}
                    onCheckedChange={(checked) => updateField({ required: Boolean(checked) })}
                  />
                  Required
                </label>

                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={selectedField.enabled}
                    onCheckedChange={(checked) => updateField({ enabled: Boolean(checked) })}
                  />
                  Enabled
                </label>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive text-destructive hover:bg-destructive/10"
                  aria-label="Delete selected field"
                  onClick={() => deleteField(selectedField.id)}
                >
                  Delete field
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Select a field to edit its properties.</p>
            )}
          </div>
        </div>
      </div>

      <CompareDialog formId={formId} current={schema} open={compareOpen} onOpenChange={setCompareOpen} />
    </AppShell>
  );
}
