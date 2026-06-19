import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { createForm, deleteForm, formQuestionnaireUrl, getForm, publishForm, setFormStatus, updateForm } from '../api';
import { createDefaultFormSchema, makeUniqueFieldId, newField } from './builderModel';
import { CompareDialog } from './CompareDialog';
import { FieldEditorSheet } from './FieldEditorSheet';
import { useTemplateHistory } from './useTemplateHistory';
import { useBuilderKeyboard } from './useBuilderKeyboard';
import { BuilderHeader } from './BuilderHeader';
import { FieldListPane } from './FieldListPane';
import { LanguageControl } from './LanguageControl';
import { PreviewPane } from './PreviewPane';
import { SectionsManager } from './SectionsManager';
import {
  lintFormSchema,
  normalizeFormSchema,
  type FormField,
  type FormSchema,
} from '@openldr/forms/pure';

export function FormBuilderPage(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const [formId, setFormId] = useState<string | null>(id ?? null);
  const [schema, setSchema] = useState<FormSchema>(() => createDefaultFormSchema(''));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingNewFieldId, setPendingNewFieldId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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

  /** Record an edit in history, then apply a patch to the schema. */
  const updateSchema = (patch: Partial<FormSchema>) => {
    history.recordEdit();
    setSchema((prev) => ({ ...prev, ...patch }));
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    }));
  };

  const addField = () => {
    history.pushHistory();
    const nextOrder = schema.fields.reduce((max, f) => Math.max(max, f.order), -1) + 1;
    const field = newField('New text field', 'text');
    field.order = nextOrder;
    field.id = makeUniqueFieldId(field.id, new Set(schema.fields.map((f) => f.id)));
    setSchema((prev) => ({ ...prev, fields: [...prev.fields, field] }));
    setSelectedId(field.id);
    setPendingNewFieldId(field.id);
  };

  /** Save handler: commit the edited draft to the schema, then close. */
  const handleSheetSave = (updated: FormField) => {
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === updated.id ? updated : f)),
    }));
    setPendingNewFieldId(null);
    setSelectedId(null);
  };

  /** Cancel handler: if the open field was brand-new (never saved), remove it. */
  const handleSheetCancel = () => {
    if (pendingNewFieldId && pendingNewFieldId === selectedId) {
      setSchema((prev) => ({
        ...prev,
        fields: prev.fields.filter((f) => f.id !== pendingNewFieldId),
      }));
    }
    setPendingNewFieldId(null);
    setSelectedId(null);
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

  const archive = async () => {
    if (!formId) return;
    const f = await setFormStatus(formId, 'archived');
    setStatus(f.status);
  };

  // NOTE: a dedicated active-toggle endpoint is future work; for now disable maps to archived.
  const disable = async () => {
    if (!formId) return;
    await setFormStatus(formId, 'archived');
  };

  const handleDelete = async () => {
    if (!formId) return;
    await deleteForm(formId);
    navigate('/forms');
  };

  const exportForm = () => {
    if (!formId) return;
    const a = document.createElement('a');
    a.href = formQuestionnaireUrl(formId);
    a.download = `${schema.name || 'form'}.questionnaire.json`;
    a.click();
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
          formId={formId}
          onChange={patchSchema}
          onSave={() => { void save(); }}
          onPublish={() => { void publish(); }}
          onCompare={() => setCompareOpen(true)}
          onAddField={addField}
          onArchive={() => { void archive(); }}
          onDisable={() => { void disable(); }}
          onDelete={() => setConfirmDeleteOpen(true)}
          onExport={exportForm}
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

        {/* Two-pane body (sheet overlays on field select) */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: SectionsManager + FieldListPane */}
          <div className="w-72 shrink-0 border-r border-border overflow-y-auto flex flex-col">
            <SectionsManager
              sections={schema.sections}
              onChange={(sections) => updateSchema({ sections })}
              onFieldsClearSection={(id) =>
                updateSchema({
                  fields: schema.fields.map((f) =>
                    f.section === id ? { ...f, section: undefined } : f,
                  ),
                })
              }
            />
            <div className="flex-1 min-h-0 overflow-y-auto border-t border-border">
              <FieldListPane
                fields={schema.fields}
                sections={schema.sections}
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
          </div>

          {/* Right: PreviewPane */}
          <div className="flex-1 overflow-y-auto p-4">
            <PreviewPane schema={schema} />
          </div>
        </div>
      </div>

      <FieldEditorSheet
        field={selectedField}
        allFields={schema.fields}
        sections={schema.sections}
        languages={schema.languages ?? []}
        open={selectedId !== null}
        onOpenChange={(o) => { if (!o) handleSheetCancel(); }}
        onSave={handleSheetSave}
        onCancel={handleSheetCancel}
      />

      <CompareDialog
        formId={formId}
        current={schema}
        open={compareOpen}
        onOpenChange={setCompareOpen}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete form?"
        description="This will permanently delete the form and all its versions. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { void handleDelete(); }}
      />
    </AppShell>
  );
}
