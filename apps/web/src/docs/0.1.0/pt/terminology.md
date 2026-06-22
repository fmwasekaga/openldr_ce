# Terminologia

O serviço de terminologia resolve valores codificados como LOINC, UCUM, SNOMED CT, RxNorm e códigos ICD usados nos recursos ingeridos.

## Consulta de conceitos

Códigos presentes em observações e pedidos são validados e podem ser expandidos em relação aos sistemas de codificação. Isso mantém os dados AMR e laboratoriais comparáveis entre unidades de saúde.

## Importações

As importações de termos têm escopo definido pelo sistema de codificação selecionado e são idempotentes. Reimportar a mesma fonte atualiza as linhas `(sistema, código)` existentes em vez de criar duplicatas.

Use **Terminologia -> linha do sistema de codificação -> Ações -> Importar termos...** para arquivos de terminologia de origem:

| Sistema | Arquivo a importar |
|---|---|
| LOINC | `Loinc.csv` oficial de um download licenciado/gratuito do LOINC. |
| SNOMED CT | Arquivos de Descrição RF2 como `sct2_Description_Snapshot-en_*.txt`. |
| RxNorm | `RXNCONSO.RRF` de um download RxNorm/UMLS. |
| UCUM, ICD-10, ICD-11, sistemas personalizados | Pacotes JSONL/NDJSON, um termo por linha. |

OpenLDR CE inclui unidades laboratoriais UCUM comuns e um conjunto inicial reduzido de ICD-10 relevante para laboratórios. O ICD-11 está registrado mas intencionalmente vazio; importe seu próprio subconjunto ICD-11 como JSONL/NDJSON.

Linhas JSONL/NDJSON genéricas usam:

```jsonl
{"code":"mg/dL","displayName":"milligram per deciliter","class":"mass concentration"}
{"code":"B20","displayName":"Human immunodeficiency virus [HIV] disease","metadata":{"source":"WHO ICD-10"}}
```

`code` e `displayName` são obrigatórios. Campos opcionais são `shortName`, `class`, `unit`, `status` e `metadata`. Linhas em branco e comentários `//` são ignorados; uma primeira linha de metadados como `{"type":"meta","codingSystem":"ICD-10","version":"2026"}` é ignorada.

ValueSets FHIR são separados: use **Ações -> Value set -> Importar...** e escolha um único arquivo FHIR ValueSet `.json` ou um arquivo de catálogo Corlix/FHIR como `R4.valuesets.json.gz`. Arquivos ZIP não são usados para importação de ValueSet.

## Índices ontológicos

Os índices ontológicos LOINC, SNOMED CT e RxNorm podem ser construídos a partir de pastas de origem licenciadas e consultados na página de Terminologia. As pastas de distribuição de ontologia são para navegação somente leitura e assistência de mapeamento; são separadas das importações de termos para a tabela de terminologia principal.
