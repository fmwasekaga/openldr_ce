import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appCtx: {
    validationStrictness: { get: vi.fn(), set: vi.fn() },
    featureFlags: { get: vi.fn(), set: vi.fn() },
    numberSettings: { get: vi.fn(), set: vi.fn() },
    appSettings: {},
    encryptSecret: vi.fn(),
    close: vi.fn(),
  },
  createAppContext: vi.fn(),
  recordAuditEvent: vi.fn(),
  getSyncConfig: vi.fn(),
  setSyncConfig: vi.fn(),
  dangerResetDashboards: vi.fn(),
  dangerFactoryReset: vi.fn(),
  dangerClearAudit: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
  recordAuditEvent: mocks.recordAuditEvent,
  dangerResetDashboards: mocks.dangerResetDashboards,
  dangerFactoryReset: mocks.dangerFactoryReset,
  dangerClearAudit: mocks.dangerClearAudit,
  getSyncConfig: mocks.getSyncConfig,
  setSyncConfig: mocks.setSyncConfig,
}));

import {
  runSettingsValidationShow,
  runSettingsValidationSet,
  runSettingsFlagsSet,
  runSettingsNumbersSet,
  runSettingsSyncSet,
  runSettingsDanger,
} from './settings';

describe('settings validation — show', () => {
  let out: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.validationStrictness.get.mockResolvedValue('high');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the current level (default high)', async () => {
    const code = await runSettingsValidationShow({ json: false });

    expect(code).toBe(0);
    expect(out).toContain('high');
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });

  it('emits JSON when --json is passed', async () => {
    await runSettingsValidationShow({ json: true });

    expect(JSON.parse(out)).toEqual({ strictness: 'high' });
  });
});

describe('settings validation — set', () => {
  let out: string;
  let err: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.validationStrictness.get.mockResolvedValue('high');
    mocks.appCtx.validationStrictness.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists a valid level via the validation-strictness accessor', async () => {
    const code = await runSettingsValidationSet('medium', { json: false });

    expect(code).toBe(0);
    expect(mocks.appCtx.validationStrictness.set).toHaveBeenCalledWith('medium', 'cli');
    expect(out).toContain('medium');
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });

  it('records an audit event at parity with the HTTP route', async () => {
    await runSettingsValidationSet('medium', { json: false });

    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'settings.validation_strictness',
        entityType: 'app_setting',
        entityId: 'validation.strictness',
        // HTTP route (settings-routes.ts) records before/after as top-level fields, not metadata.
        before: { strictness: 'high' },
        after: { strictness: 'medium' },
      }),
    );
  });

  it('rejects an invalid level without persisting or auditing', async () => {
    const code = await runSettingsValidationSet('bogus', { json: false });

    expect(code).not.toBe(0);
    expect(mocks.appCtx.validationStrictness.set).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(err).toContain('bogus');
  });

  it('never even builds the app context for an invalid level', async () => {
    await runSettingsValidationSet('bogus', { json: false });

    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });
});

describe('settings flags — set audit parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.featureFlags.get.mockResolvedValue(false);
    mocks.appCtx.featureFlags.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records settings.flag.update as the cli actor, matching the HTTP route metadata', async () => {
    const code = await runSettingsFlagsSet('some.flag', 'true', { json: false });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'settings.flag.update',
        entityType: 'app_setting',
        entityId: 'some.flag',
        metadata: { key: 'some.flag', before: false, after: true },
      }),
    );
  });
});

describe('settings numbers — set audit parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.numberSettings.get.mockResolvedValue(5);
    mocks.appCtx.numberSettings.set.mockResolvedValue(10);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records settings.number.update including before, matching the HTTP route', async () => {
    const code = await runSettingsNumbersSet('some.number', '10', { json: false });

    expect(code).toBe(0);
    expect(mocks.appCtx.numberSettings.get).toHaveBeenCalledWith('some.number');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'settings.number.update',
        entityType: 'app_setting',
        entityId: 'some.number',
        metadata: { key: 'some.number', before: 5, after: 10 },
      }),
    );
  });

  it('tolerates a before-read failure (unknown key) the same as the HTTP route', async () => {
    mocks.appCtx.numberSettings.get.mockRejectedValue(new Error('unknown number setting "some.number"'));

    const code = await runSettingsNumbersSet('some.number', '10', { json: false });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        metadata: { key: 'some.number', before: null, after: 10 },
      }),
    );
  });
});

describe('settings sync — set audit parity', () => {
  const current = { enabled: false, mode: 'lab', centralUrl: '', siteId: 's1', clientSecretSet: false, signingKeySet: false } as any;
  const saved = { ...current, enabled: true };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.getSyncConfig.mockResolvedValue(current);
    mocks.setSyncConfig.mockResolvedValue(saved);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records settings.sync.update with {before, after} only — no extra "field" key, matching the HTTP route', async () => {
    const code = await runSettingsSyncSet('enabled', 'true', { json: false });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'settings.sync.update',
        entityType: 'app_setting',
        entityId: 'sync.*',
        metadata: { before: current, after: saved },
      }),
    );
  });
});

describe('settings danger — audit parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.dangerClearAudit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records settings.danger.<action> with metadata { action, ok: true }, matching the HTTP route', async () => {
    const code = await runSettingsDanger('clear-audit', { json: false, force: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'settings.danger.clear-audit',
        entityType: 'app_settings',
        entityId: 'internal-db',
        metadata: { action: 'clear-audit', ok: true },
      }),
    );
  });
});
