import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appCtx: {
    dashboards: {
      columnPolicy: {
        listHidden: vi.fn(),
        replaceTable: vi.fn(),
      },
      reloadColumnPolicy: vi.fn(),
    },
    close: vi.fn(),
  },
  createAppContext: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
  recordAuditEvent: mocks.recordAuditEvent,
}));

import { runDataExposureList, runDataExposureHide, runDataExposureShow } from './data-exposure';

describe('data-exposure list', () => {
  let out: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.dashboards.columnPolicy.listHidden.mockResolvedValue({ patients: ['national_id'] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the hidden-column map and closes the context', async () => {
    const code = await runDataExposureList({ json: false });

    expect(code).toBe(0);
    expect(out).toContain('patients');
    expect(out).toContain('national_id');
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });

  it('emits JSON when --json is passed', async () => {
    await runDataExposureList({ json: true });

    expect(JSON.parse(out)).toEqual({ patients: ['national_id'] });
  });
});

describe('data-exposure hide', () => {
  let out: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.dashboards.columnPolicy.listHidden.mockResolvedValue({ patients: [] });
    mocks.appCtx.dashboards.columnPolicy.replaceTable.mockResolvedValue(undefined);
    mocks.appCtx.dashboards.reloadColumnPolicy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds columns to a table policy (merged onto the existing hidden set)', async () => {
    const code = await runDataExposureHide('patients', ['national_id'], { json: false });

    expect(code).toBe(0);
    expect(mocks.appCtx.dashboards.columnPolicy.replaceTable).toHaveBeenCalledWith(
      'patients',
      expect.arrayContaining(['national_id']),
      expect.anything(),
    );
    expect(mocks.appCtx.dashboards.reloadColumnPolicy).toHaveBeenCalled();
    expect(out).toContain('national_id');
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });

  it('records an audit event at parity with the HTTP route', async () => {
    await runDataExposureHide('patients', ['national_id'], { json: false });

    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'data_exposure.policy.updated',
        entityType: 'column_exposure_policy',
        entityId: 'global',
      }),
    );
  });

  it('merges onto an existing hidden set instead of clobbering it', async () => {
    mocks.appCtx.dashboards.columnPolicy.listHidden.mockResolvedValue({ patients: ['dob'] });

    await runDataExposureHide('patients', ['national_id'], { json: false });

    const [, hiddenArg] = mocks.appCtx.dashboards.columnPolicy.replaceTable.mock.calls[0];
    expect(new Set(hiddenArg)).toEqual(new Set(['dob', 'national_id']));
  });

  it('emits JSON with the resulting hidden set', async () => {
    await runDataExposureHide('patients', ['national_id'], { json: true });

    expect(JSON.parse(out)).toEqual({ table: 'patients', hidden: ['national_id'] });
  });
});

describe('data-exposure show', () => {
  let out: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.dashboards.columnPolicy.listHidden.mockResolvedValue({ patients: ['national_id', 'dob'] });
    mocks.appCtx.dashboards.columnPolicy.replaceTable.mockResolvedValue(undefined);
    mocks.appCtx.dashboards.reloadColumnPolicy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes columns from a table policy', async () => {
    const code = await runDataExposureShow('patients', ['national_id'], { json: false });

    expect(code).toBe(0);
    expect(mocks.appCtx.dashboards.columnPolicy.replaceTable).toHaveBeenCalledWith(
      'patients',
      expect.not.arrayContaining(['national_id']),
      expect.anything(),
    );
    const [, hiddenArg] = mocks.appCtx.dashboards.columnPolicy.replaceTable.mock.calls[0];
    expect(hiddenArg).toContain('dob');
    expect(mocks.appCtx.dashboards.reloadColumnPolicy).toHaveBeenCalled();
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });

  it('records an audit event at parity with the HTTP route', async () => {
    await runDataExposureShow('patients', ['national_id'], { json: false });

    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'data_exposure.policy.updated',
        entityType: 'column_exposure_policy',
        entityId: 'global',
      }),
    );
  });
});

describe('data-exposure mutate — error path', () => {
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
    mocks.appCtx.dashboards.columnPolicy.listHidden.mockResolvedValue({ patients: [] });
    mocks.appCtx.dashboards.columnPolicy.replaceTable.mockRejectedValue(
      new Error('not a governed table: bogus_table'),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 1 and skips reload/audit when replaceTable rejects', async () => {
    const code = await runDataExposureHide('bogus_table', ['national_id'], { json: false });

    expect(code).toBe(1);
    expect(err).toContain('not a governed table: bogus_table');
    expect(mocks.appCtx.dashboards.reloadColumnPolicy).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });
});
