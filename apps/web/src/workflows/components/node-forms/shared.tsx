import type { TextareaHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const inputClass =
  'mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-muted-foreground/50 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20';
export const labelClass =
  'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

export function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">{hint}</p>
      )}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={cn(inputClass, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputClass, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputClass, props.className)} />;
}

/**
 * A text input that hints at templating support — used wherever a field
 * accepts `{{ $json.foo }}` substitution.
 */
export function ExpressionInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FormField label={typeof props['aria-label'] === 'string' ? props['aria-label'] : 'Value'} hint="Templates: {{ $json.foo }} or {{ $node('id').0.json.bar }}">
      <TextInput {...props} placeholder={props.placeholder ?? '{{ $json.body }}'} />
    </FormField>
  );
}
