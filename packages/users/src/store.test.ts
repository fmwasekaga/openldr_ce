import { describe, it, expect } from 'vitest';
import type { TokenClaims } from '@openldr/ports';
import type { User } from './store';

const mk = (over: Partial<User>): User => ({ id: over.id ?? 'id', subject: over.subject ?? null, username: over.username ?? 'u', displayName: null, email: null, roles: [], status: 'active', lastLoginAt: null });

// Mirror of createUserStore.syncFromClaims resolution, to lock the by-subject -> by-username-link -> create contract.
async function resolve(
  claims: TokenClaims,
  lk: { bySubject(s: string): User | undefined; byUsername(u: string): User | undefined; create(u: string): User; link(id: string, sub: string): void },
): Promise<User> {
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!sub) throw new Error('missing sub');
  const username = (typeof claims.preferred_username === 'string' && claims.preferred_username) || sub;
  const bySub = lk.bySubject(sub);
  if (bySub) return bySub;
  const byName = lk.byUsername(username);
  if (byName) { lk.link(byName.id, sub); return { ...byName, subject: sub }; }
  const created = lk.create(username);
  lk.link(created.id, sub);
  return { ...created, subject: sub };
}

describe('syncFromClaims resolution', () => {
  it('throws on a missing sub', async () => {
    await expect(resolve({} as TokenClaims, { bySubject: () => undefined, byUsername: () => undefined, create: () => mk({}), link: () => {} })).rejects.toThrow(/sub/);
  });
  it('returns the subject match unchanged', async () => {
    const u = mk({ id: 's1', subject: 'kc-1', username: 'op' });
    const out = await resolve({ sub: 'kc-1' } as TokenClaims, { bySubject: () => u, byUsername: () => undefined, create: () => mk({}), link: () => { throw new Error('should not link'); } });
    expect(out.id).toBe('s1');
  });
  it('links the subject onto a username match', async () => {
    const u = mk({ id: 'u1', subject: null, username: 'op' });
    const linked: string[] = [];
    const out = await resolve({ sub: 'kc-9', preferred_username: 'op' } as TokenClaims, { bySubject: () => undefined, byUsername: () => u, create: () => mk({}), link: (id, s) => linked.push(`${id}:${s}`) });
    expect(out.subject).toBe('kc-9');
    expect(linked).toEqual(['u1:kc-9']);
  });
  it('creates when neither matches', async () => {
    const created: string[] = [];
    const out = await resolve({ sub: 'kc-7', preferred_username: 'new' } as TokenClaims, { bySubject: () => undefined, byUsername: () => undefined, create: (u) => { created.push(u); return mk({ id: 'n1', username: u }); }, link: () => {} });
    expect(created).toEqual(['new']);
    expect(out.subject).toBe('kc-7');
  });
});
