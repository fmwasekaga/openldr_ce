export interface SqlResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}
export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

export interface ExportArtifactInput {
  format: 'csv' | 'xlsx' | 'pdf';
  filename?: string;
  title?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}
export interface ExportArtifactResult {
  objectKey: string;
  format: string;
  byteSize: number;
}
export interface Dhis2PushInput {
  mappingId: string;
  period: string;
  dryRun?: boolean;
}

/** Capabilities the server injects so source handlers can reach lab data. */
export interface WorkflowServices {
  runSql(sql: string): Promise<SqlResult>;
  fhirQuery(resourceType: string, limit: number): Promise<{ resources: unknown[] }>;
  httpFetch(req: HttpRequest): Promise<HttpResponse>;
  materializeDataset(
    name: string,
    columns: { key: string; label: string }[],
    rows: Record<string, unknown>[],
    workflowId: string | null,
  ): Promise<{ dataset: string; rowCount: number }>;
  exportArtifact(input: ExportArtifactInput): Promise<ExportArtifactResult>;
  dhis2Push?(input: Dhis2PushInput): Promise<unknown>;
}

export function parseAllowlist(raw: string): string[] {
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * fetch wrapper that rejects any host not on the comma-separated allow-list
 * before making the request (SSRF guard). `fetchImpl` is injectable for tests.
 */
export async function guardedFetch(
  req: HttpRequest,
  allowlistRaw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HttpResponse> {
  if (!req.url) throw new Error('HTTP Request: URL is required');
  let host: string;
  try {
    host = new URL(req.url).hostname.toLowerCase();
  } catch {
    throw new Error(`HTTP Request: invalid URL: ${req.url}`);
  }
  const allow = parseAllowlist(allowlistRaw);
  if (!allow.includes(host)) throw new Error(`HTTP host not allowed: ${host}`);

  const method = (req.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  let body: string | undefined;
  if (['POST', 'PUT', 'PATCH'].includes(method) && req.body !== undefined) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
  }

  const res = await fetchImpl(req.url, { method, headers, body });
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { responseHeaders[k] = v; });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, headers: responseHeaders, data };
}
