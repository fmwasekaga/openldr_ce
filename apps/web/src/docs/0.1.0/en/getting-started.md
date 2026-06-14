# Getting Started

This guide walks through installing OpenLDR CE, initializing the database, and running your first ingest.

## Prerequisites

- Node.js 20+ and pnpm
- Docker (for the bundled PostgreSQL, MinIO, and optional SQL Server / DHIS2 containers)

## Install

```
pnpm install
docker compose up -d
pnpm openldr db migrate
```

## Your first ingest

Install a plugin and ingest a sample file:

```
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite
```

Open the SPA and visit the **Dashboard** to see the resulting AMR resistance report.

![Dashboard](dashboard.png)
