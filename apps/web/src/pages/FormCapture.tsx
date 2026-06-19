import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getForm, submitFormResponse, type FormDefinition } from '@/api';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import type { RuntimeFormSchema } from '@/forms-runtime/types';

function asRuntimeSchema(value: unknown): RuntimeFormSchema | null {
  if (!value || typeof value !== 'object') return null;
  const form = value as Partial<RuntimeFormSchema>;
  return typeof form.id === 'string' && typeof form.name === 'string' && Array.isArray(form.sections) ? (form as RuntimeFormSchema) : null;
}

export function FormCapture() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [schema, setSchema] = useState<RuntimeFormSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getForm(id ?? '').then((loaded) => {
      if (cancelled) return;
      const parsed = asRuntimeSchema(loaded.schema);
      setForm(loaded);
      setSchema(parsed);
      if (!parsed) setError('Form schema is invalid.');
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <AppShell title="Forms" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate('/forms')}>Back</Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{schema?.title.en ?? form?.name ?? 'Form'}</h1>
            {form ? <p className="text-xs text-muted-foreground">{form.versionLabel ?? 'No version'} · {form.fhirResourceType ?? 'Custom'}</p> : null}
          </div>
          {form ? <Badge variant="outline">{form.status}</Badge> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {loading ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : null}
          {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
          {success ? <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">Response captured.</div> : null}

          {schema ? (
            <div className="mx-auto max-w-4xl">
              <FormRuntime
                schema={schema}
                submitLabel="Submit"
                onSubmit={async (cleaned) => {
                  if (!id) return;
                  setSubmitting(true);
                  setSuccess(false);
                  try {
                    await submitFormResponse(id, cleaned);
                    setSuccess(true);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSubmitting(false);
                  }
                }}
                footer={(
                  <div className="flex justify-end gap-2 border-t border-border pt-4">
                    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate('/forms')}>Cancel</Button>
                    <Button type="submit" size="sm" className="h-8 text-xs" disabled={submitting}>Submit</Button>
                  </div>
                )}
              />
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
