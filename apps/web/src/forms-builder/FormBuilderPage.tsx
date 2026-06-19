import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createForm, getForm, updateForm, type FormDefinition } from '../api';
import { createDefaultFormSchema, newField, newSection } from './builderModel';
import { LintSummary } from './LintSummary';
import { FieldPalette } from './FieldPalette';
import { BuilderCanvas } from './BuilderCanvas';
import { PropertiesSheet } from './PropertiesSheet';
import { BulkActionBar } from './BulkActionBar';
import { useTemplateHistory } from './useTemplateHistory';
import { useBuilderKeyboard } from './useBuilderKeyboard';
import { lintFormSchema, normalizeFormSchema, type FieldType, type FormField, type FormSchema } from '@openldr/forms/pure';

function reorder<T>(items: T[], fromId: string, toId: string, idOf: (item: T) => string): T[] {
  const from = items.findIndex((item) => idOf(item) === fromId);
  const to = items.findIndex((item) => idOf(item) === toId);
  if (from === -1 || to === -1) return items;
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

export function FormBuilderPage(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const [formId, setFormId] = useState<string | null>(id ?? null);
  const [name, setName] = useState('Untitled form');
  const [versionLabel, setVersionLabel] = useState('');
  const [targetPages, setTargetPages] = useState<string[]>(['forms']);
  const [schema, setSchema] = useState<FormSchema>(() => createDefaultFormSchema('Untitled form'));
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);

  const history = useTemplateHistory<FormSchema>(() => schema);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    void getForm(id)
      .then((loaded: FormDefinition) => {
        if (cancelled) return;
        setFormId(loaded.id);
        setName(loaded.name);
        setVersionLabel(loaded.versionLabel ?? '');
        setTargetPages(loaded.targetPages ?? ['forms']);
        setSchema(normalizeFormSchema(loaded.schema));
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const issues = useMemo(() => lintFormSchema(schema), [schema]);

  const selectedField = useMemo<FormField | null>(() => {
    const targetId = [...selectedFieldIds][0];
    if (!targetId) return null;
    for (const section of schema.sections) {
      for (const field of section.fields) if (field.id === targetId) return field;
    }
    return null;
  }, [schema, selectedFieldIds]);

  const filteredSections = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return schema.sections;
    return schema.sections.map((section) => ({
      ...section,
      fields: section.fields.filter((field) => field.label.en.toLowerCase().includes(query) || field.id.toLowerCase().includes(query)),
    }));
  }, [schema, search]);

  const addField = (type: FieldType) => {
    history.pushHistory();
    setSchema((prev) => {
      const field = newField(`New ${type} field`, type);
      const sections = prev.sections.length > 0 ? prev.sections : [newSection('Main')];
      return { ...prev, sections: sections.map((section, index) => (index === 0 ? { ...section, fields: [...section.fields, field] } : section)) };
    });
    setSelectedFieldIds(new Set());
  };

  const selectField = (field: FormField, event: React.MouseEvent) => {
    const additive = event.ctrlKey || event.metaKey;
    setSelectedFieldIds((prev) => {
      const next = new Set(additive ? prev : []);
      if (next.has(field.id)) next.delete(field.id);
      else next.add(field.id);
      return next;
    });
  };

  const updateSelectedField = (updates: Partial<FormField>) => {
    const selected = [...selectedFieldIds][0];
    if (!selected) return;
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      sections: prev.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => (field.id === selected ? { ...field, ...updates } : field)),
      })),
    }));
    if (updates.id && updates.id !== selected) setSelectedFieldIds(new Set([updates.id]));
  };

  const deleteFieldsByIds = (ids: Set<string>) => {
    if (ids.size === 0) return;
    history.pushHistory();
    setSchema((prev) => ({
      ...prev,
      sections: prev.sections.map((section) => ({ ...section, fields: section.fields.filter((field) => !ids.has(field.id)) })),
    }));
    setSelectedFieldIds(new Set());
  };

  const duplicateFieldsByIds = (ids: Set<string>) => {
    if (ids.size === 0) return;
    history.pushHistory();
    setSchema((prev) => ({
      ...prev,
      sections: prev.sections.map((section) => ({
        ...section,
        fields: section.fields.flatMap((field) =>
          ids.has(field.id) ? [field, { ...field, id: `${field.id}-copy`, label: { ...field.label, en: `${field.label.en} copy` } }] : [field],
        ),
      })),
    }));
  };

  const reorderField = (activeId: string, overId: string) => {
    history.pushHistory();
    setSchema((prev) => ({
      ...prev,
      sections: prev.sections.map((section) =>
        section.fields.some((field) => field.id === activeId) && section.fields.some((field) => field.id === overId)
          ? { ...section, fields: reorder(section.fields, activeId, overId, (field) => field.id) }
          : section,
      ),
    }));
  };

  const applyHistory = (next: FormSchema | null) => {
    if (next) setSchema(next);
  };

  useBuilderKeyboard({
    focusSearch: () => document.getElementById('builder-field-search')?.focus(),
    next: () => undefined,
    previous: () => undefined,
    open: () => undefined,
    toggle: () => undefined,
    duplicate: () => duplicateFieldsByIds(selectedFieldIds),
    remove: () => deleteFieldsByIds(selectedFieldIds),
    selectAll: () => setSelectedFieldIds(new Set(schema.sections.flatMap((section) => section.fields.map((field) => field.id)))),
    undo: () => applyHistory(history.undo()),
    redo: () => applyHistory(history.redo()),
    clear: () => setSelectedFieldIds(new Set()),
  });

  const save = async () => {
    const nextSchema = { ...schema, name, title: { ...schema.title, en: name } };
    const payload = { name, versionLabel: versionLabel || null, fhirResourceType: null, targetPages, schema: nextSchema };
    const saved = formId ? await updateForm(formId, payload) : await createForm(payload);
    if (!formId) {
      setFormId(saved.id);
      navigate(`/forms/${saved.id}/builder`, { replace: true });
    }
  };

  return (
    <AppShell title="Form Builder" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Input aria-label="Form name" value={name} onChange={(event) => setName(event.target.value)} className="h-8 w-72 text-sm" />
          <Input aria-label="Version label" value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} className="h-8 w-32 text-sm" />
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => applyHistory(history.undo())} disabled={!history.canUndo}>Undo</Button>
          <Button variant="outline" size="sm" onClick={() => applyHistory(history.redo())} disabled={!history.canRedo}>Redo</Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/forms')}>Back</Button>
          <Button size="sm" onClick={() => { void save(); }} disabled={loading || issues.some((issue) => issue.severity === 'error')}>Save draft</Button>
        </div>
        <div className="flex items-center gap-3 border-b border-border px-3 py-2">
          <LintSummary issues={issues} />
          <BulkActionBar
            count={selectedFieldIds.size}
            onDelete={() => deleteFieldsByIds(selectedFieldIds)}
            onDuplicate={() => duplicateFieldsByIds(selectedFieldIds)}
            onClear={() => setSelectedFieldIds(new Set())}
          />
        </div>
        {error ? <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_24rem]">
          <aside className="border-r border-border p-3">
            <FieldPalette search={search} onSearch={setSearch} onAddField={addField} />
          </aside>
          <main className="min-h-0 overflow-auto p-3">
            <BuilderCanvas
              sections={filteredSections}
              selectedFieldIds={selectedFieldIds}
              onSelectField={selectField}
              onDuplicateField={(fieldId) => duplicateFieldsByIds(new Set([fieldId]))}
              onDeleteField={(fieldId) => deleteFieldsByIds(new Set([fieldId]))}
              onReorderField={reorderField}
            />
          </main>
          <aside className="space-y-3 border-l border-border p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Properties</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label="Delete selected field"
                disabled={selectedFieldIds.size === 0}
                onClick={() => deleteFieldsByIds(selectedFieldIds)}
              >
                Delete
              </Button>
            </div>
            <PropertiesSheet field={selectedField} onChange={updateSelectedField} />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
