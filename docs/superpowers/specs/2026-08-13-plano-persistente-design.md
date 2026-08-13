# Plano Persistente e Navegável — Design

## Objetivo

Manter o plano colado pelo usuário até que outro plano seja carregado e apresentar sua hierarquia de categorias, matérias e submatérias em uma UI compacta, bonita e adequada ao painel pequeno da Fábrica de Cadernos.

## Contexto e causa raiz

O estado normalizado já contém `estado.plano`, incluindo `group` para a categoria e `subjectPaths` para os caminhos de submatérias. Porém, `htmlPlano()` recria o `<textarea>` com uma string vazia em toda troca de aba ou re-render. Além disso, o salvamento padrão usa debounce de 5 segundos, permitindo que uma navegação ocorra antes de o plano recém-carregado chegar ao IndexedDB.

## Direção visual

- Direção: painel educacional técnico em dark OLED, com azul como cor estrutural e laranja somente como acento de ação.
- Tipografia: `Fira Sans` para texto da interface e `Fira Code`/`Consolas` para JSON, com fallbacks locais.
- Hierarquia: resumo do plano no topo; árvore em cartões discretos abaixo.
- Estado inicial: todas as categorias, matérias e submatérias recolhidas.
- Interação: cada linha expansível usa `<details>/<summary>` para manter teclado, foco e semântica nativos; o clique deve ser o caminho primário, sem depender de hover.
- Movimento: revelação curta por opacidade/transform, entre 150 e 300 ms; `prefers-reduced-motion: reduce` desativa a animação.
- Responsividade: largura limitada pela viewport (`min(400px, calc(100vw - 20px))`), corpo com rolagem vertical e nenhuma rolagem horizontal.
- Acessibilidade: foco visível, contraste alto, alvos de interação confortáveis e indicadores que não dependem apenas de cor.
- Ícones novos: SVG inline consistente, sem emojis usados como controles.

## Fluxo de dados e persistência

1. Ao carregar um plano válido, a UI salva o texto original em `estado.planoTexto` e o objeto normalizado em `estado.plano`.
2. O carregamento usa checkpoint crítico/imediato para persistir o plano antes de seguir o fluxo normal de debounce.
3. Ao reabrir a página, o IndexedDB restaura `plano` e `planoTexto` antes da UI ser criada.
4. Ao trocar de aba, `htmlPlano()` reusa `planoTexto` e renderiza a árvore a partir de `plano`; nenhum desses dados é limpo.
5. Se um novo JSON for inválido, a UI mostra o erro e mantém o plano anterior intacto.
6. Para estados antigos sem `planoTexto`, a UI gera um fallback legível com `JSON.stringify(estado.plano, null, 2)`, preservando compatibilidade.

## Componentes da aba Plano

- Resumo: nome do plano, quantidade de matérias, categorias e assuntos.
- Área de edição: textarea com o texto persistido, ainda disponível para substituir o plano.
- Ação: botão “Carregar plano”, que substitui os dados somente depois da normalização passar.
- Árvore de categorias: uma entrada recolhida por categoria, exibindo contagem de matérias.
- Árvore de matérias: dentro da categoria, uma entrada recolhida por matéria, com título, código e quantidade de assuntos.
- Árvore de submatérias: caminhos `subjectPaths` quebrados por `>` e deduplicados, formando níveis aninhados abaixo da matéria.
- Estado vazio: mensagem orientando a colar um plano quando não houver plano carregado.

## Limites de escopo

- Não alterar o parser de formatos aceitos nem o orquestrador de execução.
- Não adicionar dependências externas.
- Não alterar o significado dos filtros, categorias ou índices existentes.
- Não apagar automaticamente o plano por erro de parsing, troca de aba, re-render ou navegação.

## Validação

- Teste de regressão confirma que o texto original fica disponível depois de um re-render da aba Plano.
- Teste confirma fallback para estado antigo sem `planoTexto`.
- Teste confirma agrupamento por categoria e deduplicação dos caminhos de submatérias.
- Teste confirma que o estado inicial da árvore não inclui `open`.
- Suíte existente continua passando.
- Build gera `dist/tec_fabrica_cadernos.user.js` com sintaxe válida e APIs globais existentes.
- Verificação manual no preview/ambiente do userscript cobre carregar, trocar de aba, voltar à aba Plano, recarregar a página e carregar um segundo plano.
