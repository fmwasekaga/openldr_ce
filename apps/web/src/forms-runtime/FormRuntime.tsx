import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RuntimeAnswers, RuntimeAnswerValue, RuntimeField, RuntimeFormSchema } from './types';
import { cleanAnswers, fieldValue, formatFieldValue, validateClient, visibleFieldIds } from './runtime';

export function FormRuntime({
  schema,
  submitLabel,
  onSubmit,
  footer,
}: {
  schema: RuntimeFormSchema;
  submitLabel: string;
  onSubmit: (answers: RuntimeAnswers) => void | Promise<void>;
  footer?: React.ReactNode;
}): JSX.Element {
  const [answers, setAnswers] = useState<RuntimeAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const visible = useMemo(() => visibleFieldIds(schema, answers), [schema, answers]);

  const submit = async () => {
    const nextErrors = validateClient(schema, answers);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    await onSubmit(cleanAnswers(schema, answers));
  };

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
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
                  <FieldControl
                    field={field}
                    answers={answers}
                    error={errors[field.id]}
                    onChange={(fieldId, value) => {
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
                    }}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {footer ?? <Button type="submit">{submitLabel}</Button>}
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: RuntimeField;
  value: RuntimeAnswerValue | undefined;
  onChange: (value: RuntimeAnswerValue | undefined) => void;
}) {
  if (field.type === 'boolean') {
    return <Checkbox id={field.id} checked={Boolean(value)} onCheckedChange={(checked) => onChange(Boolean(checked))} aria-label={field.label.en} />;
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
        placeholder={field.placeholder?.en}
        onChange={(event) => onChange(fieldValue(field, event.target.value))}
        aria-label={field.label.en}
      />
      {field.unit ? <span className="text-xs text-muted-foreground">{field.unit}</span> : null}
    </div>
  );
}

function FieldControl({
  field,
  answers,
  error,
  onChange,
}: {
  field: RuntimeField;
  answers: RuntimeAnswers;
  error?: string;
  onChange: (fieldId: string, value: RuntimeAnswerValue | RuntimeAnswerValue[] | undefined) => void;
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
                  onChange(field.id, copy.filter((item): item is RuntimeAnswerValue => item !== undefined));
                }}
              />
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${field.label.en} ${index + 1}`} onClick={() => onChange(field.id, nextValues.filter((_, i) => i !== index) as RuntimeAnswerValue[])}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onChange(field.id, [...values, ''] as RuntimeAnswerValue[])}>
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
      {field.helpText?.en ? <p className="mt-1 text-xs text-muted-foreground">{field.helpText.en}</p> : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
