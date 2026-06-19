import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { createForm, getForm, publishForm, updateForm, type FormDefinition } from '../api';
import { createDefaultFormSchema, newField, newSection } from './builderModel';
import { LintSummary } from './LintSummary';
import { FieldPalette } from './FieldPalette';
import { BuilderCanvas } from './BuilderCanvas';
import { PropertiesSheet } from './PropertiesSheet';
import { BulkActionBar } from './BulkActionBar';
import { CompareDialog } from './CompareDialog';
import { useTemplateHistory } from './useTemplateHistory';
import { useBuilderKeyboard } from './useBuilderKeyboard';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import type { RuntimeFormSchema } from '@/forms-runtime/types';
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
  const [name, setName] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [targetPages, setTargetPages] = useState<string[]>(['forms']);
  const [schema, setSchema] = useState<FormSchema>(() => createDefaultFormSchema('Untitled form'));
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
        setStatus(loaded.status);
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

  const allFields = useMemo<FormField[]>(() => schema.sections.flatMap((section) => section.fields), [schema]);

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

  const addSection = () => {
    history.pushHistory();
    setSchema((prev) => ({ ...prev, sections: [...prev.sections, newSection(`Section ${prev.sections.length + 1}`)] }));
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
    const effectiveName = name.trim() || 'Untitled form';
    const nextSchema = { ...schema, name: effectiveName, title: { ...schema.title, en: effectiveName } };
    const payload = { name: effectiveName, versionLabel: versionLabel || null, fhirResourceType: null, targetPages, schema: nextSchema };
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
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Input aria-label="Form name" value={name} placeholder="Untitled form" onChange={(event) => setName(event.target.value)} className="h-8 w-72 text-sm" />
          <Input aria-label="Version label" value={versionLabel} placeholder="Version (optional)" onChange={(event) => setVersionLabel(event.target.value)} className="h-8 w-40 text-sm" />
          <div className="flex-1" />
          {status ? <span className="rounded-md border border-border px-2 py-1 text-xs capitalize text-muted-foreground">{status}</span> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Builder actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { void save(); }} disabled={loading || issues.some((issue) => issue.severity === 'error')}>Save draft</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { void publish(); }} disabled={!formId || issues.some((issue) => issue.severity === 'error')}>Publish</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCompareOpen(true)} disabled={!formId}>Compare</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPreviewMode((value) => !value)}>{previewMode ? 'Edit' : 'Preview'}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyHistory(history.undo())} disabled={!history.canUndo}>Undo</DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyHistory(history.redo())} disabled={!history.canRedo}>Redo</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/forms')}>Back to forms</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <aside className="space-y-3 border-r border-border p-3">
            <Button type="button" size="sm" variant="outline" className="w-full justify-start text-xs" onClick={addSection}>Add section</Button>
            <FieldPalette search={search} onSearch={setSearch} onAddField={addField} />
          </aside>
          <main className="min-h-0 overflow-auto p-3">
            {previewMode ? (
              <div className="mx-auto max-w-2xl">
                <FormRuntime schema={schema as unknown as RuntimeFormSchema} submitLabel="Preview submit" onSubmit={() => undefined} />
              </div>
            ) : (
              <BuilderCanvas
                sections={filteredSections}
                selectedFieldIds={selectedFieldIds}
                onSelectField={selectField}
                onDuplicateField={(fieldId) => duplicateFieldsByIds(new Set([fieldId]))}
                onDeleteField={(fieldId) => deleteFieldsByIds(new Set([fieldId]))}
                onReorderField={reorderField}
              />
            )}
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
            <PropertiesSheet field={selectedField} allFields={allFields} onChange={updateSelectedField} />
          </aside>
        </div>
      </div>
      <CompareDialog formId={formId} current={schema} open={compareOpen} onOpenChange={setCompareOpen} />
    </AppShell>
  );
}
