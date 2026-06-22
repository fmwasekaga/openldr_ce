# Relatórios e AMR/GLASS

OpenLDR disponibiliza um catálogo de relatórios parametrizados sobre as tabelas do depósito.

## Relatórios disponíveis

- **Taxa de Resistência AMR** — percentual resistente (%R) por antibiótico, com deduplicação do primeiro isolado.
- **Antibiograma** — matriz de susceptibilidade por organismo e antibiótico.
- **Volume de Testes** — requisições por teste e mês.
- **Tempo de Retorno** — horas entre coleta e laudo.
- **Dados Demográficos de Pacientes** — contagens por gênero e faixa etária.

## Exportação

Todos os relatórios podem ser exportados como **CSV** a partir de sua página de detalhes. Relatórios AMR também são renderizados como **PDF**. O arquivo **RIS** do WHO GLASS está disponível na rota de exportação GLASS.

![AMR report](report-amr.png)

## Parâmetros

Os relatórios aceitam uma janela de datas (`from`/`to`, inclusiva) e um filtro opcional de unidade de saúde pela barra de parâmetros.
