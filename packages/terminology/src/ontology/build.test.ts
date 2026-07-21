import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildOntologyDistribution, type OntologyIndexStore } from './build';

function fakeStore() {
  const state: {
    status: string;
    type?: string;
    nodes: unknown[];
    edges: unknown[];
    built: null | { ontologyType: string; sourcePath: string; nodeCount: number; edgeCount: number; manifest: Record<string, unknown> };
    error: string | null;
  } = { status: 'none', nodes: [], edges: [], built: null, error: null };
  const store: OntologyIndexStore = {
    beginBuild: async (_id, ontologyType) => {
      state.status = 'building';
      state.type = ontologyType;
    },
    clearIndex: async () => {
      state.nodes = [];
      state.edges = [];
    },
    bulkInsertNodes: async (_id, rows) => {
      state.nodes.push(...rows);
    },
    bulkInsertEdges: async (_id, rows) => {
      state.edges.push(...rows);
    },
    bulkInsertPanelMembers: async () => {},
    bulkInsertAnswerOptions: async () => {},
    bulkInsertSpecimens: async () => {},
    finishBuild: async (_id, opts) => {
      state.status = 'ready';
      state.built = opts as typeof state.built;
    },
    failBuild: async (_id, _ontologyType, _sourcePath, error) => {
      state.status = 'error';
      state.error = error;
    },
  };
  return { store, state };
}

describe('buildOntologyDistribution', () => {
  it('builds the LOINC fixture to ready with node/edge counts', async () => {
    const { store, state } = fakeStore();
    await buildOntologyDistribution('cs-loinc', join(__dirname, 'adapters', '__fixtures__', 'loinc'), store, () => {});

    expect(state.status).toBe('ready');
    expect(state.built?.nodeCount).toBeGreaterThan(0);
    expect(state.built?.edgeCount).toBeGreaterThan(0);
    expect(state.built?.manifest.ontologyType).toBe('loinc');
  });

  it('fails on a folder with no recognized distribution', async () => {
    const { store, state } = fakeStore();
    await expect(buildOntologyDistribution('cs-x', join(__dirname, 'adapters', '__fixtures__'), store, () => {})).rejects.toThrow(
      /No LOINC/,
    );
    expect(state.status).toBe('error');
  });

  it('rejects when the detected adapter type does not match the expected systemType', async () => {
    const { store, state } = fakeStore();
    const snomedFixture = join(__dirname, 'adapters', '__fixtures__', 'snomed');
    await expect(
      buildOntologyDistribution('cs1', snomedFixture, store, () => {}, { expectedType: 'rxnorm' }),
    ).rejects.toThrow(/rxnorm.*expected|does not match/i);
    expect(state.status).toBe('error');
  });
});
