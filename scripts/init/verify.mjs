import { request } from 'node:https';

/** The gateway health URL. PUBLIC_ORIGIN already encodes the https port, so just append /health. */
export function healthUrl(publicOrigin, _httpsPort) {
  return `${publicOrigin}/health`;
}

/** A health report is "healthy" if it has a status that isn't "down". */
export function isHealthy(body) {
  return !!body && typeof body.status === 'string' && body.status !== 'down';
}

function fetchJsonInsecure(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Poll the gateway /health (accepting a self-signed cert) until healthy or timeout. */
export async function pollHealth(url, { timeoutMs = 120000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await fetchJsonInsecure(url).catch(() => null);
    if (isHealthy(body)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
