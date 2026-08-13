# Diagnóstico da Fábrica de Cadernos

Ferramenta **separada** e **fora de `dist/`**: gera uma variante instrumentada
do userscript, com contadores de persistência, timers/Workers/URLs e memória
observável — sem tocar no build limpo, nas fontes ou nos arquivos protegidos
(`tec_fabrica_cadernos.user.js`, `tec_coletor.user.js`, `gerar_pdf.py`).

Sem dependências externas (só Node + vm).

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `scripts/diagnostico.mjs` | Gerador: monta a variante e injeta a instrumentação |
| `scripts/diagnostico-instrumentado.mjs` | Runner headless: exercita os contadores e grava relatório |
| `diagnostico/tec_fabrica_cadernos.diagnostico.user.js` | Variante gerada (userscript) |
| `diagnostico/relatorio-instrumentado.json` | Relatório gerado pelo runner |
| `test/diagnostico.test.mjs` | Testes do gerador, da injeção e do runner |

## Uso

```powershell
# 1. Gerar a variante (nunca escreve em dist/ nem em src/)
node scripts/diagnostico.mjs

# 2. Validar headless (executa a instrumentação com janela falsa)
node scripts/diagnostico-instrumentado.mjs

# 3. Testes
node --test test/diagnostico.test.mjs
```

Para usar no navegador: copie o conteúdo de
`diagnostico/tec_fabrica_cadernos.diagnostico.user.js` para um novo userscript
no Tampermonkey (a variante tem `@match` e `@grant none` iguais ao original).
Ela **não substitui** `dist/`.

### API no Console (da página do Tec Concursos)

```js
__TecFabricaDiagnostico.resumo()      // contadores atuais + memória + domínios
__TecFabricaDiagnostico.snapshot()    // resumo + observáveis + amostras
__TecFabricaDiagnostico.observaveis() // estado, índices de persistência, gabarito
__TecFabricaDiagnostico.amostrar()    // coleta amostra manual (auto: a cada 10 s, anel de 30)
__TecFabricaDiagnostico.zerar()       // zera contadores
__TecFabricaDiagnostico.desativar()   // restaura setTimeout/Worker/URL/XHR/fetch/IDB originais
```

### O que cada contador mostra

- `persistencia`: `salvarEstado`, `salvarEstadoIdb`, `salvarSnapshot`, `carregarEstado`
  (chamadas após a injeção, que ocorre no fim do boot);
- `scheduler`: `sleep`, `poll`, `cancelar`, `limpar` (workerSleep/workerTick/Scheduler);
- `timers`: `setTimeout`/`setInterval` criados, `clear*` e **ativos** rastreados;
- `workers` + `urls`: criados/terminados e blob URLs criadas/revogadas — `delta > 0`
  indica vazamento de blob URL;
- `requests`: XHR e fetch, separando URLs `/api/`, status 200 e erros, com anel de
  URLs e contagem por domínio;
- `idb`: aberturas, sucesso/erro e transações;
- `memoria`: `performance.memory` (Chromium) quando disponível, senão `null`.

## Segurança

- O build limpo (`dist/`) **nunca** recebe métricas: o gerador aborta se qualquer
  fragmento já contiver instrumentação (`__TecFabricaDiagnostico`, marcadores);
- O gerador só escreve em `diagnostico/`; não modifica fontes nem `dist/`;
- O bloco injetado é delimitado por marcadores únicos e o resultado passa por
  `node --check` + validação de versão/APIs;
- A instrumentação é idempotente e reversível (`desativar()`).

## Achados

O gerador e o relatório listam `achados` (estáticos + sonda de boot em vm).
**Achado atual (crítico, pré-existente nas fontes):** `estado` é atribuído em modo
estrito sem declaração em `src/fabrica/06-persistencia.js` (faltou
`var estado = estadoVazio();`, presente no monólito antigo). Confirmado por
execução: `ReferenceError: estado is not defined` no boot → a UI nunca é criada.
Os contadores de persistência contam a partir da injeção, então um boot quebrado
aparece como `observaveis().estado` ausente + achado crítico no relatório.

*Nota:* `Scheduler.limpar()` cancela tarefas internamente, então `limpar` e
`cancelar` podem contar a mesma tarefa — esperado, é diagnóstico.
