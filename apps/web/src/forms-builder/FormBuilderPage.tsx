import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createForm, getForm, publishForm, updateForm } from '../api';
import { createDefaultFormSchema, newField } from './builderModel';
import { CompareDialog } from './CompareDialog';
import { useTemplateHistory } from './useTemplateHistory';
import { useBuilderKeyboard } from './useBuilderKeyboard';
import { BuilderHeader } from './BuilderHeader';
import { FieldListPane } from './FieldListPane';
import { LanguageControl } from './LanguageControl';
import {
  lintFormSchema,
  normalizeFormSchema,
  type FieldType,
  type FormField,
  type FormSchema,
} from '@openldr/forms/pure';

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
  const [schema, setSchema] = useState<FormSchema>(() => createDefaultFormSchema(''));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const history = useTemplateHistory<FormSchema>(() => schema);

  // ── Load existing form ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    void getForm(id)
      .then((loaded) => {
        if (cancelled) return;
        setFormId(loaded.id);
        setStatus(loaded.status);
        setSchema(normalizeFormSchema(loaded.schema));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const issues = useMemo(() => lintFormSchema(schema), [schema]);
  const hasErrors = issues.some((i) => i.severity === 'error');

  const selectedField = useMemo<FormField | null>(
    () => schema.fields.find((f) => f.id === selectedId) ?? null,
    [schema.fields, selectedId],
  );

  // ── Schema helpers ───────────────────────────────────────────────────────────
  const patchSchema = (patch: Partial<FormSchema>) => {
    setSchema((prev) => ({ ...prev, ...patch }));
  };

  const updateField = (updates: Partial<FormField>) => {
    if (!selectedId) return;
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === selectedId ? { ...f, ...updates } : f)),
    }));
  };

  const addField = () => {
    history.pushHistory();
    const nextOrder = schema.fields.reduce((max, f) => Math.max(max, f.order), -1) + 1;
    const field = newField('New text field', 'text');
    field.order = nextOrder;
    setSchema((prev) => ({ ...prev, fields: [...prev.fields, field] }));
    setSelectedId(field.id);
  };

  const deleteField = (fieldId: string) => {
    history.pushHistory();
    setSchema((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== fieldId) }));
    if (selectedId === fieldId) setSelectedId(null);
  };

  const duplicateField = (fieldId: string) => {
    const src = schema.fields.find((f) => f.id === fieldId);
    if (!src) return;
    history.pushHistory();
    const copy = { ...src, id: `${src.id}-copy-${Date.now()}`, displayLabel: `${src.displayLabel} (copy)`, order: src.order + 0.5 };
    setSchema((prev) => ({ ...prev, fields: [...prev.fields, copy] }));
    setSelectedId(copy.id);
  };

  const toggleEnabled = (fieldId: string) => {
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? { ...f, enabled: !f.enabled } : f)),
    }));
  };

  const toggleRequired = (fieldId: string) => {
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? { ...f, required: !f.required } : f)),
    }));
  };

  const reorderFields = (activeId: string, overId: string) => {
    history.pushHistory();
    setSchema((prev) => {
      const fields = [...prev.fields].sort((a, b) => a.order - b.order);
      const activeIndex = fields.findIndex((f) => f.id === activeId);
      const overIndex = fields.findIndex((f) => f.id === overId);
      if (activeIndex === -1 || overIndex === -1) return prev;
      const [moved] = fields.splice(activeIndex, 1);
      fields.splice(overIndex, 0, moved);
      const reordered = fields.map((f, i) => ({ ...f, order: i }));
      return { ...prev, fields: reordered };
    });
  };

  const applyHistory = (next: FormSchema | null) => { if (next) setSchema(next); };

  useBuilderKeyboard({
    focusSearch: () => document.getElementById('builder-field-search')?.focus(),
    next: () => undefined,
    previous: () => undefined,
    open: () => undefined,
    toggle: () => undefined,
    duplicate: () => undefined,
    remove: () => { if (selectedId) deleteField(selectedId); },
    selectAll: () => undefined,
    undo: () => applyHistory(history.undo()),
    redo: () => applyHistory(history.redo()),
    clear: () => setSelectedId(null),
  });

  // ── API actions ──────────────────────────────────────────────────────────────
  const save = async () => {
    const effectiveName = schema.name.trim() || 'Untitled form';
    const nextSchema: FormSchema = { ...schema, name: effectiveName };
    const payload = {
      name: effectiveName,
      versionLabel: schema.versionLabel ?? null,
      fhirResourceType: schema.fhirResourceType ?? null,
      targetPages: schema.targetPages,
      schema: nextSchema,
    };
    const saved = formId ? await updateForm(formId, payload) : await createForm(payload);
    setStatus(saved.status);
    if (!formId) {
      setFormId(saved.id);
      navigate(`/forms/${saved.id}/builder`, { replace: true });
    }
  };

  const publish = async () => {
    if (!formId) return;
    const published = await publishForm(formId, { versionLabel: schema.versionLabel ?? null });
    setStatus(published.status);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <AppShell title="Form Builder" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Top: BuilderHeader */}
        <BuilderHeader
          schema={schema}
          issues={issues}
          canPublish={!hasErrors}
          onChange={patchSchema}
          onSave={() => { void save(); }}
          onPublish={() => { void publish(); }}
          onCompare={() => setCompareOpen(true)}
          onAddField={addField}
          languageSlot={
            <LanguageControl
              languages={schema.languages ?? []}
              onChange={(langs) => patchSchema({ languages: langs })}
            />
          }
        />

        {error ? (
          <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {status ? (
          <span className="mx-3 mt-1 inline-block rounded-md border border-border px-2 py-1 text-xs capitalize text-muted-foreground">
            {status}
          </span>
        ) : null}

        {/* Three-pane body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: FieldListPane */}
          <div className="w-72 shrink-0 border-r border-border">
            <FieldListPane
              fields={schema.fields}
              selectedFieldId={selectedId}
              issues={issues}
              onSelect={(f) => setSelectedId(f.id)}
              onToggleEnabled={toggleEnabled}
              onToggleRequired={toggleRequired}
              onDuplicate={duplicateField}
              onDelete={deleteField}
              onReorder={reorderFields}
            />
          </div>

          {/* Right: inline properties for selected field */}
          <div className="flex-1 overflow-auto p-4">
            {selectedField ? (
              <div className="max-w-md space-y-4">
                <h2 className="text-sm font-semibold">Field properties</h2>

                {/* Display Label */}
                <div className="space-y-1">
                  <Label htmlFor="field-display-label" className="text-xs">Display Label</Label>
                  <Input
                    id="field-display-label"
                    aria-label="Field label"
                    value={selectedField.displayLabel}
                    onChange={(e) => updateField({ displayLabel: e.target.value })}
                  />
                </div>

                {/* Field Type */}
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

                {/* Required */}
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    aria-label="Required"
                    checked={selectedField.required}
                    onCheckedChange={(checked) => updateField({ required: Boolean(checked) })}
                  />
                  Required
                </label>

                {/* Enabled */}
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    aria-label="Enabled"
                    checked={selectedField.enabled}
                    onCheckedChange={(checked) => updateField({ enabled: Boolean(checked) })}
                  />
                  Enabled
                </label>

                {/* Delete */}
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

      <CompareDialog
        formId={formId}
        current={schema}
        open={compareOpen}
        onOpenChange={setCompareOpen}
      />
    </AppShell>
  );
}
