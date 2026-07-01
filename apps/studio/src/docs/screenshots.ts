// Bundled documentation screenshots, keyed by bare filename (e.g. `dashboard.png`).
// PNGs live in 0.1.0/screenshots/ and are emitted as hashed assets by Vite. Markdown
// references them by basename — ![alt](dashboard.png) — resolved through this map.
// The glob is an empty object until the first screenshot is committed (Task 9).
const urls = import.meta.glob('./0.1.0/screenshots/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

export const SCREENSHOTS: Record<string, string> = Object.fromEntries(
  Object.entries(urls).map(([p, url]) => [p.split('/').pop() ?? p, url]),
);

export function makeResolver(map: Record<string, string>) {
  return function resolveImg(src: string): string | null {
    if (/^https?:\/\//.test(src) || src.startsWith('/')) return src;
    return map[src] ?? null;
  };
}

export const resolveImg = makeResolver(SCREENSHOTS);
