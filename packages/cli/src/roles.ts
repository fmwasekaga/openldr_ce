import { createAppContext, recordAuditEvent } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { CAPABILITY_KEYS } from '@openldr/rbac';
import type { RoleRecord } from '@openldr/db';
import { cliActor } from './cli-actor';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

/** Validate capability keys against the catalog BEFORE calling the store. Returns an error
 *  message for the first unknown key(s), or null when every key is known. */
function validateCaps(caps: string[]): string | null {
  const known = new Set(CAPABILITY_KEYS);
  const unknown = caps.filter((c) => !known.has(c));
  return unknown.length ? `unknown capability: ${unknown.join(', ')}` : null;
}

function parseCaps(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatRole(r: RoleRecord): string {
  const kind = r.isSystem ? 'system' : 'custom';
  const lock = r.locked ? ' locked' : '';
  return `${r.slug}\t${r.name}\t${kind}${lock}\tmembers=${r.memberCount}\tcaps=[${r.capabilities.join(', ')}]`;
}

export async function runRolesList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const roles = await ctx.roles.list();
    emit(opts.json, roles, roles.map(formatRole).join('\n') || '(no roles)');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runRolesShow(slug: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const role = await ctx.roles.getBySlug(slug);
    if (!role) {
      emit(opts.json, { error: 'role not found' }, `role ${slug} not found`);
      return 1;
    }
    emit(opts.json, role, formatRole(role));
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runRolesCreate(
  name: string,
  opts: JsonOpt & { slug?: string; desc?: string; caps?: string },
): Promise<number> {
  const capabilities = parseCaps(opts.caps);
  const capErr = validateCaps(capabilities);
  if (capErr) {
    process.stderr.write(`${capErr}\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    let created: RoleRecord;
    try {
      created = await ctx.roles.create({ name, slug: opts.slug, description: opts.desc, capabilities });
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await recordAuditEvent(ctx, cliActor(), {
      action: 'role.create',
      entityType: 'role',
      entityId: created.id,
      after: created as unknown as Record<string, unknown>,
    });
    emit(opts.json, created, `created ${created.slug} (${created.id})`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runRolesEdit(
  slug: string,
  opts: JsonOpt & { name?: string; desc?: string; caps?: string },
): Promise<number> {
  const capabilities = opts.caps !== undefined ? parseCaps(opts.caps) : undefined;
  if (capabilities) {
    const capErr = validateCaps(capabilities);
    if (capErr) {
      process.stderr.write(`${capErr}\n`);
      return 1;
    }
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.roles.getBySlug(slug);
    if (!before) {
      emit(opts.json, { error: 'role not found' }, `role ${slug} not found`);
      return 1;
    }
    let after: RoleRecord;
    try {
      after = await ctx.roles.update(before.id, { name: opts.name, description: opts.desc, capabilities });
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await recordAuditEvent(ctx, cliActor(), {
      action: 'role.update',
      entityType: 'role',
      entityId: before.id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });
    emit(opts.json, after, `updated ${after.slug} (${after.id})`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runRolesDelete(slug: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.roles.getBySlug(slug);
    if (!before) {
      emit(opts.json, { error: 'role not found' }, `role ${slug} not found`);
      return 1;
    }
    try {
      await ctx.roles.remove(before.id);
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await recordAuditEvent(ctx, cliActor(), {
      action: 'role.delete',
      entityType: 'role',
      entityId: before.id,
      before: before as unknown as Record<string, unknown>,
      after: null,
    });
    emit(opts.json, { ok: true, slug }, `deleted ${slug}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

async function grantOrRevoke(
  slug: string,
  capability: string,
  opts: JsonOpt,
  mutate: (caps: string[]) => string[],
): Promise<number> {
  const capErr = validateCaps([capability]);
  if (capErr) {
    process.stderr.write(`${capErr}\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.roles.getBySlug(slug);
    if (!before) {
      emit(opts.json, { error: 'role not found' }, `role ${slug} not found`);
      return 1;
    }
    const capabilities = mutate(before.capabilities);
    let after: RoleRecord;
    try {
      after = await ctx.roles.update(before.id, { capabilities });
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await recordAuditEvent(ctx, cliActor(), {
      action: 'role.update',
      entityType: 'role',
      entityId: before.id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });
    emit(opts.json, after, `${after.slug}: caps=[${after.capabilities.join(', ')}]`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runRolesGrant(slug: string, capability: string, opts: JsonOpt): Promise<number> {
  return grantOrRevoke(slug, capability, opts, (caps) => (caps.includes(capability) ? caps : [...caps, capability]));
}

export async function runRolesRevoke(slug: string, capability: string, opts: JsonOpt): Promise<number> {
  return grantOrRevoke(slug, capability, opts, (caps) => caps.filter((c) => c !== capability));
}

export async function runUserAssignRole(subject: string, slug: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const role = await ctx.roles.getBySlug(slug);
    if (!role) {
      emit(opts.json, { error: 'role not found' }, `role ${slug} not found`);
      return 1;
    }
    try {
      await ctx.roles.assignRole(subject, role.id);
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await recordAuditEvent(ctx, cliActor(), {
      action: 'user.role.assign',
      entityType: 'user',
      entityId: subject,
      metadata: { roleId: role.id, slug: role.slug },
    });
    emit(opts.json, { ok: true, subject, slug }, `assigned ${slug} to ${subject}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserUnassignRole(subject: string, slug: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const role = await ctx.roles.getBySlug(slug);
    if (!role) {
      emit(opts.json, { error: 'role not found' }, `role ${slug} not found`);
      return 1;
    }
    try {
      await ctx.roles.unassignRole(subject, role.id);
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await recordAuditEvent(ctx, cliActor(), {
      action: 'user.role.unassign',
      entityType: 'user',
      entityId: subject,
      metadata: { roleId: role.id, slug: role.slug },
    });
    emit(opts.json, { ok: true, subject, slug }, `unassigned ${slug} from ${subject}`);
    return 0;
  } finally {
    await ctx.close();
  }
}
