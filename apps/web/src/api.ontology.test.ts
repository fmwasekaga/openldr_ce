import { describe, expect, it, vi } from 'vitest';
import { buildOntology, importLoincDistribution, importTerms, importValueSet, listOntologyDistributions, ontologyChildren } from './api';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(event: string, cb: (event: MessageEvent) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
  }

  close(): void {
    this.closed = true;
  }

  emit(event: string, data: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) {
      cb({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

describe('ontology api client', () => {
  it('uses /api ontology routes for reads', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => ({
      ok: true,
      json: async () => (String(url).includes('/children') ? [{ code: 'A' }] : []),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await listOntologyDistributions();
    await ontologyChildren('cs-1', 'ROOT A');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/terminology/ontology/distributions');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/terminology/ontology/cs-1/children?parent=ROOT%20A');
  });

  it('streams ontology builds via EventSource', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    FakeEventSource.instances = [];
    const onProgress = vi.fn();

    const { promise } = buildOntology('cs-1', { path: 'D:\\ontology\\loinc' }, onProgress);
    const source = FakeEventSource.instances[0]!;

    expect(source.url).toBe('/api/terminology/ontology/cs-1/build?path=D%3A%5Contology%5Cloinc');
    source.emit('progress', { codingSystemId: 'cs-1', phase: 'done', processed: 1, total: 1 });
    source.emit('done', { codingSystemId: 'cs-1', ontologyType: 'loinc', sourcePath: 'D:\\ontology\\loinc', indexStatus: 'ready' });

    await expect(promise).resolves.toMatchObject({ codingSystemId: 'cs-1', indexStatus: 'ready' });
    expect(onProgress).toHaveBeenCalledWith({ codingSystemId: 'cs-1', phase: 'done', processed: 1, total: 1 });
    expect(source.closed).toBe(true);
  });

  it('posts LOINC distribution imports with a server-side path and license acceptance', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ system: 'http://loinc.org', conceptsLoaded: 2, resourceUrl: 'http://loinc.org' }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(importLoincDistribution('D:\\terminology\\Loinc\\2.82', true)).resolves.toMatchObject({
      system: 'http://loinc.org',
      conceptsLoaded: 2,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/terminology/import/loinc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'D:\\terminology\\Loinc\\2.82', acceptLicense: true }),
    });
  });

  it('uploads terminology and FHIR ValueSet files as raw request bodies', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(url).includes('/valuesets/import')
        ? { id: 'vs1', url: 'urn:test', status: 'active', compose: { include: [] } }
        : { imported: 1 },
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const termsFile = new File(['RXNCONSO'], 'RXNCONSO.RRF');
    const valueSetFile = new File(['compressed bytes'], 'R4.valuesets.json.gz');

    await importTerms('sys1', termsFile);
    await importValueSet(valueSetFile);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/terminology/systems/sys1/terms/import', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: termsFile,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/terminology/valuesets/import', {
      method: 'POST',
      headers: { 'content-type': 'application/gzip' },
      body: valueSetFile,
    });
  });
});
