export interface PublisherPrefixes {
  id: string;
  matchPrefixes: string[];
}

/**
 * Resolve the owning publisher for a canonical URL by LONGEST-prefix match, so a
 * more specific prefix (e.g. http://hl7.org/fhir/sid/icd-10) wins over a broader
 * one (http://hl7.org/fhir/). Returns null when nothing matches — the caller falls
 * back to the local publisher. (Ported from corlix terminologyPublishers.ts.)
 */
export function resolvePublisher<T extends PublisherPrefixes>(url: string, publishers: T[]): T | null {
  const u = url.trim();
  let best: T | null = null;
  let bestLen = -1;
  for (const p of publishers) {
    for (const prefix of p.matchPrefixes) {
      if (prefix.length > 0 && u.startsWith(prefix) && prefix.length > bestLen) {
        best = p;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}
