import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface ListOpts {
  actor?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  json: boolean;
}

export async function runAuditList(opts: ListOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = await ctx.audit.list({
      actorId: opts.actor,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      from: opts.from,
      to: opts.to,
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    } else {
      const lines = rows.map((r) => `  ${r.occurredAt}  ${r.actorName.padEnd(10)} ${r.action.padEnd(22)} ${r.entityType}/${r.entityId}`);
      process.stdout.write((lines.length ? lines.join('\n') : '  (no events)') + '\n');
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
