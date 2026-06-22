# Painel

O painel é a página inicial. Ele exibe uma grade configurável de **widgets** — KPIs, gráficos, medidores e tabelas — construídos a partir dos dados do seu depósito. Você pode manter vários painéis e alternar entre eles com o seletor no canto superior esquerdo.

## Visualização

Cada widget executa sua própria consulta e renderiza o resultado. Alterne entre painéis com o seletor **Painel**. Os painéis são compartilhados por toda a implantação.

## Edição

Clique em **Editar** para entrar no modo de edição. No modo de edição você pode:

- **Adicionar Widget** — abrir o editor de widgets (veja abaixo).
- **Arrastar** um widget pelo seu alça de cabeçalho para movê-lo, ou arrastar seu canto para redimensioná-lo. A grade de 12 colunas empacota os widgets para cima automaticamente.
- **Editar** ou **excluir** um widget com os botões no seu cabeçalho.
- **Filtros** — definir variáveis de filtro no nível do painel.

As alterações são salvas automaticamente enquanto você edita; clique em **Concluído** para sair do modo de edição.

## Criando um widget

O editor de widgets tem duas formas de definir uma consulta, com uma pré-visualização ao vivo à direita:

- **Construtor** (padrão) — escolha uma **Fonte** (por ex. Pedidos de Teste, Resultados, Amostras), uma **Métrica** (uma contagem ou agregação), uma dimensão opcional **Agrupar por** e — para dimensões de data — um **Grão** (dia/semana/mês/ano). O construtor compila para uma consulta segura e parametrizada que funciona em depósitos Postgres e SQL Server.
- **Visualização** — escolha como o resultado é desenhado: KPI, gráfico de linha / barras / área / linha horizontal / pizza / dispersão / funil, medidor, barra de progresso, semáforo ou tabela.

## Filtros do painel

Defina variáveis de filtro (texto, número, data ou intervalo de datas) e vincule-as a widgets. Alterar um valor de filtro reexecuta os widgets vinculados, de modo que um controle pode conduzir todo o painel.

## SQL personalizado (avançado)

Quando habilitado por um administrador, uma aba **SQL** permite escrever uma consulta `SELECT` somente leitura diretamente. Este recurso avançado está **desabilitado por padrão**, está disponível **somente em depósitos Postgres**, e executa cada consulta em uma transação somente leitura com tempo limite de instrução e limite de linhas. Use marcadores `{{variavel}}` para referenciar filtros do painel. Para portabilidade e segurança, prefira o construtor visual.

## Temas

Use o botão sol/lua na barra superior para alternar entre os temas escuro e claro. Sua preferência é salva no navegador.

![Dashboard](dashboard.png)
