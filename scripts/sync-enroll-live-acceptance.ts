// Live-Keycloak acceptance for Distributed Sync S4d — ENROLLMENT AUTOMATION (central mints a lab
// client). This is the one harness that stands up a REAL Keycloak admin connection (the in-process
// sync harnesses — sync:accept / sync:pull:accept / sync:terminology:accept — deliberately skip
// JWKS/admin and prove only the data round-trip). Here we prove the minted confidential client
// actually authenticates AND that its access token carries the `site_id` claim central's push/pull
// auth (apps/server/src/sync-routes.ts `sitePrincipal`) requires.
//
// End-to-end, against a live Keycloak realm:
//   1. enrollSite → central creates a confidential client + site_id (+ optional audience) mapper +
//      sync_sites row, and returns a one-time clientId/clientSecret.
//   2. client_credentials token request with that secret → 200 + access_token.
//   3. decode the token → assert a TOP-LEVEL site_id === the enrolled site (+ aud contains
//      OIDC_AUDIENCE when configured).
//   4. run the token through ctx.auth.verifyToken + the SAME sitePrincipal extraction central uses →
//      assert it yields { siteId } (this is the real proof the client satisfies sync auth).
//   5. rotateSite → new secret works, OLD secret is rejected (invalid_client).
//   6. revokeSite → the (now-deleted) client can no longer obtain a token.
//
// CRITICAL — this SKIPS CLEANLY (exit 0) when no real Keycloak admin is configured. It is wired to
// `pnpm sync:enroll:accept` and runs on CI/dev boxes that have no Keycloak, so a missing/dev-bypass
// config must never fail the script — it prints a SKIPPED line and exits 0. It only actually runs
// when OIDC_ISSUER_URL + KEYCLOAK_ADMIN_CLIENT_ID/SECRET are set AND AUTH_DEV_BYPASS is not forcing a
// bypass.
//
// Run: pnpm sync:enroll:accept
import { loadConfig, type Config } from '@openldr/config';
import {
  createAppContext,
  enrollSite,
  rotateSite,
  revokeSite,
  type AppContext,
} from '@openldr/bootstrap';

const SITE_ID = 'site-smoke-1';
const CLIENT_ID = `sync-${SITE_ID}`; // must match enrollment.ts syncClientId()

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);

/** Base64url-decode a JWT segment and JSON.parse it (no signature check — verifyToken does that). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`not a JWT (expected 3 segments, got ${parts.length})`);
  const json = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/** Replica of apps/server/src/sync-routes.ts `sitePrincipal` claim extraction (the real gate central
 *  applies to every /api/sync/* request): verify the token, then require a non-empty string site_id. */
async function sitePrincipal(ctx: AppContext, token: string): Promise<{ siteId: string } | undefined> {
  let claims: Awaited<ReturnType<typeof ctx.auth.verifyToken>>;
  try {
    claims = await ctx.auth.verifyToken(token);
  } catch {
    return undefined;
  }
  const siteId = typeof claims['site_id'] === 'string' ? (claims['site_id'] as string) : '';
  if (!siteId) return undefined;
  return { siteId };
}

