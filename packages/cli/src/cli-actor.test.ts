import { afterEach, describe, expect, it } from 'vitest';
import { cliActor, setActorOverride } from './cli-actor';

afterEach(() => setActorOverride(undefined));

describe('cliActor', () => {
  it('is actor_type cli with the OS user by default', () => {
    const a = cliActor();
    expect(a.actorType).toBe('cli');
    expect(a.actorId).toBeNull();
    expect(typeof a.actorName).toBe('string');
    expect(a.actorName.length).toBeGreaterThan(0);
  });
  it('uses the --actor override when set', () => {
    setActorOverride('release-bot');
    expect(cliActor().actorName).toBe('release-bot');
  });
  it('ignores a blank override', () => {
    setActorOverride('   ');
    expect(cliActor().actorName).not.toBe('');
  });
});
