import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createForm, getForm, updateForm, type FormDefinition } from '../api';
import { createDefaultFormSchema } from './builderModel';
import { LintSummary } from './LintSummary';
import { lintFormSchema, normalizeFormSchema, type FormSchema } from '@openldr/forms/pure';

export function FormBuilderPage(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const [formId, setFormId] = useState<string | null>(id ?? null);
  const [name, setName] = useState('Untitled form');
  const [versionLabel, setVersionLabel] = useState('');
  const [targetPages, setTargetPages] = useState<string[]>(['forms']);
  const [schema, setSchema] = useState<FormSchema>(() => createDefaultFormSchema('Untitled form'));
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);

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
          <Button variant="outline" size="sm" onClick={() => navigate('/forms')}>Back</Button>
          <Button size="sm" onClick={() => { void save(); }} disabled={loading || issues.some((issue) => issue.severity === 'error')}>Save draft</Button>
        </div>
        <div className="border-b border-border px-3 py-2"><LintSummary issues={issues} /></div>
        {error ? <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_24rem]">
          <aside className="border-r border-border p-3">Field palette</aside>
          <main className="min-h-0 overflow-auto p-3">Canvas</main>
          <aside className="border-l border-border p-3">Properties</aside>
        </div>
      </div>
    </AppShell>
  );
}
