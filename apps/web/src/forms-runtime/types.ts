export type RuntimeAnswerValue =
  | string
  | number
  | boolean
  | { code: string; display?: string; system?: string }
  | { value?: number; unit?: string };

export type RuntimeAnswers = Record<string, RuntimeAnswerValue | RuntimeAnswerValue[]>;

export interface RuntimeFormSchema {
  id: string;
  name: string;
  title: { en: string; fr?: string; pt?: string };
  sections: RuntimeSection[];
}

export interface RuntimeSection {
  id: string;
  title: { en: string; fr?: string; pt?: string };
  repeats?: boolean;
  fields: RuntimeField[];
}

export interface RuntimeField {
  id: string;
  type: 'string' | 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'dateTime' | 'choice' | 'open-choice' | 'reference' | 'quantity';
  label: { en: string; fr?: string; pt?: string };
  required?: boolean;
  repeats?: boolean;
  cardinality?: { min?: number; max?: number };
  options?: Array<{ code: string; display: { en: string; fr?: string; pt?: string }; system?: string }>;
  visibility?: { whenField: string; equals: string | number | boolean };
  unit?: string;
  placeholder?: { en: string; fr?: string; pt?: string };
  helpText?: { en: string; fr?: string; pt?: string };
}
