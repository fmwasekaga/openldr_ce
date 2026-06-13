import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runUserList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const users = await ctx.users.list();
    emit(
      opts.json,
      users,
      users.map((u) => `  ${u.id.slice(0, 8)}  ${u.username.padEnd(16)} ${u.status.padEnd(9)} [${u.roles.join(', ')}]${u.subject ? ' sub=' + u.subject : ''}`).join('\n') || '  (no users)',
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserShow(id: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const u = await ctx.users.get(id);
    if (!u) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    emit(opts.json, u, `${u.username} (${u.id}) status=${u.status} roles=[${u.roles.join(', ')}] sub=${u.subject ?? '-'}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserCreate(opts: JsonOpt & { username: string; name?: string; email?: string; role?: string[] }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const u = await ctx.users.create({ username: opts.username, displayName: opts.name, email: opts.email, roles: opts.role });
    emit(opts.json, u, `created ${u.username} (${u.id})`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserSetRole(id: string, roles: string[], opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (!(await ctx.users.get(id))) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    await ctx.users.setRoles(id, roles);
    emit(opts.json, { id, roles }, `set roles for ${id}: [${roles.join(', ')}]`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runUserSetStatus(id: string, status: 'active' | 'disabled', opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (!(await ctx.users.get(id))) {
      emit(opts.json, { error: 'user not found' }, `user ${id} not found`);
      return 1;
    }
    await ctx.users.setStatus(id, status);
    emit(opts.json, { id, status }, `${id} is now ${status}`);
    return 0;
  } finally {
    await ctx.close();
  }
}
