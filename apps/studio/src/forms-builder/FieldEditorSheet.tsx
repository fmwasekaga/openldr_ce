import * as React from 'react';
import { useState, useEffect } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { FormField, FormSchema } from '@openldr/forms/pure';
import { OptionsEditor } from './field-editor/OptionsEditor';
import { CodesEditor } from './field-editor/CodesEditor';
import { TranslationsEditor } from './field-editor/TranslationsEditor';
import { MappingEditor } from './field-editor/MappingEditor';
import { VisibilityRuleEditor } from './field-editor/VisibilityRuleEditor';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

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
  onSave: (field: FormField) => void;
  onCancel: () => void;
}

export function FieldEditorSheet({
  field,
  allFields,
  sections,
  languages = [],
  open,
  onOpenChange,
  onSave,
  onCancel,
}: FieldEditorSheetProps) {
  const [draft, setDraft] = useState<FormField | null>(field);

  // Reset draft whenever the selected field changes or the sheet opens
  useEffect(() => {
    setDraft(field);
  }, [field?.id, open]);

  // When field is null, render nothing (keep Sheet closed).
  if (!field) return null;

  const patchDraft = (patch: Partial<FormField>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  const handleSave = () => {
    if (draft) onSave(draft);
  };

  const handleCancel = () => {
    onCancel();
  };

  // Closing via onOpenChange == cancel
  const handleOpenChange = (o: boolean) => {
    if (!o) onCancel();
    else onOpenChange(true);
  };

  const activeDraft = draft ?? field;
  const groupFields = allFields.filter(
    (f) => f.fieldType === 'group' && f.id !== activeDraft.id,
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="p-0 gap-0 overflow-y-auto">
        {/* ── Sheet Header ───────────────────────────────────────────── */}
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle>Edit Field</SheetTitle>
          <SheetDescription>{activeDraft.displayLabel}</SheetDescription>
        </SheetHeader>

        {/* ── General ──────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="text-sm font-medium text-foreground">General</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="Field actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleSave}>Save</DropdownMenuItem>
                <DropdownMenuItem onClick={handleCancel}>Cancel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />

          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">

            {/* Display Label */}
            <Label htmlFor="field-display-label" className="whitespace-nowrap">
              Display Label
            </Label>
            <Input
              id="field-display-label"
              aria-label="Display Label"
              value={activeDraft.displayLabel}
              onChange={(e) => patchDraft({ displayLabel: e.target.value })}
            />

            {/* Field Type */}
            <Label htmlFor="field-type-trigger" className="whitespace-nowrap">
              Field Type
            </Label>
            <Select
              value={activeDraft.fieldType}
              onValueChange={(v) =>
                patchDraft({ fieldType: v as FormField['fieldType'] })
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
              value={activeDraft.section ?? '__none'}
              onValueChange={(v) =>
                patchDraft({ section: v === '__none' ? undefined : v })
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
            {activeDraft.fieldType !== 'group' && (
              <>
                <Label htmlFor="field-group-trigger" className="whitespace-nowrap">
                  Group
                </Label>
                <div className="flex flex-col gap-1">
                  <Select
                    value={activeDraft.groupId ?? '__none'}
                    onValueChange={(v) =>
                      patchDraft({ groupId: v === '__none' ? undefined : v })
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
                  <p className="text-xs text-muted-foreground">
                    Nest this field under a Group field. Create one by setting a field&apos;s Type to Group.
                  </p>
                </div>
              </>
            )}

            {/* Placeholder */}
            <Label htmlFor="field-placeholder" className="whitespace-nowrap">
              Placeholder
            </Label>
            <Input
              id="field-placeholder"
              aria-label="Placeholder"
              value={activeDraft.placeholder ?? ''}
              onChange={(e) =>
                patchDraft({ placeholder: e.target.value || undefined })
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
              value={activeDraft.unit ?? ''}
              onChange={(e) =>
                patchDraft({ unit: e.target.value || undefined })
              }
              placeholder="e.g. mg/dL"
            />

            {/* Required + Enabled checkboxes */}
            <div className="col-span-2 flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="field-required"
                  aria-label="Required"
                  checked={activeDraft.required}
                  onCheckedChange={(checked) =>
                    patchDraft({ required: !!checked })
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
                  checked={activeDraft.enabled}
                  onCheckedChange={(checked) =>
                    patchDraft({ enabled: !!checked })
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
        {(activeDraft.fieldType === 'select' || activeDraft.fieldType === 'multiselect') && (
          <>
            <div className="border-t border-border" />
            <div className="px-6 py-3">
              <h3 className="text-sm font-medium text-foreground">Options</h3>
            </div>
            <div className="border-t border-border" />
            <div className="px-6 py-2">
              <OptionsEditor field={activeDraft} onUpdate={patchDraft} />
            </div>
          </>
        )}

        {/* ── Codes section ────────────────────────────────────────── */}
        <div className="border-t border-border" />
        <div className="px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">Codes</h3>
        </div>
        <div className="border-t border-border" />
        <div className="px-6 py-2">
          <CodesEditor field={activeDraft} onUpdate={patchDraft} />
        </div>

        {/* ── Translations section ─────────────────────────────────── */}
        <div className="border-t border-border" />
        <div className="px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">Translations</h3>
        </div>
        <div className="border-t border-border" />
        <div className="px-6 py-2">
          <TranslationsEditor field={activeDraft} languages={languages} onUpdate={patchDraft} />
        </div>

        {/* ── Mapping / FHIR section ──────────────────────────────── */}
        <div className="border-t border-border" />
        <div className="px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">Mapping</h3>
        </div>
        <div className="border-t border-border" />
        <div className="px-6 py-2">
          <MappingEditor field={activeDraft} onUpdate={patchDraft} />
        </div>

        {/* ── Visibility / conditions section ─────────────────────── */}
        <div className="border-t border-border" />
        <div className="px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">Visibility</h3>
        </div>
        <div className="border-t border-border" />
        <div className="px-6 py-2">
          <VisibilityRuleEditor
            field={activeDraft}
            allFields={allFields}
            onUpdate={patchDraft}
          />
        </div>

      </SheetContent>
    </Sheet>
  );
}
