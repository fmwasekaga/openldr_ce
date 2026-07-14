import { describe, expect, it } from 'vitest';
import { shouldStartPush, shouldStartPull } from './index';

// The if (syncCfg) block in makeAppContext gates each direction's worker construct+start behind these
// predicates, so unit-testing them is a faithful assertion of the mode-gating wiring. bidirectional runs
// both; push runs only push; pull runs only pull.
describe('sync worker mode gating', () => {
  it("mode 'push' starts push only", () => {
    expect(shouldStartPush('push')).toBe(true);
    expect(shouldStartPull('push')).toBe(false);
  });

  it("mode 'pull' starts pull only", () => {
    expect(shouldStartPush('pull')).toBe(false);
    expect(shouldStartPull('pull')).toBe(true);
  });

  it("mode 'bidirectional' starts both directions", () => {
    expect(shouldStartPush('bidirectional')).toBe(true);
    expect(shouldStartPull('bidirectional')).toBe(true);
  });
});
