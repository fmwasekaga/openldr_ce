/** Documentation version. Sourced from the app's package version (injected via Vite
 * `define` as __APP_VERSION__), so docs track product releases. The version-named
 * content folder (./<version>/<locale>/<slug>.md) is how docs are "versioned with the
 * product"; the registry falls back to the latest authored version when an exact folder
 * for this release doesn't exist yet, so newer releases are never left without docs.
 * The `typeof` guard keeps this defined in any environment where the define is absent. */
export const DOCS_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';

/** Compare two dotted version strings; returns >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
