# Relatórios Agregados DHIS2

OpenLDR pode enviar dados de vigilância AMR para uma instância DHIS2 como **dataValueSets** agregados e como **eventos de rastreamento**.

## Conexão

Configure a conexão DHIS2 no seu ambiente:

```
REPORTING_TARGET_ADAPTER=dhis2
DHIS2_BASE_URL=http://localhost:8085
DHIS2_USERNAME=admin
DHIS2_PASSWORD=district
```

## Mapeamento

Um mapeamento vincula unidades organizacionais e elementos de dados do OpenLDR a UIDs do DHIS2. Ele abrange o mapeamento de unidades organizacionais, mapeamento de elementos de dados/combinação de categorias e janelamento de períodos (o período de relatório é derivado do intervalo de datas do relatório). Importe os mapeamentos e valide antes de enviar:

```
pnpm openldr dhis2 orgunit import orgunits.json
pnpm openldr dhis2 map import mapping.json
pnpm openldr dhis2 validate <mappingId>
```

## Envio

Envie um mapeamento para um período DHIS2. Adicione `--dry-run` para visualizar o payload sem enviá-lo. Eventos de rastreamento usam um subcomando separado e se destinam apenas a programas de eventos.

```
pnpm openldr dhis2 push <mappingId> --period 2026Q1
pnpm openldr dhis2 tracker push <mappingId> --period 2026Q1
```

## Sincronização agendada e orientada a eventos

Registre um agendamento para republicar em uma cadência de período. Passe `--event-driven` (rastreamento) para também enviar após cada lote de ingestão concluído:

```
pnpm openldr dhis2 schedule add <mappingId> --mode aggregate --period-type quarterly
pnpm openldr dhis2 schedule add <mappingId> --mode tracker --period-type monthly --event-driven
```

![DHIS2 setup](doc-dhis2.png)
