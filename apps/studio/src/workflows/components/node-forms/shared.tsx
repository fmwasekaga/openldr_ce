import {
  Children,
  isValidElement,
  type ReactNode,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select as ShSelect,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

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
  return <Input {...props} type={props.type ?? 'text'} className={cn('mt-1.5', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Textarea {...props} className={cn('mt-1.5', props.className)} />;
}

type Opt = { value: string; label: ReactNode; disabled?: boolean };

/** Flatten `<option>` children (including those nested in fragments/arrays) into a list. */
function collectOptions(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
      // Native <select> semantics: an <option> with no `value` uses its text as the value
      // (e.g. `<option>POST</option>` → "POST"). Without this fallback such options collapsed to
      // "" and got filtered out as the placeholder, leaving method dropdowns (webhook/HTTP) blank.
      // An EXPLICIT `value=""` is preserved as the placeholder, per this component's convention.
      const label = props.children;
      out.push({
        value: props.value != null ? String(props.value) : (typeof label === 'string' ? label : ''),
        label,
        disabled: props.disabled,
      });
    } else {
      const nested = (child.props as { children?: ReactNode })?.children;
      if (nested) out.push(...collectOptions(nested));
    }
  });
  return out;
}

/**
 * shadcn-backed Select with a native-style API so existing call sites
 * (value + event-style onChange + `<option>` children) work unchanged.
 *
 * A leading `<option value="">…</option>` becomes the trigger placeholder, since
 * Radix forbids an empty-string SelectItem value.
 */
export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const opts = collectOptions(children);
  const placeholderOpt = opts.find((o) => o.value === '');
  const items = opts.filter((o) => o.value !== '');
  const current = value == null ? '' : String(value);
  const placeholder =
    typeof placeholderOpt?.label === 'string' ? placeholderOpt.label : 'Select…';
  return (
    <ShSelect
      value={current === '' ? undefined : current}
      onValueChange={(v) => onChange?.({ target: { value: v } } as never)}
      disabled={disabled}
    >
      <SelectTrigger className={cn('mt-1.5 w-full', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((o, i) => (
          <SelectItem key={`${o.value}-${i}`} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShSelect>
  );
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
