import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  termCtx: {
    ops: {},
    admin: {
      publishers: { create: vi.fn(), list: vi.fn() },
      codingSystems: { create: vi.fn(), list: vi.fn() },
      terms: { search: vi.fn() },
      valueSets: { list: vi.fn() },
    },
    ontology: {
      unlink: vi.fn(),
      build: vi.fn(),
      rebuild: vi.fn(),
      getDistribution: vi.fn(),
      listDistributions: vi.fn(),
    },
    loaders: {
      loinc: vi.fn(),
      amr: vi.fn(),
      resource: vi.fn(),
    },
    audit: {},
    logger: {},
    close: vi.fn(),
  },
  createTerminologyContext: vi.fn(),
  recordAuditEvent: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createTerminologyContext: mocks.createTerminologyContext,
  recordAuditEvent: mocks.recordAuditEvent,
}));

vi.mock('node:fs', () => ({
  readFileSync: mocks.readFileSync,
}));

import {
  runTerminologyImport,
  runPublisherCreate,
  runSystemCreate,
  runOntologyUnlink,
  runOntologyBuild,
} from './terminology';

describe('terminology CLI audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.createTerminologyContext.mockResolvedValue(mocks.termCtx);
    mocks.termCtx.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('terminology import loinc audits coding_system.import (entityId "loinc"), matching the HTTP route', async () => {
    const result = { conceptsLoaded: 5 };
    mocks.termCtx.loaders.loinc.mockResolvedValue(result);

    const code = await runTerminologyImport('loinc', '/some/dir', { acceptLicense: true, json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.termCtx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'coding_system.import',
        entityType: 'coding_system',
        entityId: 'loinc',
        metadata: { source: 'loinc', result },
      }),
    );
  });

  it('terminology import resource audits term.import (entityId = imported system url)', async () => {
    const result = { system: 'http://example.org/CodeSystem/x', conceptsLoaded: 3, resourceUrl: 'http://example.org/CodeSystem/x' };
    mocks.termCtx.loaders.resource.mockResolvedValue(result);
    // readFileSync(path) is invoked inside runTerminologyImport to build the resource JSON argument
    // before loaders.resource (mocked above) is called.
    mocks.readFileSync.mockReturnValue('{}');

    const code = await runTerminologyImport('resource', '/some/file.json', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.termCtx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'term.import',
        entityType: 'term',
        entityId: 'http://example.org/CodeSystem/x',
        metadata: { result },
      }),
    );
  });

  it('terminology import amr audits coding_system.import (entityId "amr") — no HTTP twin, flagged', async () => {
    const result = [{ system: 'whonet-organism', conceptsLoaded: 2, resourceUrl: 'whonet-organism' }];
    mocks.termCtx.loaders.amr.mockResolvedValue(result);

    const code = await runTerminologyImport('amr', '/some/amr.sqlite', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.termCtx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'coding_system.import',
        entityType: 'coding_system',
        entityId: 'amr',
        metadata: { source: 'amr', result },
      }),
    );
  });

  it('does not audit a failed import', async () => {
    mocks.termCtx.loaders.loinc.mockRejectedValue(new Error('boom'));

    const code = await runTerminologyImport('loinc', '/some/dir', { json: true });

    expect(code).toBe(1);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('publisher create audits publisher.create', async () => {
    const created = { id: 'pub1', name: 'Acme', role: 'local', seeded: false };
    mocks.termCtx.admin.publishers.create.mockResolvedValue(created);

    const code = await runPublisherCreate('Acme', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.termCtx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'publisher.create',
        entityType: 'publisher',
        entityId: 'pub1',
        metadata: { name: 'Acme' },
      }),
    );
  });

  it('system create audits coding_system.create', async () => {
    const created = { id: 'sys1', systemCode: 'LOINC', systemName: 'LOINC' };
    mocks.termCtx.admin.codingSystems.create.mockResolvedValue(created);

    const code = await runSystemCreate('LOINC', 'LOINC', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.termCtx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'coding_system.create',
        entityType: 'coding_system',
        entityId: 'sys1',
        metadata: { systemCode: 'LOINC' },
      }),
    );
  });

  it('ontology unlink audits ontology_distribution.delete', async () => {
    mocks.termCtx.ontology.unlink.mockResolvedValue(undefined);

    const code = await runOntologyUnlink('sys1', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.termCtx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'ontology_distribution.delete',
        entityType: 'ontology_distribution',
        entityId: 'sys1',
        metadata: {},
      }),
    );
  });

  it('does not audit ontology build (no HTTP audit twin)', async () => {
    mocks.termCtx.ontology.build.mockResolvedValue(undefined);
    mocks.termCtx.ontology.getDistribution.mockResolvedValue({ ontologyType: 'tree', nodeCount: 1, edgeCount: 0 });

    const code = await runOntologyBuild('sys1', '/some/dir', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});
