import * as React from 'react';
import type { FormField, FormSchema } from '@openldr/forms/pure';
import { OptionsEditor } from './field-editor/OptionsEditor';
import { CodesEditor } from './field-editor/CodesEditor';
import { TranslationsEditor } from './field-editor/TranslationsEditor';
import { MappingEditor } from './field-editor/MappingEditor';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// All 17 field types in the order they appear in the FieldType enum.
const FIELD_TYPES: { value: string; label: string }[] = [
  { value: 'text',        label: 'text' },
  { value: 'number',      label: 'number' },
  { value: 'date',        label: 'date' },
  { value: 'datetime',    label: 'datetime' },
  { value: 'boolean',     label: 'boolean' },
  { value: 'select',      label: 'select' },
  { value: 'multiselect', label: 'multiselect' },
  { value: 'phone',       label: 'phone' },
  { value: 'email',       label: 'email' },
  { value: 'address',     label: 'address' },
  { value: 'identifier',  label: 'identifier' },
  { value: 'attachment',  label: 'attachment' },
  { value: 'organism',    label: 'organism' },
  { value: 'antibiogram', label: 'antibiogram' },
  { value: 'reference',   label: 'reference' },
  { value: 'facility',    label: 'facility' },
  { value: 'group',       label: 'group' },
];

export interface FieldEditorSheetProps {
  field: FormField | null;
  allFields: FormField[];
  sections: FormSchema['sections'];
  languages?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (patch: Partial<FormField>) => void;
}

export function FieldEditorSheet({
  field,
  allFields,
  sections,
  languages = [],
  open,
  onOpenChange,
  onUpdate,
}: FieldEditorSheetProps) {
  // When field is null, render nothing (keep Sheet closed).
  if (!field) return null;

  const groupFields = allFields.filter(
    (f) => f.fieldType === 'group' && f.id !== field.id,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit Field</SheetTitle>
          <SheetDescription>{field.displayLabel}</SheetDescription>
        </SheetHeader>

        {/* ── General ──────────────────────────────────────────────── */}
        <section className="mt-4">
          <h3 className="text-sm font-medium text-foreground pb-2 border-b border-border">
            General
          </h3>

          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4">

            {/* Display Label */}
            <Label htmlFor="field-display-label" className="whitespace-nowrap">
              Display Label
            </Label>
            <Input
              id="field-display-label"
              aria-label="Display Label"
              value={field.displayLabel}
              onChange={(e) => onUpdate({ displayLabel: e.target.value })}
            />

            {/* Field Type */}
            <Label htmlFor="field-type-trigger" className="whitespace-nowrap">
              Field Type
            </Label>
            <Select
              value={field.fieldType}
              onValueChange={(v) =>
                onUpdate({ fieldType: v as FormField['fieldType'] })
              }
            >
              <SelectTrigger id="field-type-trigger" aria-label="Field Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((ft) => (
                  <SelectItem key={ft.value} value={ft.value}>
                    {ft.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Section */}
            <Label htmlFor="field-section-trigger" className="whitespace-nowrap">
              Section
            </Label>
            <Select
              value={field.section ?? '__none'}
              onValueChange={(v) =>
                onUpdate({ section: v === '__none' ? undefined : v })
              }
            >
              <SelectTrigger id="field-section-trigger" aria-label="Section">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No section</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Group (hidden when the field itself is a group) */}
            {field.fieldType !== 'group' && (
              <>
                <Label htmlFor="field-group-trigger" className="whitespace-nowrap">
                  Group
                </Label>
                <Select
                  value={field.groupId ?? '__none'}
                  onValueChange={(v) =>
                    onUpdate({ groupId: v === '__none' ? undefined : v })
                  }
                >
                  <SelectTrigger id="field-group-trigger" aria-label="Group">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No group</SelectItem>
                    {groupFields.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.displayLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {/* Placeholder */}
            <Label htmlFor="field-placeholder" className="whitespace-nowrap">
              Placeholder
            </Label>
            <Input
              id="field-placeholder"
              aria-label="Placeholder"
              value={field.placeholder ?? ''}
              onChange={(e) =>
                onUpdate({ placeholder: e.target.value || undefined })
              }
              placeholder="Hint text"
            />

            {/* Unit */}
            <Label htmlFor="field-unit" className="whitespace-nowrap">
              Unit
            </Label>
            <Input
              id="field-unit"
              aria-label="Unit"
              value={field.unit ?? ''}
              onChange={(e) =>
                onUpdate({ unit: e.target.value || undefined })
              }
              placeholder="e.g. mg/dL"
            />

            {/* Required + Enabled checkboxes */}
            <div className="col-span-2 flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="field-required"
                  aria-label="Required"
                  checked={field.required}
                  onCheckedChange={(checked) =>
                    onUpdate({ required: !!checked })
                  }
                />
                <Label htmlFor="field-required" className="text-xs">
                  Required
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="field-enabled"
                  aria-label="Enabled"
                  checked={field.enabled}
                  onCheckedChange={(checked) =>
                    onUpdate({ enabled: !!checked })
                  }
                />
                <Label htmlFor="field-enabled" className="text-xs">
                  Enabled
                </Label>
              </div>
            </div>
          </div>
        </section>

        {/* ── Options / Value-set section ──────────────────────────── */}
        {(field.fieldType === 'select' || field.fieldType === 'multiselect') && (
          <OptionsEditor field={field} onUpdate={onUpdate} />
        )}

        {/* ── Codes section ────────────────────────────────────────── */}
        <CodesEditor field={field} onUpdate={onUpdate} />

        {/* ── Translations section ─────────────────────────────────── */}
        <TranslationsEditor field={field} languages={languages} onUpdate={onUpdate} />

        {/* ── Mapping / FHIR section ──────────────────────────────── */}
        <MappingEditor field={field} onUpdate={onUpdate} />

        {/* ── TODO Task 6: Visibility / conditions section ─────────── */}
      </SheetContent>
    </Sheet>
  );
}
