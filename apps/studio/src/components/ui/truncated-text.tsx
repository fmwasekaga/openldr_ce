import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

export interface TruncatedTextProps {
  /** The full text to render (and truncate). */
  text: string;
  className?: string;
  /** Element type for the truncating node. Defaults to 'span'. */
  as?: 'span' | 'div';
  /** Tooltip side, when shown. Defaults to 'top'. */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Renders single-line truncated text and shows a tooltip with the full text
 * ONLY when the text is actually clipped (scrollWidth > clientWidth). Never
 * shows a tooltip when the text fits — avoids the "tooltip on everything"
 * anti-pattern.
 *
 * Self-contained: wraps itself in its own TooltipProvider so it works
 * anywhere without requiring an ancestor provider (Radix allows nested
 * providers, so this is safe to nest inside a page that already has one).
 */
export function TruncatedText({ text, className, as = 'span', side = 'top' }: TruncatedTextProps): JSX.Element {
  const elRef = useRef<HTMLElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [truncated, setTruncated] = useState(false);

  const measure = useCallback(() => {
    const el = elRef.current;
    if (el) setTruncated(el.scrollWidth > el.clientWidth);
  }, []);

  // Callback ref (not a plain useRef): when `truncated` flips false→true the
  // returned root changes (bare node → TooltipTrigger tree), so React unmounts
  // the original element and mounts a NEW one inside the trigger. A callback ref
  // re-runs on that swap — attach(null) disconnects the observer on the old
  // (now-detached) node, then attach(newEl) observes the currently-mounted one —
  // so resize tracking keeps working after the first truncation. measure() sets
  // state to the actual overflow for the current width, so it's stable for a
  // given width (React bails on same-state, no oscillation).
  const attach = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    elRef.current = el;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, [measure]);

  // The callback ref only re-runs on mount/unmount, not when `text` changes on
  // the same mounted node — re-measure here so a new value is checked for clip.
  useEffect(() => { measure(); }, [text, measure]);

  const node = as === 'div'
    ? <div ref={attach} className={cn('block truncate', className)}>{text}</div>
    : <span ref={attach} className={cn('block truncate', className)}>{text}</span>;

  if (!truncated) return node;

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side={side}>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
