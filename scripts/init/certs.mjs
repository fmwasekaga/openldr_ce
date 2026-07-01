const CERT_DIR = 'deploy/nginx/certs';

/** Return a cert-provisioning plan for the chosen TLS mode. The orchestrator executes it.
 *  - self-signed: {kind:'exec', command} — run openssl to write CERT_DIR/{fullchain,privkey}.pem
 *  - byo:         {kind:'copy', files:[{from,to}]} — copy operator cert/key into CERT_DIR
 *  - letsencrypt: {kind:'certbot', domain, email} — orchestrator drives the certbot profile */
export function planCerts({ tlsMode, host, email, certPath, keyPath }) {
  if (tlsMode === 'self-signed') {
    return {
      kind: 'exec',
      command: `openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout ${CERT_DIR}/privkey.pem -out ${CERT_DIR}/fullchain.pem -subj "/CN=${host}" -addext "subjectAltName=DNS:${host},DNS:localhost,IP:127.0.0.1"`,
    };
  }
  if (tlsMode === 'byo') {
    return { kind: 'copy', files: [{ from: certPath, to: `${CERT_DIR}/fullchain.pem` }, { from: keyPath, to: `${CERT_DIR}/privkey.pem` }] };
  }
  if (tlsMode === 'letsencrypt') {
    return { kind: 'certbot', domain: host, email };
  }
  throw new Error(`unknown tlsMode: ${tlsMode}`);
}
