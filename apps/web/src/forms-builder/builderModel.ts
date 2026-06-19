import type { FormField, FormSchema, FormSection, FieldType } from '@openldr/forms/pure';

export function slugify(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return slug || 'item';
}

export function createDefaultFormSchema(name: string): FormSchema {
  const id = slugify(name);
  return {
    id,
    name,
    title: { en: name },
    status: 'active',
    languages: ['en'],
    sections: [{ id: 'main', title: { en: 'Main' }, fields: [] }],
  };
}

export function newSection(label: string): FormSection {
  return { id: slugify(label), title: { en: label }, fields: [] };
}

export function newField(label: string, type: FieldType): FormField {
  return { id: slugify(label), type, label: { en: label }, enabled: true };
}

export function reindexFields<T extends FormField>(fields: T[]): T[] {
  return fields.map((field) => ({ ...field }));
}