/** client_credentials token request. Returns { status, body } (body parsed JSON when possible). */
async function requestToken(
  cfg: Config,
  clientId: string,
  clientSecret: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const tokenUrl = `${cfg.OIDC_ISSUER_URL}/protocol/openid-connect/token`;
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  // ── Skip guard: no real Keycloak admin → skip cleanly (exit 0). loadConfig() can throw on a bare
  //    dev box (required env absent); that is also a clean skip, never a crash. ──
  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch {
    console.log(
      '⏭ sync:enroll:accept SKIPPED — no Keycloak admin configured (set OIDC_ISSUER_URL + KEYCLOAK_ADMIN_CLIENT_ID/SECRET)',
    );
    process.exit(0);
  }
  if (
    !cfg.OIDC_ISSUER_URL ||
    !cfg.KEYCLOAK_ADMIN_CLIENT_ID ||
    !cfg.KEYCLOAK_ADMIN_CLIENT_SECRET ||
    cfg.AUTH_DEV_BYPASS === true
  ) {
    console.log(
      '⏭ sync:enroll:accept SKIPPED — no Keycloak admin configured (set OIDC_ISSUER_URL + KEYCLOAK_ADMIN_CLIENT_ID/SECRET)',
    );
    process.exit(0);
  }

  let failures = 0;
  const assert = (cond: boolean, detail: string) => {
    if (cond) { ok(detail); return; }
    failures++;
    console.error(`FAIL: ${detail}`);
    throw new Error(detail);
  };

  const ctx = await createAppContext(cfg);

  try {
    // Pre-clean: a prior aborted run may have left the smoke client behind (a live client would make
    // enrollSite throw AlreadyEnrolled or adopt a stale secret). Best-effort revoke to start fresh.
    step('0. pre-clean any leftover smoke client');
    await revokeSite(ctx, SITE_ID).catch(() => undefined);
    ok('smoke client cleared (if any)');

    // ── 1. enrollSite mints the client + mapper + registry row ──
    step('1. enrollSite mints a confidential client + site_id mapper + registry row');
    const enrolled = await enrollSite(ctx, {
      siteId: SITE_ID,
      name: 'Smoke Test Lab',
      centralUrl: 'https://central.example',
      actor: 'smoke',
    });
    assert(enrolled.clientId === CLIENT_ID, `enroll returned clientId '${enrolled.clientId}' (expected '${CLIENT_ID}')`);
    assert(typeof enrolled.clientSecret === 'string' && enrolled.clientSecret.length > 0, 'enroll returned a non-empty clientSecret');
    assert(enrolled.siteId === SITE_ID, `enroll returned siteId '${enrolled.siteId}'`);
    const secret1 = enrolled.clientSecret;

    // ── 2. client_credentials token request succeeds ──
    step('2. client_credentials token request with the minted secret → 200 + access_token');
    const tok1 = await requestToken(cfg, CLIENT_ID, secret1);
    assert(tok1.status === 200, `token request returned HTTP 200 (got ${tok1.status}: ${JSON.stringify(tok1.body)})`);
    const accessToken = tok1.body['access_token'];
    assert(typeof accessToken === 'string' && accessToken.length > 0, 'response carried a non-empty access_token');
    const access = accessToken as string;

    // ── 3. token payload carries the site_id claim (+ aud when configured) ──
    step('3. access token payload carries top-level site_id (+ aud when OIDC_AUDIENCE set)');
    const payload = decodeJwtPayload(access);
    assert(payload['site_id'] === SITE_ID, `token payload site_id === '${SITE_ID}' (got ${JSON.stringify(payload['site_id'])})`);
    if (cfg.OIDC_AUDIENCE) {
      const aud = payload['aud'];
      const audList = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : [];
      assert(audList.includes(cfg.OIDC_AUDIENCE), `token aud contains OIDC_AUDIENCE '${cfg.OIDC_AUDIENCE}' (got ${JSON.stringify(aud)})`);
    } else {
      ok('OIDC_AUDIENCE not configured — aud assertion skipped');
    }

    // ── 4. the token satisfies central's real sitePrincipal gate ──
    step('4. verifyToken + sitePrincipal extraction → { siteId } (the real sync-auth gate)');
    const principal = await sitePrincipal(ctx, access);
    assert(!!principal, 'sitePrincipal accepted the token (verifyToken passed + site_id present)');
    assert(principal!.siteId === SITE_ID, `sitePrincipal yielded siteId '${principal!.siteId}' (expected '${SITE_ID}')`);

    // ── 5. rotate: new secret works, old secret is rejected ──
    step('5. rotateSite → new secret authenticates, OLD secret is rejected');
    const rotated = await rotateSite(ctx, SITE_ID);
    assert(rotated.clientSecret.length > 0 && rotated.clientSecret !== secret1, 'rotate returned a NEW non-empty secret (differs from the original)');
    const tokNew = await requestToken(cfg, CLIENT_ID, rotated.clientSecret);
    assert(tokNew.status === 200 && typeof tokNew.body['access_token'] === 'string', `NEW secret obtains a token (HTTP ${tokNew.status})`);
    const tokOld = await requestToken(cfg, CLIENT_ID, secret1);
    assert(tokOld.status === 401 || tokOld.body['error'] === 'invalid_client' || tokOld.body['error'] === 'unauthorized_client', `OLD secret is now rejected (HTTP ${tokOld.status}, error=${JSON.stringify(tokOld.body['error'])})`);

    // ── 6. revoke: the deleted client can no longer authenticate ──
    step('6. revokeSite → the deleted client can no longer obtain a token');
    await revokeSite(ctx, SITE_ID);
    const tokRevoked = await requestToken(cfg, CLIENT_ID, rotated.clientSecret);
    assert(tokRevoked.status !== 200, `revoked client cannot obtain a token (HTTP ${tokRevoked.status}, error=${JSON.stringify(tokRevoked.body['error'])})`);
    console.log('\n(note) the sync_sites row for the smoke site remains as status=revoked — there is no delete API; that is acceptable.');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // Best-effort cleanup: ensure the Keycloak client is gone even if a step threw mid-way.
    try {
      const uuid = await ctx.auth.clients.findUuidByClientId(CLIENT_ID);
      if (uuid !== null) await ctx.auth.clients.deleteClient(uuid);
    } catch { /* ignore cleanup errors */ }
    await ctx.close();
  }

  if (failures === 0) {
    console.log('\n✅ sync:enroll:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:enroll:accept FAILED');
    process.exit(1);
  }
}

void main();
