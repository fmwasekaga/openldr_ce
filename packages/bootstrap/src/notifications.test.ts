import { describe, it, expect } from 'vitest';
import {
  syncRowToNotification,
  auditRowToNotification,
  passesPrefs,
  PRIORITY_RANK,
} from './notifications';

describe('syncRowToNotification', () => {
  const base = { id: 's1', occurredAt: '2026-07-20T10:00:00.000Z', direction: 'push' as const, records: 3, error: 'boom', metadata: null };

  it('maps diverged → critical, links to sync settings', () => {
    const n = syncRowToNotification({ ...base, event: 'diverged' })!;
    expect(n).toMatchObject({ id: 'sync:s1', type: 'sync_diverged', priority: 'critical', linkTo: '/settings/sync', createdAt: base.occurredAt });
  });

  it('maps failed → warning → /activity, carries error into body', () => {
    const n = syncRowToNotification({ ...base, event: 'failed' })!;
    expect(n).toMatchObject({ type: 'sync_failed', priority: 'warning', linkTo: '/activity' });
    expect(n.body).toContain('boom');
  });

  it('maps quarantined → warning', () => {
    expect(syncRowToNotification({ ...base, event: 'quarantined' })!.type).toBe('sync_quarantined');
  });

  it('drops successful syncs', () => {
    expect(syncRowToNotification({ ...base, event: 'synced' })).toBeNull();
  });
});

describe('auditRowToNotification', () => {
  const base = { id: 'a1', occurredAt: '2026-07-20T11:00:00.000Z', actorType: 'system' as const, actorId: null, actorName: 'System', entityType: 'auth', entityId: 'expired', before: null, after: null, metadata: undefined };

  it('maps a security-relevant auth.failed → warning → /audit', () => {
    const n = auditRowToNotification({ ...base, action: 'auth.failed', entityId: 'invalid' })!;
    expect(n).toMatchObject({ id: 'audit:a1', type: 'auth_failed', priority: 'warning', linkTo: '/audit' });
  });

  it('suppresses benign self-expiry auth.failed (reason "expired") from notifications', () => {
    // by entityId (the reason)…
    expect(auditRowToNotification({ ...base, action: 'auth.failed', entityId: 'expired' })).toBeNull();
    // …and by metadata.reason (defensive; both are set by the recorder).
    expect(auditRowToNotification({ ...base, action: 'auth.failed', entityId: 'auth', metadata: { reason: 'expired' } })).toBeNull();
    // a non-expired reason still notifies.
    expect(auditRowToNotification({ ...base, action: 'auth.failed', entityId: 'bad-signature' })).not.toBeNull();
  });

  it('maps plugin.crash → critical → /activity', () => {
    expect(auditRowToNotification({ ...base, action: 'plugin.crash', entityType: 'plugin' })!).toMatchObject({ type: 'plugin_crashed', priority: 'critical', linkTo: '/activity' });
  });

  it('maps system.crash and system.crash_loop → plugin_crashed/critical', () => {
    expect(auditRowToNotification({ ...base, action: 'system.crash' })!.priority).toBe('critical');
    expect(auditRowToNotification({ ...base, action: 'system.crash_loop' })!.type).toBe('plugin_crashed');
  });

  it('maps settings.sync.revoke → site_revoked/warning → /settings/sites', () => {
    expect(auditRowToNotification({ ...base, action: 'settings.sync.revoke', entityType: 'sync_site', entityId: 'lab-7' })!).toMatchObject({ type: 'site_revoked', priority: 'warning', linkTo: '/settings/sites' });
  });

  it('drops unrelated audit actions', () => {
    expect(auditRowToNotification({ ...base, action: 'settings.sync.enroll' })).toBeNull();
    expect(auditRowToNotification({ ...base, action: 'report.run' })).toBeNull();
  });

  it('maps terminology.import.completed to a notification', () => {
    const n = auditRowToNotification({ id: 'a1', occurredAt: '2026-07-20T00:00:00.000Z', actorType: 'system', actorId: null, actorName: 'System', action: 'terminology.import.completed', entityType: 'coding_system', entityId: 'http://loinc.org', metadata: { systemType: 'loinc', conceptsLoaded: 42 } } as never);
    expect(n?.type).toBe('terminology_import_done');
    expect(n?.priority).toBe('info');
  });

  it('maps terminology.import.failed to a warning notification', () => {
    const n = auditRowToNotification({ id: 'a2', occurredAt: '2026-07-20T00:00:00.000Z', actorType: 'system', actorId: null, actorName: 'System', action: 'terminology.import.failed', entityType: 'coding_system', entityId: 'http://loinc.org', metadata: { error: 'boom' } } as never);
    expect(n?.type).toBe('terminology_import_failed');
    expect(n?.priority).toBe('warning');
  });
});

describe('passesPrefs', () => {
  const n = { id: 'x', type: 'sync_failed', priority: 'warning', title: '', body: null, linkTo: null, createdAt: '', readAt: null, metadata: null } as const;

  it('drops a type that is explicitly disabled', () => {
    expect(passesPrefs(n, new Set(['sync_failed']), 'info')).toBe(false);
    expect(passesPrefs(n, new Set(), 'info')).toBe(true);
  });

  it('drops priorities below the floor', () => {
    expect(passesPrefs(n, new Set(), 'critical')).toBe(false); // warning < critical
    expect(passesPrefs(n, new Set(), 'warning')).toBe(true);
  });

  it('PRIORITY_RANK orders info < warning < critical', () => {
    expect(PRIORITY_RANK.info).toBeLessThan(PRIORITY_RANK.warning);
    expect(PRIORITY_RANK.warning).toBeLessThan(PRIORITY_RANK.critical);
  });
});
