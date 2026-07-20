import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadTerminologyDistribution } from './api';

class FakeXHR {
  static instances: FakeXHR[] = [];
  upload = { onprogress: null as null | ((e: any) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  status = 0; responseText = ''; method = ''; url = ''; headers: Record<string, string> = {}; body: any;
  constructor() { FakeXHR.instances.push(this); }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(b: any) { this.body = b; this.status = 201; this.responseText = JSON.stringify({ jobId: 'tij_9' }); this.onload?.(); }
}

describe('uploadTerminologyDistribution', () => {
  beforeEach(() => { FakeXHR.instances = []; (globalThis as any).XMLHttpRequest = FakeXHR as never; });
  it('POSTs the file as octet-stream with systemType + license query and resolves the jobId', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'loinc.zip');
    const res = await uploadTerminologyDistribution('pub-loinc', 'loinc', file, true, '2.82');
    expect(res.jobId).toBe('tij_9');
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toContain('/api/terminology/publishers/pub-loinc/distribution');
    expect(xhr.url).toContain('systemType=loinc');
    expect(xhr.url).toContain('acceptLicense=true');
    expect(xhr.url).toContain('version=2.82');
    expect(xhr.headers['content-type']).toBe('application/octet-stream');
  });
});
