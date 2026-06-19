import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { FormField, FormSchema, FormSection, RuntimeAnswers } from './types';
import { cleanAnswers, fieldLabel, groupChildren, validate, visibleIds } from './runtime';

// ── Public component ──────────────────────────────────────────────────────────

export function FormRuntime({
  schema,
  submitLabel = '',
  onSubmit,
  footer,
  initialAnswers,
  fieldWarnings,
  formId,
}: {
  schema: FormSchema;
  submitLabel?: string;
  onSubmit: (answers: RuntimeAnswers) => void | Promise<void>;
  footer?: React.ReactNode;
  initialAnswers?: RuntimeAnswers;
  /** @deprecated No longer used to render markers in preview; kept for API compatibility. */
  fieldWarnings?: Record<string, 'error' | 'warning'>;
  formId?: string;
}): JSX.Element {
  const [answers, setAnswers] = useState<RuntimeAnswers>(initialAnswers ?? {});
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

  // Top-level visible fields (excluding group children, which are rendered inside their group).
  const topLevelFields = useMemo(
    () =>
      schema.fields
        .filter((f) => visible.has(f.id) && !f.groupId)
        .sort((a, b) => a.order - b.order),
    [schema.fields, visible],
  );

  // Determine whether to use section grouping.
  // We group when the schema has sections defined OR any field has a section assigned.
  const hasSections = useMemo(
    () =>
      (schema.sections && schema.sections.length > 0) ||
      schema.fields.some((f) => f.section),
    [schema.sections, schema.fields],
  );

  // Build section groups: ordered by section.order, then unsectioned fields at the end.
  const sectionGroups = useMemo(() => {
    if (!hasSections) return null;

    const orderedSections: FormSection[] = (schema.sections ?? [])
      .slice()
      .sort((a, b) => a.order - b.order);

    // Collect any section ids from fields that aren't in schema.sections
    const knownSectionIds = new Set(orderedSections.map((s) => s.id));
    const extraSectionIds: string[] = [];
    for (const f of topLevelFields) {
      if (f.section && !knownSectionIds.has(f.section) && !extraSectionIds.includes(f.section)) {
        extraSectionIds.push(f.section);
      }
    }
    const extraSections: FormSection[] = extraSectionIds.map((id, i) => ({
      id,
      label: id,
      order: orderedSections.length + i,
    }));
    const allSections = [...orderedSections, ...extraSections];

    const groups: Array<{ key: string; label: string | null; fields: FormField[] }> = [];

    for (const section of allSections) {
      const sectionFields = topLevelFields.filter((f) => f.section === section.id);
      if (sectionFields.length === 0) continue;
      groups.push({ key: section.id, label: section.label ?? section.id, fields: sectionFields });
    }

    // Unsectioned fields (no section or unknown section)
    const sectionedFieldIds = new Set(groups.flatMap((g) => g.fields.map((f) => f.id)));
    const unsectioned = topLevelFields.filter((f) => !sectionedFieldIds.has(f.id));
    if (unsectioned.length > 0) {
      groups.push({ key: '__no_section__', label: null, fields: unsectioned });
    }

    return groups;
  }, [hasSections, schema.sections, topLevelFields]);

  function renderFieldRows(fields: FormField[]) {
    return fields.map((field) => (
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
    ));
  }

  return (
    <TooltipProvider>
    <form
      id={formId}
      className="grid gap-0"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {sectionGroups ? (
        <>
          {sectionGroups.map(({ key, label, fields }) => (
            <div key={key} className="border-t border-border first:border-t-0">
              {label !== null && (
                <div className="px-6 pt-4 pb-1 mb-1 border-b border-border">
                  <span className="text-sm font-semibold text-foreground">{label}</span>
                </div>
              )}
              <div className="grid gap-4 px-6 py-4">
                {renderFieldRows(fields)}
              </div>
            </div>
          ))}
        </>
      ) : (
        <div className="grid gap-4 px-6 py-4">
          {renderFieldRows(topLevelFields)}
        </div>
      )}
      {footer === undefined ? (
        <div className="px-6 pb-4">
          <Button type="submit">{submitLabel}</Button>
        </div>
      ) : footer}
    </form>
    </TooltipProvider>
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
      <Label htmlFor={field.id} className="pt-2 text-sm flex items-center gap-1 flex-wrap">
        {label}
        {field.required && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground cursor-default"
                aria-label="Required"
              >
                !
              </span>
            </TooltipTrigger>
            <TooltipContent>Required</TooltipContent>
          </Tooltip>
        )}
        {field.description ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground cursor-default"
                aria-label={field.description}
              >
                ?
              </span>
            </TooltipTrigger>
            <TooltipContent>{field.description}</TooltipContent>
          </Tooltip>
        ) : null}
      </Label>
      <div>
        <FieldControl field={field} value={answers[field.id]} onChange={(v) => onChange(field.id, v)} />
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
          <SelectTrigger id={field.id} className="w-full" aria-label={label}>
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
