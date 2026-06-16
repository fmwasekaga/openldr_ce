import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getForm, submitFormResponse, type FormDefinition } from '@/api';

type AnswerValue = string | number | boolean | { code: string; display?: string; system?: string } | { value?: number; unit?: string };
type Answers = Record<string, AnswerValue | AnswerValue[]>;

interface FormSchema {
  id: string;
  name: string;
  title: { en: string };
  sections: FormSection[];
}
interface FormSection {
  id: string;
  title: { en: string };
  repeats?: boolean;
  fields: FormField[];
}
interface FormField {
  id: string;
  type: 'string' | 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'dateTime' | 'choice' | 'open-choice' | 'reference' | 'quantity';
  label: { en: string };
  required?: boolean;
  repeats?: boolean;
  cardinality?: { min?: number; max?: number };
  options?: Array<{ code: string; display: { en: string }; system?: string }>;
  visibility?: { whenField: string; equals: string | number | boolean };
  unit?: string;
}

function asFormSchema(value: unknown): FormSchema | null {
  if (!value || typeof value !== 'object') return null;
  const form = value as Partial<FormSchema>;
  return typeof form.id === 'string' && typeof form.name === 'string' && Array.isArray(form.sections) ? (form as FormSchema) : null;
}

function answerComparable(value: unknown): unknown {
  return value && typeof value === 'object' && 'code' in value ? (value as { code: string }).code : value;
}

function visibleFieldIds(form: FormSchema, answers: Answers): Set<string> {
  const visible = new Set<string>();
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!field.visibility || answerComparable(answers[field.visibility.whenField]) === field.visibility.equals) {
        visible.add(field.id);
      }
    }
  }
  return visible;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function typeOk(field: FormField, value: AnswerValue): boolean {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'date':
    case 'dateTime':
    case 'reference':
      return typeof value === 'string';
    case 'integer':
    case 'decimal':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'choice':
    case 'open-choice':
      return typeof value === 'object' && value !== null && 'code' in value;
    case 'quantity':
      return typeof value === 'object' && value !== null && 'value' in value;
    default:
      return false;
  }
}

function validateClient(form: FormSchema, answers: Answers): Record<string, string> {
  const visible = visibleFieldIds(form, answers);
  const errors: Record<string, string> = {};
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!visible.has(field.id)) continue;
      const raw = answers[field.id];
      const values = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).filter((value) => !isEmpty(value));
      if (field.required && values.length === 0) {
        errors[field.id] = `field ${field.id} is required`;
        continue;
      }
      for (const value of values) {
        if (!typeOk(field, value)) {
          errors[field.id] = `field ${field.id} has the wrong type`;
          break;
        }
        if (field.type === 'choice' && field.options) {
          const code = (value as { code: string }).code;
          if (!field.options.some((option) => option.code === code)) errors[field.id] = `field ${field.id} value '${code}' not in options`;
        }
      }
      if (field.cardinality) {
        if (field.cardinality.min !== undefined && values.length < field.cardinality.min) errors[field.id] = `field ${field.id} below min cardinality`;
        if (field.cardinality.max !== undefined && values.length > field.cardinality.max) errors[field.id] = `field ${field.id} above max cardinality`;
      }
    }
  }
  return errors;
}

function cleanAnswers(form: FormSchema, answers: Answers): Answers {
  const visible = visibleFieldIds(form, answers);
  const out: Answers = {};
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!visible.has(field.id)) continue;
      const raw = answers[field.id];
      const values = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).filter((value) => !isEmpty(value));
      if (values.length === 0) continue;
      out[field.id] = field.repeats ? values : values[0]!;
    }
  }
  return out;
}

function formatFieldValue(field: FormField, value: unknown): string {
  if (field.type === 'choice' || field.type === 'open-choice') return value && typeof value === 'object' && 'code' in value ? (value as { code: string }).code : '';
  if (field.type === 'quantity') return value && typeof value === 'object' && 'value' in value ? String((value as { value?: number }).value ?? '') : '';
  return value == null ? '' : String(value);
}

