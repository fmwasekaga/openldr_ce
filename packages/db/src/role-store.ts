import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { OpenLdrError } from '@openldr/core';
import { CAPABILITY_KEYS, SYSTEM_ROLES, slugify } from '@openldr/rbac';
import type { InternalSchema } from './schema/internal';

export interface RoleRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  locked: boolean;
  capabilities: string[];
  memberCount: number;
}

export interface CreateRoleInput {
  name: string;
  slug?: string;
  description?: string | null;
  capabilities: string[];
}
export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  capabilities?: string[];
}

export interface RoleStore {
  list(): Promise<RoleRecord[]>;
  get(id: string): Promise<RoleRecord | null>;
  getBySlug(slug: string): Promise<RoleRecord | null>;
  create(input: CreateRoleInput): Promise<RoleRecord>;
  update(id: string, patch: UpdateRoleInput): Promise<RoleRecord>;
  remove(id: string): Promise<void>;
  resolveCapabilities(subject: string): Promise<string[]>;
  rolesForUser(subject: string): Promise<RoleRecord[]>;
  assignRole(subject: string, roleId: string): Promise<void>;
  unassignRole(subject: string, roleId: string): Promise<void>;
  setUserRoles(subject: string, roleIds: string[]): Promise<void>;
  seedSystemRoles(): Promise<void>;
  backfillUserFromRoleNames(subject: string, roleNames: string[]): Promise<void>;
}

const LOCKED_SLUG = 'lab_admin';

function validateCaps(caps: string[]): void {
  const known = new Set(CAPABILITY_KEYS);
  for (const c of caps) if (!known.has(c)) throw new OpenLdrError(`unknown capability: ${c}`);
}

