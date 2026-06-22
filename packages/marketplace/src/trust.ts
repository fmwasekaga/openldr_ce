export type TrustDecision =
  | { decision: 'first-use' }
  | { decision: 'trusted' }
  | { decision: 'key-mismatch'; pinned: string };

export interface PinnedPublisher { keyFingerprint: string }

export interface TrustStore {
  get(publisherId: string): Promise<PinnedPublisher | undefined>;
  pin(input: { publisherId: string; keyFingerprint: string; publisherName: string; approvedBy: string | null }): Promise<void>;
}

/** Trust-on-first-use decision: pure, no I/O. */
export function evaluateTrust(_publisherId: string, fingerprint: string, pinned: PinnedPublisher | undefined): TrustDecision {
  if (!pinned) return { decision: 'first-use' };
  if (pinned.keyFingerprint === fingerprint) return { decision: 'trusted' };
  return { decision: 'key-mismatch', pinned: pinned.keyFingerprint };
}
