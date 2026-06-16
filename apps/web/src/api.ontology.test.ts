import { describe, expect, it, vi } from 'vitest';
import { buildOntology, listOntologyDistributions, ontologyChildren } from './api';

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
});
