/**
 * True when the viewport is phone-width (below Tailwind's `md` breakpoint, 768px).
 *
 * Used to pick a mobile-first initial state for split-pane screens (Query, Reports, Report
 * Designer, Docs) so their side panels start collapsed and the main content gets the full width.
 * Guards `matchMedia` because it is absent in the jsdom test environment and during SSR.
 */
export function isNarrowViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767px)').matches
  );
}
