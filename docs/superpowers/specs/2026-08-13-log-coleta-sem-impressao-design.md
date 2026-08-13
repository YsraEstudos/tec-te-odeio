# Especificação — log operacional e coleta sem impressão

## Objetivo

Deixar a execução compreensível durante todo o ciclo: o script registra o que encontrou, qual decisão tomou, qual ação tentou, qual foi o resultado e por que uma etapa falhou. A coleta passa a trabalhar questão por questão, salvando a questão e seu gabarito antes de navegar para a próxima.

## Contrato do evento

Cada evento persistido possui `id`, `at`, `tipo`, `nivel`, `fase`, `mensagem` e `contexto`. Os tipos são `observacao`, `decisao`, `tentativa`, `resultado`, `erro` e `evento`; os níveis são `info`, `ok`, `warn` e `erro`.

O contexto é limitado em profundidade, quantidade de campos e tamanho de strings. Chaves que possam carregar segredo, cookie, token, senha, sessão ou resposta bruta são omitidas. O estado conserva no máximo 600 eventos; a persistência usa debounce para não transformar o log em uma escrita por ação.

## Fluxo observado

1. O boot registra hidratação, versão, instalação do interceptor e decisão de auto-retomada.
2. O orquestrador registra matéria, fase, caderno existente/criado, filtros, navegações e transições.
3. A extração registra somente metadados da questão: ID, posição, total, quantidade de alternativas e tamanho do enunciado.
4. O resolvedor registra a escolha entre cache interceptado, resolução visível, clique, ausência de controle e timeout; o texto bruto da resposta não entra no log.
5. A coleta registra tentativa, fonte do gabarito, resultado salvo, duração, quantidade acumulada, navegação seguinte e retries.
6. A UI renderiza a trilha persistida em painel compacto, rolável, com diferenciação visual por nível, cópia e limpeza explícita.

## Remoção do fluxo de impressão

O fragmento de impressão, a rota de saída, o bloqueio de `window.print`, os controles de saldo diário e os parsers de questões da página impressa foram removidos do fluxo ativo. A exportação de HTML interativo, Excel e JSON permanece independente da coleta.

## Persistência e retomada

O log fica no mesmo estado persistido que plano, configuração e biblioteca. Eventos gerados antes da hidratação são mesclados aos eventos restaurados, e a sequência de IDs continua a partir do maior ID conhecido. Trocar o plano continua sendo a ação que substitui o plano; recarregar a página não o remove.

## Validação

- Contratos do logger/UI/persistência e observabilidade da coleta.
- Contrato de ausência do fluxo de impressão/PDF.
- Build dos 21 fragmentos e `node --check` do userscript gerado.
- Suíte completa, mantendo separada a falha preexistente de `scripts/diagnostic.test.mjs` quando ela aparecer.