function fieldValue(field: FormField, raw: string | boolean): AnswerValue | undefined {
  if (raw === '') return undefined;
  switch (field.type) {
    case 'integer':
      return Number.parseInt(String(raw), 10);
    case 'decimal':
      return Number.parseFloat(String(raw));
    case 'boolean':
      return Boolean(raw);
    case 'choice': {
      const option = field.options?.find((item) => item.code === raw);
      return { code: String(raw), display: option?.display.en, system: option?.system };
    }
    case 'open-choice': {
      const option = field.options?.find((item) => item.code === raw);
      return { code: String(raw), display: option?.display.en ?? String(raw), system: option?.system };
    }
    case 'quantity':
      return { value: Number.parseFloat(String(raw)), unit: field.unit };
    default:
      return String(raw);
  }
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | undefined) => void;
}) {
  if (field.type === 'boolean') {
    return (
      <Checkbox
        id={field.id}
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(Boolean(checked))}
        aria-label={field.label.en}
      />
    );
  }
  if (field.type === 'choice') {
    return (
      <Select value={formatFieldValue(field, value)} onValueChange={(next) => onChange(fieldValue(field, next))}>
        <SelectTrigger id={field.id} aria-label={field.label.en}><SelectValue placeholder="Select..." /></SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((option) => <SelectItem key={option.code} value={option.code}>{option.display.en}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  const type = field.type === 'integer' || field.type === 'decimal' || field.type === 'quantity'
    ? 'number'
    : field.type === 'date'
      ? 'date'
      : field.type === 'dateTime'
        ? 'datetime-local'
        : 'text';
  return (
    <div className="flex items-center gap-2">
      <Input
        id={field.id}
        type={type}
        value={formatFieldValue(field, value)}
        onChange={(event) => onChange(fieldValue(field, event.target.value))}
        aria-label={field.label.en}
      />
      {field.unit ? <span className="text-xs text-muted-foreground">{field.unit}</span> : null}
      {field.type === 'reference' || field.type === 'open-choice' ? <span className="text-xs text-muted-foreground">basic input</span> : null}
    </div>
  );
}

function FieldControl({
  field,
  answers,
  error,
  onChange,
}: {
  field: FormField;
  answers: Answers;
  error?: string;
  onChange: (fieldId: string, value: AnswerValue | AnswerValue[] | undefined) => void;
}) {
  const raw = answers[field.id];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];

  if (field.repeats) {
    const nextValues = values.length > 0 ? values : [undefined];
    return (
      <div className="space-y-2">
        {nextValues.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="flex-1">
              <FieldInput
                field={field}
                value={value}
                onChange={(next) => {
                  const copy = [...nextValues];
                  if (next === undefined) copy.splice(index, 1);
                  else copy[index] = next;
                  onChange(field.id, copy.filter((item): item is AnswerValue => item !== undefined));
                }}
              />
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${field.label.en} ${index + 1}`} onClick={() => onChange(field.id, nextValues.filter((_, i) => i !== index) as AnswerValue[])}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onChange(field.id, [...values, ''] as AnswerValue[])}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <FieldInput field={field} value={values[0]} onChange={(next) => onChange(field.id, next)} />
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function FormCapture() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
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

  const visible = useMemo(() => (schema ? visibleFieldIds(schema, answers) : new Set<string>()), [schema, answers]);

  const setAnswer = useCallback((fieldId: string, value: AnswerValue | AnswerValue[] | undefined) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
    setSuccess(false);
  }, []);

  const submit = async () => {
    if (!schema || !id) return;
    const nextErrors = validateClient(schema, answers);
    setErrors(nextErrors);
    setSuccess(false);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    try {
      await submitFormResponse(id, cleanAnswers(schema, answers));
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
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate('/forms')}>Back</Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{schema?.title.en ?? form?.name ?? 'Form'}</h1>
            {form ? <p className="text-xs text-muted-foreground">{form.versionLabel ?? 'No version'} · {form.fhirResourceType ?? 'Custom'}</p> : null}
          </div>
          {form ? <Badge variant="outline">{form.status}</Badge> : null}
        </div>

        <form
          className="min-h-0 flex-1 overflow-auto px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {loading ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : null}
          {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
          {success ? <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">Response captured.</div> : null}

          {schema ? (
            <div className="mx-auto max-w-4xl space-y-6">
              {schema.sections.map((section) => {
                const fields = section.fields.filter((field) => visible.has(field.id));
                if (fields.length === 0) return null;
                return (
                  <section key={section.id} className="space-y-3">
                    <div className="border-b border-border pb-2">
                      <h2 className="text-sm font-semibold">{section.title.en}</h2>
                    </div>
                    <div className="grid gap-4">
                      {fields.map((field) => (
                        <div key={field.id} className="grid gap-1.5 md:grid-cols-[12rem_minmax(0,1fr)] md:items-start">
                          <Label htmlFor={field.id} className="pt-2 text-sm">
                            {field.label.en}
                            {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
                          </Label>
                          <FieldControl field={field} answers={answers} error={errors[field.id]} onChange={setAnswer} />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}
        </form>

        <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate('/forms')}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs" disabled={!schema || submitting} onClick={() => { void submit(); }}>
            Submit
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
