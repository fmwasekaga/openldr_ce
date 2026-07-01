/** answers -> flat env map (only gateway/auth keys; secrets untouched). */
export function computeEnv({ host, tlsMode, httpPort, httpsPort, email }) {
  const origin = httpsPort === 443 ? `https://${host}` : `https://${host}:${httpsPort}`;
  const env = {
    SERVER_NAME: host,
    PUBLIC_ORIGIN: origin,
    GATEWAY_HTTP_PORT: String(httpPort),
    GATEWAY_HTTPS_PORT: String(httpsPort),
    TLS_MODE: tlsMode,
    OIDC_ISSUER_URL: `${origin}/auth/realms/openldr`,
    OIDC_INTERNAL_JWKS_URL: 'http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs',
    OIDC_WEB_CLIENT_ID: 'openldr-web',
    KC_HOSTNAME: `${origin}/auth`,
  };
  if (tlsMode === 'letsencrypt' && email) env.LETSENCRYPT_EMAIL = email;
  return env;
}
