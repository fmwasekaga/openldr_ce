import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appCtx: {
    validationStrictness: { get: vi.fn(), set: vi.fn() },
    audit: { record: vi.fn() },
    close: vi.fn(),
  },
  createAppContext: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
  dangerResetDashboards: vi.fn(),
  dangerFactoryReset: vi.fn(),
  dangerClearAudit: vi.fn(),
  getSyncConfig: vi.fn(),
  setSyncConfig: vi.fn(),
}));

import { runSettingsValidationShow, runSettingsValidationSet } from './settings';

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

    expect(mocks.appCtx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.validation_strictness',
        entityType: 'app_setting',
        entityId: 'validation.strictness',
      }),
    );
  });

  it('rejects an invalid level without persisting or auditing', async () => {
    const code = await runSettingsValidationSet('bogus', { json: false });

    expect(code).not.toBe(0);
    expect(mocks.appCtx.validationStrictness.set).not.toHaveBeenCalled();
    expect(mocks.appCtx.audit.record).not.toHaveBeenCalled();
    expect(err).toContain('bogus');
  });

  it('never even builds the app context for an invalid level', async () => {
    await runSettingsValidationSet('bogus', { json: false });

    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });
});
