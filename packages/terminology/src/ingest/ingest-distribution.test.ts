import { describe, it, expect, vi } from 'vitest';
import { ingestDistribution } from './ingest-distribution';

describe('ingestDistribution (loinc)', () => {
  it('loads concepts then builds the ontology over the same dir, summing progress', async () => {
    const phases: string[] = [];
    const deps = {
      loadConcepts: vi.fn(async () => ({ conceptsLoaded: 42 })),
      buildOntology: vi.fn(async (_s: string, _id: string, _d: string, onP: (p: any) => void) => { onP({ phase: 'ontology:tree', processed: 10, total: 10 }); }),
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

  it('rejects a non-loinc system in slice 1', async () => {
    const deps = { loadConcepts: vi.fn(), buildOntology: vi.fn() };
    await expect(ingestDistribution({ systemType: 'snomed', codingSystemId: 'x', distDir: '/d', acceptLicense: true, deps: deps as never, onProgress: () => {} }))
      .rejects.toThrow(/only loinc/i);
  });

  it('requires license acceptance', async () => {
    const deps = { loadConcepts: vi.fn(), buildOntology: vi.fn() };
    await expect(ingestDistribution({ systemType: 'loinc', codingSystemId: 'x', distDir: '/d', acceptLicense: false, deps: deps as never, onProgress: () => {} }))
      .rejects.toThrow(/license/i);
    expect(deps.loadConcepts).not.toHaveBeenCalled();
  });
});
