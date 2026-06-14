// Mask secrets so they never reach logs / health detail / CLI error output (P1-NFR-2, P2-HARD-3).
// Pattern-based: needs no knowledge of the actual secret values. For value-based masking
// of known loaded secrets, compose with makeRedactor().
export function redact(text: string): string {
  return text
    // URL userinfo: scheme://user:password@host  ->  scheme://user:***@host (all occurrences, the /g flag)
    .replace(/(\/\/[^\s:@/]+:)[^\s@]+(@)/g, '$1***$2')
    // Authorization: Basic <b64> | Bearer <token>  ->  Authorization: <scheme> ***
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)[^\s'"]+/gi, '$1***')
    // connection-string credential params: password=... / pwd=...  (terminated by ; & whitespace quote or end)
    .replace(/((?:password|pwd)\s*=\s*)[^\s;&'"]+/gi, '$1***');
}

/**
 * Build a value-based redactor over the actual loaded secret values. Masks any literal
 * occurrence of a non-empty secret anywhere in a string. Longest-first so a secret that is a
 * substring of another doesn't leave a partial leak; empty/whitespace secrets are ignored.
 */
export function makeRedactor(secrets: string[]): (text: string) => string {
  const real = Array.from(new Set(secrets.filter((s) => typeof s === 'string' && s.trim().length > 0)))
    .sort((a, b) => b.length - a.length);
  if (real.length === 0) return (text) => text;
  const escaped = real.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(escaped.join('|'), 'g');
  return (text: string) => text.replace(re, '***');
}
