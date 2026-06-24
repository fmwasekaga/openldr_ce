# Relatórios Agregados DHIS2

OpenLDR pode enviar dados de vigilância AMR para uma instância DHIS2 como **dataValueSets** agregados e como **eventos de rastreamento**.

## Conexão

As informações de conexão do DHIS2 (URL base, usuário, senha) ficam em um **Conector** criptografado, não em variáveis de ambiente. Crie um em **Configurações ▸ Conectores**: escolha o plugin `dhis2-sink`, informe a URL base e as credenciais e clique em **Testar conexão** para verificar o acesso e obter um resumo dos metadados. Os segredos são criptografados em repouso e nunca mais exibidos.

Duas variáveis de ambiente ainda se aplicam:

```text
REPORTING_TARGET_ADAPTER=dhis2     # ativa a integração do destino de relatórios DHIS2
SECRETS_ENCRYPTION_KEY=<base64>    # chave de 32 bytes (openssl rand -base64 32) — necessária para armazenar/ler os segredos do conector
DHIS2_SYNC_ENABLED=true            # opcional, ativa a sincronização agendada/por eventos
```

Cada mapeamento do DHIS2 seleciona o conector que recebe o envio (veja **Mapeamento** abaixo).

## Mapeamento

Um mapeamento vincula unidades organizacionais e elementos de dados do OpenLDR a UIDs do DHIS2. Ele abrange o mapeamento de unidades organizacionais, mapeamento de elementos de dados/combinação de categorias e janelamento de períodos (o período de relatório é derivado do intervalo de datas do relatório). Importe os mapeamentos e valide antes de enviar:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 orgunit import orgunits.json --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 map import mapping.json --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 validate <mappingId> --json
```

Use `pnpm openldr dhis2 pull-metadata` antes de construir mapeamentos se quiser que a interface e os validadores usem metadados DHIS2 em cache. Use `pnpm openldr dhis2 status` para confirmar o estado do conector e do cache.

## Envio

Envie um mapeamento para um período DHIS2. Adicione `--dry-run` para visualizar o payload sem enviá-lo. Eventos de rastreamento usam um subcomando separado e se destinam apenas a programas de eventos.

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 push <mappingId> --period 2026Q1 --dry-run --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 push <mappingId> --period 2026Q1 --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 tracker push <mappingId> --period 2026Q1 --dry-run --json
```

## Sincronização agendada e orientada a eventos

Registre um agendamento para republicar em uma cadência de período. Passe `--event-driven` (rastreamento) para também enviar após cada lote de ingestão concluído:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 schedule add <mappingId> --mode aggregate --period-type quarterly --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 schedule add <mappingId> --mode tracker --period-type monthly --event-driven --json
```

Se um comando falhar durante o carregamento da configuração, confirme que `REPORTING_TARGET_ADAPTER=dhis2` está definido, que `SECRETS_ENCRYPTION_KEY` está configurado e que um conector foi criado e habilitado em Configurações ▸ Conectores.

![DHIS2 setup](doc-dhis2.png)
