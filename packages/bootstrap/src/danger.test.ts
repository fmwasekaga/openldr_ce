import { describe, it, expect } from 'vitest';
import { buildTruncateSql, RESERVED_TABLES } from './danger';

describe('danger truncate SQL builder', () => {
  it('excludes kysely migration bookkeeping tables', () => {
    expect(RESERVED_TABLES).toContain('kysely_migration');
    expect(RESERVED_TABLES).toContain('kysely_migration_lock');
  });

  it('builds a CASCADE TRUNCATE over the given tables, quoted', () => {
    const sql = buildTruncateSql(['dashboards', 'audit_events']);
    expect(sql).toBe('TRUNCATE "dashboards", "audit_events" RESTART IDENTITY CASCADE');
  });

  it('returns null for an empty table list (nothing to truncate)', () => {
    expect(buildTruncateSql([])).toBeNull();
  });
});
