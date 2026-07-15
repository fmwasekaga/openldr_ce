import { gzipSync } from 'node:zlib';

// Sync S7-B: gzip for the push request body. Kept as a pure module (not inline in postPush) so the
// safety-critical "old central → never gzip" branch is directly testable.

/** Below this, a gzip header costs more than it saves — send plain. */
export const GZIP_MIN_BYTES = 1024;

/** True when central's RFC 7694 `Accept-Encoding` RESPONSE header says it accepts gzipped REQUEST
 *  bodies. An older central sends no such header → false → we never gzip → it keeps working. */
export function advertisesGzip(acceptEncoding: string | null): boolean {
  return !!acceptEncoding && /(^|[,\s])gzip($|[,;\s])/i.test(acceptEncoding);
}

/** Encode a push body: gzipped (+ Content-Encoding) only when central advertised gzip AND the body is
 *  worth compressing; otherwise the original string, unchanged. */
export function encodePushBody(
  json: string,
  acceptsGzip: boolean,
): { body: string | Buffer; headers: Record<string, string> } {
  if (acceptsGzip && Buffer.byteLength(json) >= GZIP_MIN_BYTES) {
    return { body: gzipSync(json), headers: { 'Content-Encoding': 'gzip' } };
  }
  return { body: json, headers: {} };
}
