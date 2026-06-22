# Banco de Dados Externo

Por padrão, OpenLDR armazena as tabelas de relatórios em seu banco de dados Postgres interno. Você pode apontar o depósito de relatórios para um **Postgres** ou **SQL Server** externo por meio da configuração `TARGET_STORE_ADAPTER`.

## Configurando o SQL Server

Defina o adaptador de depósito de destino como `mssql` e a conexão no seu ambiente:

```
TARGET_STORE_ADAPTER=mssql
MSSQL_HOST=localhost
MSSQL_PORT=11433
MSSQL_DATABASE=openldr
MSSQL_USER=sa
MSSQL_PASSWORD=Your_Strong_Password1
```

OpenLDR projeta recursos FHIR em tabelas planas compatíveis com MSSQL e os carrega de forma idempotente em massa. Não são necessárias colunas JSON/documento — os dados são totalmente nivelados.

## Configurando Postgres externo

O adaptador padrão é `pg`; aponte-o para um Postgres externo com `TARGET_DATABASE_URL`:

```
TARGET_STORE_ADAPTER=pg
TARGET_DATABASE_URL=postgres://user:pass@host:5432/openldr
```

## Migrando o esquema

Execute as migrações no destino externo antes da primeira ingestão:

```
pnpm openldr db migrate
```

Você pode verificar a conexão primeiro com `pnpm openldr target-store test`.