export function createRoleStore(db: Kysely<InternalSchema>): RoleStore {
  async function capsFor(roleId: string): Promise<string[]> {
    const rows = await db.selectFrom('role_capabilities').select('capability').where('role_id', '=', roleId).execute();
    return rows.map((r) => r.capability);
  }
  async function memberCount(roleId: string): Promise<number> {
    const r = await db
      .selectFrom('user_roles')
      .select(db.fn.countAll<string>().as('n'))
      .where('role_id', '=', roleId)
      .executeTakeFirst();
    return Number(r?.n ?? 0);
  }
  async function toRecord(row: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    is_system: boolean;
  }): Promise<RoleRecord> {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      isSystem: Boolean(row.is_system),
      locked: row.slug === LOCKED_SLUG,
      capabilities: await capsFor(row.id),
      memberCount: await memberCount(row.id),
    };
  }
  async function getRow(id: string) {
    return db.selectFrom('roles').select(['id', 'slug', 'name', 'description', 'is_system']).where('id', '=', id).executeTakeFirst();
  }

  // Count distinct users whose union of role caps includes `roles.manage`.
  async function manageHolderCount(): Promise<number> {
    const rows = await db
      .selectFrom('user_roles')
      .innerJoin('role_capabilities', 'role_capabilities.role_id', 'user_roles.role_id')
      .select('user_roles.user_id')
      .where('role_capabilities.capability', '=', 'roles.manage')
      .groupBy('user_roles.user_id')
      .execute();
    return rows.length;
  }
  async function userHasManageWithout(subject: string, excludeRoleId: string): Promise<boolean> {
    const rows = await db
      .selectFrom('user_roles')
      .innerJoin('role_capabilities', 'role_capabilities.role_id', 'user_roles.role_id')
      .select('role_capabilities.capability')
      .where('user_roles.user_id', '=', subject)
      .where('user_roles.role_id', '!=', excludeRoleId)
      .where('role_capabilities.capability', '=', 'roles.manage')
      .execute();
    return rows.length > 0;
  }

  async function writeCaps(roleId: string, caps: string[]): Promise<void> {
    await db.deleteFrom('role_capabilities').where('role_id', '=', roleId).execute();
    if (caps.length) {
      await db.insertInto('role_capabilities').values(caps.map((c) => ({ role_id: roleId, capability: c }))).execute();
    }
  }

  const store: RoleStore = {
    async list() {
      const rows = await db
        .selectFrom('roles')
        .select(['id', 'slug', 'name', 'description', 'is_system'])
        .orderBy('is_system', 'desc')
        .orderBy('name')
        .execute();
      return Promise.all(rows.map(toRecord));
    },
    async get(id) {
      const r = await getRow(id);
      return r ? toRecord(r) : null;
    },
    async getBySlug(slug) {
      const r = await db.selectFrom('roles').select(['id', 'slug', 'name', 'description', 'is_system']).where('slug', '=', slug).executeTakeFirst();
      return r ? toRecord(r) : null;
    },
    async create(input) {
      validateCaps(input.capabilities);
      const slug = (input.slug && slugify(input.slug)) || slugify(input.name);
      if (!slug) throw new OpenLdrError('role slug cannot be empty');
      const id = randomUUID();
      await db.insertInto('roles').values({ id, slug, name: input.name, description: input.description ?? null, is_system: false }).execute();
      await writeCaps(id, input.capabilities);
      return (await store.get(id))!;
    },
    async update(id, patch) {
      const row = await getRow(id);
      if (!row) throw new OpenLdrError(`role ${id} not found`);
      if (row.slug === LOCKED_SLUG) throw new OpenLdrError('the Administrator role cannot be modified');
      if (patch.capabilities) validateCaps(patch.capabilities);
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.description !== undefined) set.description = patch.description;
      await db.updateTable('roles').set(set).where('id', '=', id).execute();
      if (patch.capabilities) await writeCaps(id, patch.capabilities);
      return (await store.get(id))!;
    },
    async remove(id) {
      const row = await getRow(id);
      if (!row) return;
      if (row.is_system) throw new OpenLdrError('system roles cannot be deleted');
      // Guard: don't orphan roles.manage globally.
      const caps = await capsFor(id);
      if (caps.includes('roles.manage')) {
        const others = await db
          .selectFrom('role_capabilities')
          .select('role_id')
          .where('capability', '=', 'roles.manage')
          .where('role_id', '!=', id)
          .execute();
        if (others.length === 0) throw new OpenLdrError('cannot delete the last role granting roles.manage');
      }
      await db.deleteFrom('role_capabilities').where('role_id', '=', id).execute();
      await db.deleteFrom('user_roles').where('role_id', '=', id).execute();
      await db.deleteFrom('roles').where('id', '=', id).execute();
    },
    async resolveCapabilities(subject) {
      const rows = await db
        .selectFrom('user_roles')
        .innerJoin('role_capabilities', 'role_capabilities.role_id', 'user_roles.role_id')
        .select('role_capabilities.capability')
        .where('user_roles.user_id', '=', subject)
        .execute();
      return [...new Set(rows.map((r) => r.capability))];
    },
    async rolesForUser(subject) {
      const rows = await db
        .selectFrom('user_roles')
        .innerJoin('roles', 'roles.id', 'user_roles.role_id')
        .select(['roles.id', 'roles.slug', 'roles.name', 'roles.description', 'roles.is_system'])
        .where('user_roles.user_id', '=', subject)
        .execute();
      return Promise.all(rows.map(toRecord));
    },
    async assignRole(subject, roleId) {
      await db
        .insertInto('user_roles')
        .values({ user_id: subject, role_id: roleId })
        .onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing())
        .execute();
    },
    async unassignRole(subject, roleId) {
      const caps = await capsFor(roleId);
      if (caps.includes('roles.manage')) {
        const stillHasViaOther = await userHasManageWithout(subject, roleId);
        if (!stillHasViaOther && (await manageHolderCount()) <= 1) {
          throw new OpenLdrError('cannot remove the last user holding roles.manage');
        }
      }
      await db.deleteFrom('user_roles').where('user_id', '=', subject).where('role_id', '=', roleId).execute();
    },
    async setUserRoles(subject, roleIds) {
      // Guard computed BEFORE any mutation. We deliberately do not rely on
      // "write, check, throw-to-rollback" inside a transaction: pg-mem (the
      // harness backing these tests) does not roll back on a thrown error —
      // an insert inside trx.execute() that later throws still persists — so
      // a post-write rollback strategy is both untestable and, on any backend,
      // leaves a transient window where the invariant is violated. Instead we
      // determine up front whether the new role set would leave the system
      // with zero roles.manage holders and reject before touching the table.
      const newRoleCaps = await Promise.all(roleIds.map((id) => capsFor(id)));
      const subjectWillHaveManage = newRoleCaps.some((caps) => caps.includes('roles.manage'));
      if (!subjectWillHaveManage) {
        const otherHolders = await db
          .selectFrom('user_roles')
          .innerJoin('role_capabilities', 'role_capabilities.role_id', 'user_roles.role_id')
          .select('user_roles.user_id')
          .where('role_capabilities.capability', '=', 'roles.manage')
          .where('user_roles.user_id', '!=', subject)
          .groupBy('user_roles.user_id')
          .execute();
        if (otherHolders.length === 0) {
          throw new OpenLdrError('this change would leave no user able to manage roles');
        }
      }
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('user_roles').where('user_id', '=', subject).execute();
        if (roleIds.length) {
          await trx.insertInto('user_roles').values(roleIds.map((r) => ({ user_id: subject, role_id: r }))).execute();
        }
      });
    },
    async seedSystemRoles() {
      for (const def of SYSTEM_ROLES) {
        const existing = await store.getBySlug(def.slug);
        if (existing) continue;
        const id = randomUUID();
        await db.insertInto('roles').values({ id, slug: def.slug, name: def.name, description: def.description, is_system: true }).execute();
        await writeCaps(id, def.capabilities);
      }
    },
    async backfillUserFromRoleNames(subject, roleNames) {
      for (const name of roleNames) {
        const role = await store.getBySlug(name);
        if (role) await store.assignRole(subject, role.id);
      }
    },
  };

  return store;
}
