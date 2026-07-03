/** Returns a function mapping a value in [d0,d1] to [r0,r1]. Zero-width domain → constant r0. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (span === 0) return () => r0;
  const k = (r1 - r0) / span;
  return (v: number) => r0 + (v - d0) * k;
}

/** Ascending "nice" ticks from 0 (or `min`) to at least `max`, ~`count` steps, rounded to a 1/2/5×10ⁿ step. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min, min + 1];
  const raw = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t < max + step; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}
