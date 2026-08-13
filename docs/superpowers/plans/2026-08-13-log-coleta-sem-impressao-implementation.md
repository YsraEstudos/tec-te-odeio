# Log operacional completo e coleta sem impressão — Plano de Implementação

> **Para agentes:** usar `superpowers:subagent-driven-development` e executar cada tarefa com teste primeiro, revisão da tarefa e commits pequenos.

**Objetivo:** substituir o caminho de impressão/PDF por coleta sequencial de cada questão com seu gabarito e transformar o log em uma trilha operacional persistente, detalhada e legível.

**Arquitetura:** o runtime continuará usando a coleta DOM existente, a interceptação de XHR e a resolução por clique, mas o orquestrador terá uma única rota de coleta. Um logger operacional será separado dos helpers DOM, receberá eventos estruturados (`tipo`, `nivel`, `fase`, `mensagem`, `contexto`), limitará tamanho/conteúdo e persistirá os últimos eventos no estado IndexedDB. A aba Log renderizará esses eventos com filtros visuais simples, contexto e ações de copiar/limpar.

**Tecnologias:** userscript JavaScript ES2018, IndexedDB existente, Node test runner, VM tests, build por `scripts/build.mjs`.

## Restrições globais

- Não registrar tokens, cookies, cabeçalhos de autorização, HTML bruto completo ou query strings potencialmente sensíveis.
- “Pensando” significa registrar observações, decisões e justificativas operacionais; não expor cadeia de raciocínio interno privado.
- O log persistido terá no máximo 600 eventos e cada contexto terá valores truncados/serializáveis.
- Cada questão será extraída, seu gabarito será tentado por cache/interceptação, resolução visível ou clique, e o registro será salvo antes de navegar para a próxima.
- O fluxo de impressão/PDF não poderá permanecer no manifesto, na configuração ativa, no orquestrador ou no userscript gerado.
- Downloads HTML, Excel e JSON permanecem disponíveis.
- A falha preexistente de `scripts/diagnostic.test.mjs` (`fecho da IIFE não encontrado`) deve ser registrada separadamente, não mascarada nem atribuída a esta mudança.

---

### Tarefa 1: contrato do log operacional e persistência

**Arquivos:**
- Criar: `src/fabrica/03-log.js`
- Modificar: `src/fabrica/03-dom-helpers.js`, `src/fabrica/06-persistencia.js`, `src/fabrica/manifest.json`
- Testar: `test/log.test.mjs`, `test/persistence.test.mjs`

**Interfaces:**
- Produzir `log(mensagem, opcoes)` compatível com chamadas antigas de `log('texto')`.
- `opcoes` aceitará `tipo`, `nivel`, `fase`, `contexto` e `persist`; o evento persistido terá `id`, `at`, `tipo`, `nivel`, `fase`, `mensagem` e `contexto`.
- Produzir `formatarEventoLog(evento)` e `normalizarContextoLog(valor)` para a UI e testes.

- [ ] Escrever testes que comprovem evento estruturado, limite de 600, contexto truncado/sem dados sensíveis e compatibilidade com mensagem simples.
- [ ] Executar `node --test test/log.test.mjs` e confirmar falha por API ausente.
- [ ] Implementar o fragmento do logger, mover/remover o `log` simples de `03-dom-helpers.js`, adicionar `logs: []` ao estado vazio e manter logs no snapshot V2.
- [ ] Executar os testes focados e confirmar aprovação.
- [ ] Commitar `feat: adiciona log operacional persistente`.

### Tarefa 2: aba Log detalhada

**Arquivos:**
- Modificar: `src/fabrica/18-ui.js`
- Testar: `test/ui-integration.test.mjs`, `test/log-ui.test.mjs`

**Interfaces:**
- Consumir `estado.logs` e `formatarEventoLog(evento)`.
- Produzir uma aba Log com contagem, eventos por nível/tipo/fase, contexto escapado, botão copiar e botão limpar persistente.

