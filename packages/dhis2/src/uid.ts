import { createHash } from 'node:crypto';

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALNUM = `${ALPHA}0123456789`;

/** Deterministic DHIS2 UID (11 chars, leading letter) from a stable seed. */
export function dhis2Uid(seed: string): string {
  const h = createHash('sha256').update(seed).digest();
  let out = ALPHA[h[0] % ALPHA.length];
  for (let i = 1; i < 11; i++) out += ALNUM[h[i] % ALNUM.length];
  return out;
}
