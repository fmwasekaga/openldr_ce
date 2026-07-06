import type { AgeBandCompute } from './models/registry';

// 'YYYY-MM-DD' for `ref` minus `years`, computed in UTC. (Feb 29 rolls to Mar 1 — fine for age bands.)
export function minusYears(ref: Date, years: number): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear() - years, ref.getUTCMonth(), ref.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

export interface AgeBandArms {
  refYMD: string;
  arms: { thresholdYMD: string; label: string; rank: number }[]; // youngest→oldest; birth_date > thresholdYMD ⇒ this band
  openEndedLabel: string; openEndedRank: number;
  unknownLabel: string; unknownRank: number;
}

// birth_date > ref-(maxAge+1)y  ⇔  age ≤ maxAge (matches the reporting `ageBand` helper's boundaries).
export function ageBandArms(c: AgeBandCompute, ref: Date): AgeBandArms {
  const sorted = [...c.bands].sort((a, b) => a.maxAge - b.maxAge);
  return {
    refYMD: ref.toISOString().slice(0, 10),
    arms: sorted.map((b, i) => ({ thresholdYMD: minusYears(ref, b.maxAge + 1), label: b.label, rank: i })),
    openEndedLabel: c.openEndedLabel, openEndedRank: sorted.length,
    unknownLabel: c.unknownLabel, unknownRank: sorted.length + 1,
  };
}
