# Getting Started

This guide walks through installing OpenLDR CE, initializing the database, and running your first ingest.

## Prerequisites

- Node.js 20+ and pnpm.
- Docker for the bundled PostgreSQL, MinIO, Keycloak, and optional SQL Server / DHIS2 containers.

## Install

PowerShell:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm install --frozen-lockfile
PS D:\Projects\Repositories\openldr_ce> Copy-Item .env.example .env
PS D:\Projects\Repositories\openldr_ce> docker compose up -d
PS D:\Projects\Repositories\openldr_ce> pnpm openldr db migrate
PS D:\Projects\Repositories\openldr_ce> pnpm -C apps/server dev
```

Bash:

```console
$ pnpm install --frozen-lockfile
$ cp .env.example .env
$ docker compose up -d
$ pnpm openldr db migrate
$ pnpm -C apps/server dev
```

Start the web app in a second terminal:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm -C apps/web dev
```

The root package does not define a `pnpm dev` shortcut; run the server and web app package scripts directly.

## Your first ingest

Install a plugin and ingest a sample file:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
PS D:\Projects\Repositories\openldr_ce> pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite
```

Open the SPA and visit the **Dashboard** to see the resulting AMR resistance report.

![Dashboard](dashboard.png)
