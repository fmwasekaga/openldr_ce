import * as React from 'react';
import type { FormField } from '@openldr/forms/pure';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export interface TranslationsEditorProps {
  field: FormField;
  languages: string[];
  onUpdate: (patch: Partial<FormField>) => void;
}

/**
 * Renders the "Translations" section of the Edit Field sheet.
 *
 * For each locale in `languages`, renders a labelled input bound to
 * `field.translations?.[locale]?.label`. Updates are immutably merged so
 * other locales and the existing `description` for the same locale are
 * preserved.
 */
export function TranslationsEditor({
  field,
  languages,
  onUpdate,
}: TranslationsEditorProps): JSX.Element {
  function handleLabelChange(locale: string, value: string): void {
    onUpdate({
      translations: {
        ...field.translations,
        [locale]: {
          ...field.translations?.[locale],
          label: value,
        },
      },
    });
  }

  return (
    <section className="mt-2">
      {languages.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4">
          No translation languages yet. Add one with the language control in the
          form header.
        </p>
      ) : (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4">
          {languages.map((locale) => {
            const inputId = `translations-${locale}-label`;
            const ariaLabel = `${locale} label`;
            return (
              <React.Fragment key={locale}>
                <Label htmlFor={inputId} className="whitespace-nowrap font-mono text-xs uppercase">
                  {locale}
                </Label>
                <Input
                  id={inputId}
                  aria-label={ariaLabel}
                  value={field.translations?.[locale]?.label ?? ''}
                  onChange={(e) => handleLabelChange(locale, e.target.value)}
                  placeholder={`Label in ${locale}`}
                />
              </React.Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
}
