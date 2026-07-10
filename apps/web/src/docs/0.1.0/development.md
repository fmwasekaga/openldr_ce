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
printf '\nAUTH_DEV_BYPASS=true\n' >> .env

# backing services (Postgres :5433, MinIO :9010/:9011, Keycloak :8180)
docker compose up -d

# create the schema and seed the starter set (forms, workflows, terminology)
pnpm openldr db reset
pnpm openldr db seed
```

> The database is **not** migrated automatically in dev. If the app shows empty data or
> the server logs `relation "…" does not exist`, run `pnpm openldr db reset` then
> `pnpm openldr db seed`.

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

## Handy commands

| Command | What it does |
| --- | --- |
| `pnpm test` | Run the workspace test suites. |
| `pnpm typecheck` | Type-check every package and app. |
| `pnpm build` | Build everything (Turbo). |
| `pnpm openldr db reset` | Drop and recreate the dev database schema. |
| `pnpm openldr db seed` | Seed the default forms, workflows, and terminology. |
| `pnpm -C apps/studio test` | Run just the Studio tests. |

## Contributing

Contributions are welcome. For now: fork the repo, create a feature branch, keep tests
and type-checks green (`pnpm test`, `pnpm typecheck`), and open a pull request against
`main` describing the change.

> A fuller contribution guide (coding conventions, review process, and a PR checklist)
> is still being written — check back, or open an issue to start a discussion.
