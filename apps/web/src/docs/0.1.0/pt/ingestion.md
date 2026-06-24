# Ingestão e Plugins

OpenLDR ingere dados laboratoriais por meio de plugins WebAssembly em sandbox. Cada plugin converte um formato de origem em recursos FHIR R4.

## Formatos suportados

- **WHONET SQLite** (`whonet-sqlite`) — isolados AMR de bancos de dados WHONET.
- **HL7 v2** (`hl7v2`) — mensagens de resultado ORU e pedidos ORM.
- **CSV / Excel** (`tabular`) — mapeamento configurável de coluna para campo.

## Executando uma ingestão

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin install reference-plugins/<plugin>/plugin.wasm
PS D:\Projects\Repositories\openldr_ce> pnpm openldr ingest <file> --plugin <id> --config config.json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline status --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr queue status --json
```

## Configuração do plugin

O plugin `tabular` requer um mapeamento JSON passado com `--config`. A configuração é persistida no lote de ingestão e reutilizada automaticamente se o lote for reprocessado:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr ingest lab.csv --plugin tabular --config samples/lab-mapping.json
```

O mapeamento declara quais colunas da planilha correspondem aos campos de paciente, amostra, organismo e resultado de antibiótico.

Se uma ingestão falhar, inspecione os registros do lote do pipeline:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline logs <batchId> --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline retry <batchId> --json
```
