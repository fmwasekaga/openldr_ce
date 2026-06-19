import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getForm, submitFormResponse, type FormDefinition } from '@/api';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import type { FormSchema } from '@/forms-runtime/types';

function asFormSchema(value: unknown): FormSchema | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<FormSchema>;
  return typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.fields)
    ? (s as FormSchema)
    : null;
}

export function FormCapture() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [schema, setSchema] = useState<FormSchema | null>(null);
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
      const parsed = asFormSchema(loaded.schema);
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

  const isPublished = form?.status === 'published';

  const handleSubmit = async (cleaned: Record<string, unknown>) => {
    if (!id || !isPublished) return;
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
  };

  return (
    <AppShell title="Forms" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Single-line header: status badge + name/meta on left, ⋯ menu on right */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {form ? <Badge variant="outline">{form.status}</Badge> : null}
          <div className="min-w-0 flex-1">
            <span className="truncate text-sm font-semibold">{schema?.name ?? form?.name ?? 'Form'}</span>
            {form ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {form.versionLabel ?? 'No version'} · {form.fhirResourceType ?? 'Custom'}
              </span>
            ) : null}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Form actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={submitting || !schema || !isPublished}
                onSelect={() => {
                  (document.getElementById('form-capture') as HTMLFormElement | null)?.requestSubmit();
                }}
              >
                Submit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/forms')}>
                Cancel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Edge-to-edge body — scrollbar at pane edge; FormRuntime owns horizontal padding */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? <div className="px-6 py-8 text-center text-muted-foreground">Loading...</div> : null}
          {error ? <div className="mx-6 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
          {success ? <div className="mx-6 mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">Response captured.</div> : null}
          {form && !isPublished ? <div className="mx-6 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">This form is not published. Submission is disabled until it is published.</div> : null}

          {schema ? (
            <FormRuntime
              schema={schema}
              formId="form-capture"
              footer={null}
              onSubmit={handleSubmit}
            />
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
