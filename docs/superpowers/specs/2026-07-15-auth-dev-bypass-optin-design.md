# AUTH_DEV_BYPASS becomes opt-in — design

**Date:** 2026-07-15
**Status:** approved
**Slice:** standalone security fix (independent of sync S7)

## Problem

`AUTH_DEV_BYPASS` disables API authentication: when it is on and a request carries no
bearer token, the server injects a dev admin actor (`apps/server/src/auth-plugin.ts:83`).

Today it defaults **on** whenever `NODE_ENV` is not exactly `production`
(`packages/config/src/schema.ts:183`):

```ts
AUTH_DEV_BYPASS: cfg.AUTH_DEV_BYPASS ?? cfg.NODE_ENV !== 'production',
```

`NODE_ENV` is itself an enum defaulting to `development` (`schema.ts:14`). So a server
started with neither variable set runs with **authentication silently disabled**. This was
observed on a fresh Linux checkout: `.env` had no `AUTH_DEV_BYPASS`, and the server still
booted in bypass mode.

Two variables therefore decide whether the API authenticates, and both fail open. A
forgotten env var should never disable authentication.

## Evidence the implicit default serves no one

Every intentional consumer of the bypass already sets it explicitly:

| Consumer | Location | Sets |
| --- | --- | --- |
| e2e (Playwright) | `e2e/playwright.config.ts:45` | `AUTH_DEV_BYPASS: 'true'` |
| Dev installer (sh) | `install/development.sh:74` | appends `AUTH_DEV_BYPASS=true` to `.env` |
| Dev installer (ps1) | `install/development.ps1:65` | appends `AUTH_DEV_BYPASS=true` to `.env` |
| Dev docs | `apps/web/src/docs/0.1.0/development.md:46` | instructs `printf '\nAUTH_DEV_BYPASS=true\n' >> .env` |

The dev installer and the docs both take the trouble to set a flag the schema already
defaults on. That only makes sense if the intent was opt-in. The implicit default is
vestigial; its only live effect is a silent fail-open.

## Current mitigations (why this is not an emergency)

The shipped deployment path is protected by three independent controls:

1. `apps/server/Dockerfile:21` — `ENV NODE_ENV=production` baked into the image.
2. `install/install.sh:299` / `install.ps1:298` — write `NODE_ENV=production` to `.env`.
3. `schema.ts:177` — `superRefine` hard-rejects an explicit `AUTH_DEV_BYPASS=true` when
   `NODE_ENV=production`.

Residual risk: the whole guarantee hinges on `NODE_ENV === 'production'`, and `NODE_ENV`
defaults to `development`. Running the server outside the official image — bare `node`, a
hand-rolled compose, a PaaS that does not inject `NODE_ENV` — disables auth by omission.

## Design

### 1. Flip the default (`packages/config/src/schema.ts`)

```ts
AUTH_DEV_BYPASS: cfg.AUTH_DEV_BYPASS ?? false,
```

- The chained `.transform` stays, so `Config` always carries a resolved boolean.
- The production `superRefine` guard (`schema.ts:177`) stays as defense in depth.
- `NODE_ENV` drops out of the auth decision entirely. The flag then means exactly what it
  says, and no other variable can turn it on.

Precedent in the same file: `MIGRATE_ON_START` defaults `false` and must be opted in
(`schema.test.ts:49`). Schema-mutating behaviour is already fail-closed; authentication
should be at least as strict.

### 2. Boot warning (`apps/server/src/index.ts`)

Immediately after the logger is constructed (line 8), before the crash handlers, so it is
the first line in the log:

```ts
if (cfg.AUTH_DEV_BYPASS) {
  logger.warn('AUTH_DEV_BYPASS is ON — API requests are NOT authenticated. Local development only; never run a real deployment in this mode.');
}
```

Studio already shows a UI banner (`apps/studio/src/i18n/en.ts:671`); the server logs
nothing. The warning covers headless, CI, and server-only runs where nobody opens Studio.
Wording mirrors the banner so both surfaces say the same thing.

### 3. Docs

- `apps/web/src/docs/0.1.0/environment.md` — the Authentication section lists `OIDC_*` and
  `KEYCLOAK_*` but omits `AUTH_DEV_BYPASS` entirely. Add it with default `false` and a
  "development only; rejected under `NODE_ENV=production`" note, plus `AUTH_DEV_USERNAME`
  and `AUTH_DEV_ROLES`.
- `apps/web/src/docs/0.1.0/development.md` — already instructs setting the flag, so it
  becomes accurate rather than redundant. Add a short note that it is now required for
  no-login dev. This is the upgrade hint for existing dev boxes (the repo has no CHANGELOG).

## Testing

`packages/config/src/schema.test.ts`, written first:

- rewrite `'defaults AUTH_DEV_BYPASS on in development'` → asserts `false` when unset under
  `NODE_ENV=development` (the observed failure case);
- keep `'defaults AUTH_DEV_BYPASS off in production'`;
- keep `'rejects AUTH_DEV_BYPASS=true under production'`;
- add: explicit `true` under `development` resolves `true` (opt-in still works).

`main()` in `apps/server/src/index.ts` has no unit-test harness today. The one-line warning
does not justify inventing one; it is verified by booting the server with and without the
flag and observing the log.

## Blast radius

| Area | Change |
| --- | --- |
| `packages/config/src/schema.ts` | 1 line |
| `packages/config/src/schema.test.ts` | 4 assertions |
| `apps/server/src/index.ts` | 3 lines |
| `apps/web/src/docs/0.1.0/{environment,development}.md` | doc rows + note |

Unaffected: e2e, both installers, and every `apps/server` test construct `cfg` objects with
an explicit `AUTH_DEV_BYPASS` and never resolve the default through `ConfigSchema`.

## Consequence to accept

Existing dev `.env` files without the line will start requiring real Keycloak. The fix is
adding `AUTH_DEV_BYPASS=true`, which the docs and both dev installers already do. This is
the intended outcome: no-login mode becomes a thing you choose, not a thing you inherit.

## Out of scope

- Changing the `NODE_ENV` default (`development` → something stricter) — larger blast
  radius, and unnecessary once the bypass no longer reads `NODE_ENV`.
- The `db seed` pending-migration guard — separate slice, separate spec.
