import type { TranslatableText, FormSchema } from './schema/form-schema';

export type Lang = 'en' | 'fr' | 'pt';

/** Resolve text in the requested language, falling back to English. */
export function resolveText(text: TranslatableText, lang: Lang): string {
  return text[lang] ?? text.en;
}

/** The set of languages any text in the form provides. */
export function deriveLanguages(form: FormSchema): Lang[] {
  const langs = new Set<Lang>(['en']);
  const visit = (t: TranslatableText) => {
    if (t.fr) langs.add('fr');
    if (t.pt) langs.add('pt');
  };
  visit(form.title);
  for (const s of form.sections) {
    visit(s.title);
    for (const f of s.fields) {
      visit(f.label);
      for (const o of f.options ?? []) visit(o.display);
    }
  }
  return [...langs];
}