- [ ] Escrever testes de renderização para evento, contexto escapado, contagem e controles.
- [ ] Executar testes e confirmar falha antes da implementação.
- [ ] Implementar CSS compacto, renderização persistida e atualizações incrementais sem apagar o histórico ao trocar de aba.
- [ ] Executar testes focados e confirmar aprovação.
- [ ] Commitar `feat: exibe trilha operacional completa na interface`.

### Tarefa 3: remoção definitiva da impressão/PDF

**Arquivos:**
- Remover: `src/fabrica/13-impressao.js`
- Modificar: `src/fabrica/01-config.js`, `src/fabrica/07-paginas.js`, `src/fabrica/15-orquestrador.js`, `src/fabrica/18-ui.js`, `src/fabrica/19-inicializacao.js`, `src/fabrica/manifest.json`, `scripts/exportacao.test.mjs`
- Testar: `test/no-print-flow.test.mjs`, `test/build.test.mjs`

**Interfaces:**
- `processarLote()` deverá encaminhar cadernos incompletos diretamente para `coletarCaderno()`.
- A exportação não poderá depender de `extrairQuestoesImpressas` ou `parseGabaritoBloco`.

- [ ] Escrever testes que falhem se manifesto, orquestrador, configuração ou build ainda contiverem a rota de impressão/PDF ativa.
- [ ] Executar os testes e confirmar falha no estado atual.
- [ ] Remover fragmento, fases, controles e helpers exclusivos de impressão; manter exportações HTML/Excel/JSON.
- [ ] Gerar o userscript e executar testes focados.
- [ ] Commitar `refactor: remove fluxo de impressao e pdf`.

### Tarefa 4: telemetria da coleta questão a questão

**Arquivos:**
- Modificar: `src/fabrica/07-paginas.js`, `src/fabrica/08-extracao.js`, `src/fabrica/09-interceptor.js`, `src/fabrica/10-resolucao.js`, `src/fabrica/11-filtros.js`, `src/fabrica/12-criacao.js`, `src/fabrica/14-coleta.js`, `src/fabrica/15-orquestrador.js`, `src/fabrica/19-inicializacao.js`
- Testar: `test/collection-flow.test.mjs`, `test/log-contracts.test.mjs`

**Interfaces:**
- Cada etapa usará `log()` com tipos `observacao`, `decisao`, `tentativa`, `resultado` ou `erro`.
- Contextos mínimos por questão: `id`, `numero`, `total`, `opcoes`, `metodoGabarito`, `gabarito`, `answerSource`, `duracaoMs` quando disponível.

- [ ] Escrever testes estáticos/comportamentais que comprovem logs de extração, decisão de método, tentativa de resolução, resultado do gabarito, persistência e navegação seguinte.
- [ ] Executar os testes e confirmar falha no estado atual.
- [ ] Instrumentar observação/decisão/tentativa/resultado/erro sem registrar conteúdo sensível bruto.
- [ ] Executar testes focados e confirmar aprovação.
- [ ] Commitar `feat: detalha telemetria da coleta de questoes`.

### Tarefa 5: build, documentação e auditoria final

**Arquivos:**
- Modificar: `src/fabrica/00-cabecalho.js`, `src/fabrica/manifest.json`, `docs/superpowers/specs/2026-08-13-log-coleta-sem-impressao-design.md`
- Gerar: `dist/tec_fabrica_cadernos.user.js`
- Testar: suíte `node --test test/*.test.mjs scripts/*.test.mjs`, `node --check dist/tec_fabrica_cadernos.user.js`, `git diff --check`

- [ ] Atualizar descrição e documentação para declarar coleta sequencial e log operacional.
- [ ] Gerar o artefato final e validar sintaxe.
- [ ] Executar testes focados e a suíte completa, separando a falha diagnóstica preexistente.
- [ ] Auditar com `rg` que não há rota de impressão/PDF ativa no manifesto/build e que o histórico de logs não é perdido em re-renderização.
- [ ] Commitar `chore: atualiza userscript de coleta e observabilidade`.
