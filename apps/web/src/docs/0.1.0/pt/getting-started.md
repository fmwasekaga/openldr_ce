# Primeiros Passos

Este guia percorre a instalação do OpenLDR CE, a inicialização do banco de dados e a execução da sua primeira ingestão.

## Pré-requisitos

- Node.js 20+ e pnpm
- Docker (para o Postgres integrado, MinIO e os contêineres opcionais de SQL Server / DHIS2)

## Instalação

```
pnpm install
docker compose up -d
pnpm openldr db migrate
```

## Sua primeira ingestão

Instale um plugin e ingira um arquivo de exemplo:

```
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite
```

Abra o SPA e acesse o **Painel** para ver o relatório de resistência AMR resultante.

![Dashboard](dashboard.png)
