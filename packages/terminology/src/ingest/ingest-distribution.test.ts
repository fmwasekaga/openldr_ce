import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestDistribution } from './ingest-distribution';

describe('ingestDistribution (loinc)', () => {
  it('loads concepts then builds the ontology over the same dir, summing progress', async () => {
    const phases: string[] = [];
    const deps = {
      loadConcepts: vi.fn(async () => ({ conceptsLoaded: 42 })),
      buildOntology: vi.fn(async (_s: string, _id: string, _d: string, onP: (p: any) => void) => { onP({ phase: 'ontology:tree', processed: 10, total: 10 }); }),
      buildOntologyWithConcepts: vi.fn(),
    };
    const res = await ingestDistribution({
      systemType: 'loinc', codingSystemId: 'cs1', distDir: '/tmp/dist', acceptLicense: true,
      deps, onProgress: (p) => phases.push(p.phase),
    });
    expect(res.conceptsLoaded).toBe(42);
    expect(deps.loadConcepts).toHaveBeenCalledWith('loinc', '/tmp/dist', { acceptLicense: true });
    expect(deps.buildOntology).toHaveBeenCalledWith('loinc', 'cs1', '/tmp/dist', expect.any(Function));
    expect(phases).toContain('concepts');
    expect(phases).toContain('ontology:tree');
    expect(deps.loadConcepts.mock.invocationCallOrder[0]).toBeLessThan(deps.buildOntology.mock.invocationCallOrder[0]);
  });

  it('dispatches snomed/rxnorm to buildOntologyWithConcepts (one teed parse)', async () => {
    const deps = {
      loadConcepts: vi.fn(),
      buildOntology: vi.fn(),
      buildOntologyWithConcepts: vi.fn(async () => ({ conceptsLoaded: 321 })),
    };
    const res = await ingestDistribution({ systemType: 'snomed', codingSystemId: 'cs1', distDir: '/d', acceptLicense: true, deps: deps as never, onProgress: () => {} });
    expect(res.conceptsLoaded).toBe(321);
    expect(deps.buildOntologyWithConcepts).toHaveBeenCalledWith('snomed', 'cs1', '/d', expect.any(Function));
    expect(deps.loadConcepts).not.toHaveBeenCalled();
  });

  it('unwraps a single release-folder wrapper so the loaders get the real root (real LOINC zips wrap under Loinc_x/)', async () => {
    const wrap = await mkdtemp(join(tmpdir(), 'ing-'));
    const inner = join(wrap, 'Loinc_2.82');
    await cp(join(__dirname, '..', 'ontology', 'adapters', '__fixtures__', 'loinc'), inner, { recursive: true });
    const deps = { loadConcepts: vi.fn(async () => ({ conceptsLoaded: 1 })), buildOntology: vi.fn(), buildOntologyWithConcepts: vi.fn() };
    await ingestDistribution({ systemType: 'loinc', codingSystemId: 'cs1', distDir: wrap, acceptLicense: true, deps: deps as never, onProgress: () => {} });
    // both loaders receive the descended `inner` dir, not the wrapper `wrap`.
    expect(deps.loadConcepts).toHaveBeenCalledWith('loinc', inner, { acceptLicense: true });
    expect(deps.buildOntology).toHaveBeenCalledWith('loinc', 'cs1', inner, expect.any(Function));
  });

  it('loinc still runs loadConcepts + buildOntology (no tee)', async () => {
    const deps = { loadConcepts: vi.fn(async () => ({ conceptsLoaded: 42 })), buildOntology: vi.fn(), buildOntologyWithConcepts: vi.fn() };
    const res = await ingestDistribution({ systemType: 'loinc', codingSystemId: 'cs1', distDir: '/d', acceptLicense: true, deps: deps as never, onProgress: () => {} });
    expect(res.conceptsLoaded).toBe(42);
    expect(deps.buildOntology).toHaveBeenCalled();
    expect(deps.buildOntologyWithConcepts).not.toHaveBeenCalled();
  });

  it('rejects a genuinely unknown system type', async () => {
    const deps = { loadConcepts: vi.fn(), buildOntology: vi.fn(), buildOntologyWithConcepts: vi.fn() };
    await expect(ingestDistribution({ systemType: 'nope', codingSystemId: 'x', distDir: '/d', acceptLicense: true, deps: deps as never, onProgress: () => {} })).rejects.toThrow(/unsupported/i);
  });

  it('requires license acceptance', async () => {
    const deps = { loadConcepts: vi.fn(), buildOntology: vi.fn(), buildOntologyWithConcepts: vi.fn() };
    await expect(ingestDistribution({ systemType: 'loinc', codingSystemId: 'x', distDir: '/d', acceptLicense: false, deps: deps as never, onProgress: () => {} }))
      .rejects.toThrow(/license/i);
    expect(deps.loadConcepts).not.toHaveBeenCalled();
  });
});
