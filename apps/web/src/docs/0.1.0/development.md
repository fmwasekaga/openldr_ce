# Development

Run OpenLDR from source to develop against it. The repo is a pnpm + Turbo monorepo:
the backend API (`apps/server`), the Studio app (`apps/studio`), this landing/docs site
(`apps/web`), and shared packages. Backing services (Postgres, MinIO, Keycloak) run in
Docker; the apps run on your host with hot reload.

## Prerequisites

- **git**
- **Node.js 20+**
- **pnpm** (or Corepack: `corepack enable`)
- **Docker** with the Compose plugin (for the backing services)

## Quick start (one-line bootstrap)

The developer bootstrap clones the repo, installs dependencies, starts the backing
services, writes a dev `.env`, and initializes the database.

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.ps1 | iex
```

Useful flags: `--dir <path>` where to clone, `--branch <name>` which branch,
`--seed` also load WHONET sample data, `--reset-db` force a fresh database (destructive),
`--no-services` skip Docker + DB. (On PowerShell: `-Dir`, `-Branch`, `-Seed`, `-ResetDb`,
`-NoServices`.)

## Manual setup

If you'd rather do it by hand:

```
git clone https://github.com/Open-Laboratory-Data-Repository/openldr.git
cd openldr
pnpm install

# dev config — enables a no-login dev admin so you don't need to configure Keycloak
cp .env.example .env
printf '\nAUTH_DEV_BYPASS=true\n' >> .env   # required: the bypass is off unless you set it

# backing services (Postgres :5433, MinIO :9010/:9011, Keycloak :8180)
docker compose up -d

# create the schema and seed the starter set (forms, workflows, terminology)
pnpm openldr db reset
pnpm openldr db seed
```

> The database is **not** migrated automatically in dev (`MIGRATE_ON_START` is off), so
> **after any pull that brings new migrations, run `pnpm openldr db migrate`**. It is
> non-destructive and keeps your data. If the app shows empty data or the server logs
> `relation "…" does not exist`, that is the fix — `db seed` refuses to run against a
> schema that is behind the code and tells you what is pending.
>
> Reach for `pnpm openldr db reset` only when you actually want a clean slate: it **drops
> and recreates the schema**, destroying everything in your dev database.

## Run the apps

Each app runs in its own terminal from the repo root:

```
pnpm -C apps/server dev             # API        → http://localhost:3000
pnpm -C apps/studio dev             # Studio app → http://localhost:5173/studio
pnpm -C apps/web dev -- --port 5174 # This site  → http://localhost:5174
```

Studio proxies `/api` to the server on port 3000. The landing site needs an explicit
`--port` because it defaults to the same port as Studio (5173). With `AUTH_DEV_BYPASS`
on, Studio loads straight in as a dev admin — no sign-in required. Remove it from `.env`
to exercise the real Keycloak flow.

> `AUTH_DEV_BYPASS` is **off unless you set it explicitly** — it is not implied by
> `NODE_ENV=development`. If Studio asks you to sign in on an existing checkout, add
> `AUTH_DEV_BYPASS=true` to `.env`. When it is on, the server logs a warning at startup
> and Studio shows a banner, because in that mode the API is unauthenticated.

## Handy commands

| Command | What it does |
| --- | --- |
| `pnpm test` | Run the workspace test suites. |
| `pnpm typecheck` | Type-check every package and app. |
| `pnpm build` | Build everything (Turbo). |
| `pnpm openldr db migrate` | Apply pending migrations. Non-destructive — run this after a pull. |
| `pnpm openldr db reset` | Drop and recreate the dev database schema (**destructive**). |
| `pnpm openldr db seed` | Seed the default forms, workflows, and terminology. |
| `pnpm -C apps/studio test` | Run just the Studio tests. |

## Contributing

Contributions are welcome. For now: fork the repo, create a feature branch, keep tests
and type-checks green (`pnpm test`, `pnpm typecheck`), and open a pull request against
`main` describing the change.

**Server route convention:** response compression is registered globally, so every async
route handler must `return reply.send(...)` — a bare `reply.send(payload)` silently
returns an **empty** body once the payload crosses ~1KB and the send goes async. The
`return` is load-bearing, not style; the mechanism is explained in the comment block at
the top of `apps/server/src/sync-routes.ts`.

> A fuller contribution guide (coding conventions, review process, and a PR checklist)
> is still being written — check back, or open an issue to start a discussion.
