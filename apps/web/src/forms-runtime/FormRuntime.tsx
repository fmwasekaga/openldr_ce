import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FormField, FormSchema, RuntimeAnswers } from './types';
import { cleanAnswers, fieldLabel, groupChildren, validate, visibleIds } from './runtime';

// ── Public component ──────────────────────────────────────────────────────────

export function FormRuntime({
  schema,
  submitLabel,
  onSubmit,
  footer,
}: {
  schema: FormSchema;
  submitLabel: string;
  onSubmit: (answers: RuntimeAnswers) => void | Promise<void>;
  footer?: React.ReactNode;
}): JSX.Element {
  const [answers, setAnswers] = useState<RuntimeAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const visible = useMemo(() => visibleIds(schema, answers), [schema, answers]);

  const setField = (fieldId: string, value: unknown) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))
        delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const submit = async () => {
    const nextErrors = validate(schema, answers);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    await onSubmit(cleanAnswers(schema, answers));
  };

  // Render fields ordered by field.order, grouped by section if desired.
  // For simplicity we render one flat ordered list (sections are metadata in the new model).
  const sortedFields = useMemo(
    () =>
      schema.fields
        .filter((f) => visible.has(f.id) && !f.groupId) // top-level only; children rendered inside group
        .sort((a, b) => a.order - b.order),
    [schema.fields, visible],
  );

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4">
        {sortedFields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            schema={schema}
            answers={answers}
            visible={visible}
            error={errors[field.id]}
            onChange={setField}
            errors={errors}
          />
        ))}
      </div>
      {footer ?? <Button type="submit">{submitLabel}</Button>}
    </form>
  );
}

// ── Field row (label + control) ───────────────────────────────────────────────

function FieldRow({
  field,
  schema,
  answers,
  visible,
  error,
  onChange,
  errors,
}: {
  field: FormField;
  schema: FormSchema;
  answers: RuntimeAnswers;
  visible: Set<string>;
  error?: string;
  onChange: (fieldId: string, value: unknown) => void;
  errors: Record<string, string>;
}) {
  const label = fieldLabel(field);

  if (field.fieldType === 'group') {
    const children = groupChildren(schema, field.id).filter((c) => visible.has(c.id));
    return (
      <fieldset className="rounded-md border border-border p-3 space-y-3">
        <legend className="px-1 text-sm font-semibold">{label}</legend>
        {children.map((child) => (
          <FieldRow
            key={child.id}
            field={child}
            schema={schema}
            answers={answers}
            visible={visible}
            error={errors[child.id]}
            onChange={onChange}
            errors={errors}
          />
        ))}
      </fieldset>
    );
  }

  return (
    <div className="grid gap-1.5 md:grid-cols-[12rem_minmax(0,1fr)] md:items-start">
      <Label htmlFor={field.id} className="pt-2 text-sm">
        {label}
        {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      <div>
        <FieldControl field={field} value={answers[field.id]} onChange={(v) => onChange(field.id, v)} />
        {field.description ? <p className="mt-1 text-xs text-muted-foreground">{field.description}</p> : null}
        {error ? <p className="mt-1 text-xs text-destructive" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

// ── Field control (input rendering by fieldType) ──────────────────────────────

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = fieldLabel(field);

  switch (field.fieldType) {
    case 'boolean':
      return (
        <Checkbox
          id={field.id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
          aria-label={label}
        />
      );

    case 'select': {
      const current = value != null ? String(value) : '';
      return (
        <Select value={current} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={field.id} aria-label={label}>
            <SelectValue placeholder={field.placeholder ?? 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {(field.valueSetOptions ?? []).map((opt) => (
              <SelectItem key={opt.code} value={opt.code}>{opt.display}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : value != null ? [String(value)] : [];
      return (
        <div className="space-y-1">
          {(field.valueSetOptions ?? []).map((opt) => {
            const checked = selected.includes(opt.code);
            return (
              <label key={opt.code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => {
                    const next = c ? [...selected, opt.code] : selected.filter((s) => s !== opt.code);
                    onChange(next.length > 0 ? next : undefined);
                  }}
                />
                {opt.display}
              </label>
            );
          })}
        </div>
      );
    }

    case 'number': {
      return (
        <div className="flex items-center gap-2">
          <Input
            id={field.id}
            type="number"
            value={value != null ? String(value) : ''}
            placeholder={field.placeholder}
            onChange={(e) => {
              const n = e.target.value === '' ? undefined : Number(e.target.value);
              onChange(n);
            }}
            aria-label={label}
          />
          {field.unit ? <span className="text-xs text-muted-foreground">{field.unit}</span> : null}
        </div>
      );
    }

    case 'date':
      return (
        <Input
          id={field.id}
          type="date"
          value={value != null ? String(value) : ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value || undefined)}
          aria-label={label}
        />
      );

    case 'datetime':
      return (
        <Input
          id={field.id}
          type="datetime-local"
          value={value != null ? String(value) : ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value || undefined)}
          aria-label={label}
        />
      );

    case 'attachment':
      return (
        <Input
          id={field.id}
          type="file"
          onChange={(e) => onChange(e.target.files?.[0])}
          aria-label={label}
        />
      );

    // Stub types — render a basic text Input with placeholder
    case 'reference':
    case 'facility':
    case 'organism':
    case 'antibiogram':
      return (
        <Input
          id={field.id}
          type="text"
          value={value != null ? String(value) : ''}
          placeholder={field.placeholder ?? `Search ${field.fieldType}...`}
          onChange={(e) => onChange(e.target.value || undefined)}
          aria-label={label}
        />
      );

    // text, phone, email, address, identifier — all plain text inputs
    default:
      return (
        <Input
          id={field.id}
          type={field.fieldType === 'email' ? 'email' : field.fieldType === 'phone' ? 'tel' : 'text'}
          value={value != null ? String(value) : ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value || undefined)}
          aria-label={label}
        />
      );
  }
}
