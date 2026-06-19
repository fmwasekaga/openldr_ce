import { randomUUID } from 'node:crypto';
import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { TokenClaims } from '@openldr/ports';

export interface User {
  id: string;
  subject: string | null;
  username: string;
  displayName: string | null;
  email: string | null;
  roles: string[];
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface CreateUserInput {
  username: string;
  displayName?: string;
  email?: string;
  roles?: string[];
}

export interface UpdateUserInput {
  displayName?: string | null;
  email?: string | null;
}

export interface UserStore {
  create(input: CreateUserInput): Promise<User>;
  get(id: string): Promise<User | undefined>;
  getBySubject(subject: string): Promise<User | undefined>;
  getByUsername(username: string): Promise<User | undefined>;
  list(): Promise<User[]>;
  update(id: string, input: UpdateUserInput): Promise<void>;
  setRoles(id: string, roles: string[]): Promise<void>;
  setStatus(id: string, status: 'active' | 'disabled'): Promise<void>;
  /**
   * Just-in-time provision/link from verified token claims: resolve by subject,
   * else link the subject onto a username match, else create. Does NOT change
   * `status` — a disabled user stays disabled. The caller (auth layer) MUST
   * reject the returned user when `status === 'disabled'`; this never reactivates.
   */
  syncFromClaims(claims: TokenClaims): Promise<User>;
}

interface Row {
  id: string;
  subject: string | null;
  username: string;
  display_name: string | null;
  email: string | null;
  roles: unknown;
  status: string;
  last_login_at: Date | null;
  created_at: Date | null;
}

function toUser(r: Row): User {
  return {
    id: r.id,
    subject: r.subject,
    username: r.username,
    displayName: r.display_name,
    email: r.email,
    roles: Array.isArray(r.roles) ? (r.roles as string[]) : [],
    status: r.status === 'disabled' ? 'disabled' : 'active',
    lastLoginAt: r.last_login_at instanceof Date ? r.last_login_at.toISOString() : (r.last_login_at as string | null),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at as string | null),
  };
}

const COLS = ['id', 'subject', 'username', 'display_name', 'email', 'roles', 'status', 'last_login_at', 'created_at'] as const;

export function createUserStore(db: Kysely<InternalSchema>): UserStore {
  async function get(id: string): Promise<User | undefined> {
    const r = await db.selectFrom('users').select(COLS).where('id', '=', id).executeTakeFirst();
    return r ? toUser(r as unknown as Row) : undefined;
  }
  async function getBySubject(subject: string): Promise<User | undefined> {
    const r = await db.selectFrom('users').select(COLS).where('subject', '=', subject).executeTakeFirst();
    return r ? toUser(r as unknown as Row) : undefined;
  }
  async function getByUsername(username: string): Promise<User | undefined> {
    const r = await db.selectFrom('users').select(COLS).where('username', '=', username).executeTakeFirst();
    return r ? toUser(r as unknown as Row) : undefined;
  }
  async function create(input: CreateUserInput): Promise<User> {
    const id = randomUUID();
    await db
      .insertInto('users')
      .values({
        id,
        username: input.username,
        display_name: input.displayName ?? null,
        email: input.email ?? null,
        roles: JSON.stringify(input.roles ?? []) as never,
      })
      .execute();
    return (await get(id))!;
  }

  return {
    create,
    get,
    getBySubject,
    getByUsername,
    async list() {
      const rows = await db.selectFrom('users').select(COLS).orderBy('username').execute();
      return rows.map((r) => toUser(r as unknown as Row));
    },
    async update(id, input) {
      const set: { display_name?: string | null; email?: string | null; updated_at: Date } = { updated_at: new Date() };
      if ('displayName' in input) set.display_name = input.displayName ?? null;
      if ('email' in input) set.email = input.email ?? null;
      await db.updateTable('users').set(set).where('id', '=', id).execute();
    },
    async setRoles(id, roles) {
      await db.updateTable('users').set({ roles: JSON.stringify(roles) as never, updated_at: new Date() }).where('id', '=', id).execute();
    },
    async setStatus(id, status) {
      await db.updateTable('users').set({ status, updated_at: new Date() }).where('id', '=', id).execute();
    },
    async syncFromClaims(claims) {
      const sub = typeof claims.sub === 'string' ? claims.sub : '';
      if (!sub) throw new Error('syncFromClaims: missing sub claim');
      const username =
        (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
        (typeof claims.email === 'string' && claims.email) ||
        sub;
      const now = new Date();

      const existing = await getBySubject(sub);
      if (existing) {
        await db.updateTable('users').set({ last_login_at: now, updated_at: now }).where('id', '=', existing.id).execute();
        return { ...existing, lastLoginAt: now.toISOString() };
      }
      const byName = await getByUsername(username);
      if (byName) {
        await db.updateTable('users').set({ subject: sub, last_login_at: now, updated_at: now }).where('id', '=', byName.id).execute();
        return { ...byName, subject: sub, lastLoginAt: now.toISOString() };
      }
      const u = await create({
        username,
        displayName: typeof claims.name === 'string' ? claims.name : undefined,
        email: typeof claims.email === 'string' ? claims.email : undefined,
      });
      await db.updateTable('users').set({ subject: sub, last_login_at: now, updated_at: now }).where('id', '=', u.id).execute();
      return { ...u, subject: sub, lastLoginAt: now.toISOString() };
    },
  };
}
