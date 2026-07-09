import { useEffect, useRef, useState } from 'react';
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
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = as === 'div' ? divRef.current : spanRef.current;
    if (!el) return;
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, as]);

  const node = as === 'div'
    ? <div ref={divRef} className={cn('block truncate', className)}>{text}</div>
    : <span ref={spanRef} className={cn('block truncate', className)}>{text}</span>;

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
