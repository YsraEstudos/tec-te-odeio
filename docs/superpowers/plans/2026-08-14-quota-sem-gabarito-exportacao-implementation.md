# Quota, Modo Sem Gabarito e Exportação Filtrada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir o saldo diário de resoluções, oferecer uma coleta manual/offline sem gabarito e adicionar exportação filtrada para TXT e PDF no HTML gerado.

**Architecture:** A camada de estado continuará sendo a fonte do contador diário e a UI de execução exibirá `usadas / 1200` e `restantes`. O modo sem gabarito será deliberadamente assistido/manual: ele extrai a questão atual já renderizada, não clica em Resolver, não intercepta resposta, não navega em lote e não participa do contador. O HTML exportado ganhará um pequeno modelo de filtros independente do userscript, com TXT baixável e uma visualização de impressão que o usuário pode salvar como PDF pelo navegador.

**Tech Stack:** Userscript JavaScript ES2015+, IndexedDB V2 existente, DOM nativo, `Blob`/`URL.createObjectURL`, `window.print()`, Node `node:test`, build monolítico em `scripts/build.mjs`.

## Global Constraints

- O limite de resolução permanece exatamente `1.200` por data local, com o saldo visível na aba Execução.
- O modo sem gabarito não poderá usar cliques automáticos a cada 5 ms, remover o limite de quota, acionar reCAPTCHA, interceptar XHR ou navegar em lote.
- O modo sem gabarito seguro será manual/offline: salva somente a questão atualmente renderizada e suas alternativas, sem campo de gabarito.
- O HTML filtrará por matéria/assunto e por uma ou várias bancas; filtro vazio significa “todos”.
- “PDF” será implementado como visualização de impressão filtrada com `window.print()`, permitindo “Salvar como PDF” no diálogo do navegador; não haverá promessa de download silencioso de PDF sem uma biblioteca aprovada.
- O formato dos cadernos existentes, a retomada, o limite diário atual e os exportadores HTML/Excel/JSON devem permanecer compatíveis.
- Cada tarefa deve seguir TDD: teste falhando, implementação mínima, teste focado aprovado e suíte completa antes do commit.

## Mapa de arquivos e responsabilidades

- `src/fabrica/05-estado.js`: contador diário existente e novos helpers puros para o saldo exibível.
- `src/fabrica/06-persistencia.js`: normalização do estado legado e persistência do modo manual, sem quebrar snapshots antigos.
- `src/fabrica/08-extracao.js`: reutilização da extração da questão atual no modo manual, sem chamar o resolvedor.
- `src/fabrica/14-coleta.js`: não receberá um caminho de coleta automática sem gabarito; o coletor atual continuará exigindo gabarito.
- `src/fabrica/17-exportacao.js`: filtros do HTML exportado, geração de TXT e visualização filtrada para PDF.
- `src/fabrica/18-ui.js`: saldo na execução, ação manual sem gabarito e controles de exportação da biblioteca.
- `src/fabrica/manifest.json`: somente atualizar a lista se um novo fragmento de responsabilidade for criado; preferir manter a ordem atual.
- `test/daily-resolution-limit.test.mjs`: ampliar com o contrato do saldo exibível.
- `test/no-answer-manual-mode.test.mjs`: novo teste do modo manual sem gabarito.
- `test/export-filtered-downloads.test.mjs`: novo teste dos filtros, TXT e impressão/PDF.
- `test/build.test.mjs`: garantir que o bundle contenha as novas APIs e continue sintaticamente válido.
- `dist/tec_fabrica_cadernos.user.js`: artefato gerado; nunca editar manualmente.

---

### Task 1: Exibir o saldo diário na execução

**Files:**
- Modify: `src/fabrica/05-estado.js`
- Modify: `src/fabrica/18-ui.js:234-269,561-586`
- Test: `test/daily-resolution-limit.test.mjs`
- Test: `test/ui-integration.test.mjs` ou novo teste de UI focado

**Interfaces:**
- Produces `resumoResolucoesDiarias(valor, agora)` returning `{ data, limite, usadas, restantes, esgotado }`.
- `htmlExecucao()` consumes `resumoResolucoesDiarias(estado)` and renders a stable element `#tf-limite-diario`.
- The text contract is `Resoluções hoje: <usadas>/1200 · Restam <restantes>`.

- [ ] **Step 1: Write the failing model test**

Add to `test/daily-resolution-limit.test.mjs`:

```js
test('saldo diário expõe usadas, limite, restantes e esgotado', () => {
  const api = loadLimitApi();
  const agora = new Date(2026, 7, 14, 12, 0, 0);
  const estado = {
    controleResolucoesDiarias: {
      data: api.chaveDiaLocal(agora),
      total: 37
    }
  };

  assert.deepEqual(api.resumoResolucoesDiarias(estado, agora), {
    data: '2026-08-14',
    limite: 1200,
    usadas: 37,
    restantes: 1163,
    esgotado: false
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --test test/daily-resolution-limit.test.mjs
```

Expected: FAIL because `resumoResolucoesDiarias` is not exported yet.

- [ ] **Step 3: Implement the pure summary helper**

In `src/fabrica/05-estado.js`, add after `resolucoesDiariasRestantes`:

```js
function resumoResolucoesDiarias(valor, agora) {
    normalizarControleResolucoesDiarias(valor, agora);
    var usadas = valor.controleResolucoesDiarias.total;
    return {
        data: valor.controleResolucoesDiarias.data,
        limite: LIMITE_RESOLUCOES_DIARIAS,
        usadas: usadas,
        restantes: Math.max(0, LIMITE_RESOLUCOES_DIARIAS - usadas),
        esgotado: usadas >= LIMITE_RESOLUCOES_DIARIAS
    };
}
```

Expose it in the test VM alongside the existing daily helpers.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same command and expect the new test plus the existing daily-limit tests to pass.

- [ ] **Step 5: Write the failing UI contract test**

Assert that the execution HTML contains `id="tf-limite-diario"`, the `usadas/1200` text and the remaining count for a state with 37 used resolutions.

- [ ] **Step 6: Render and refresh the quota block**

In `htmlExecucao()`, calculate `var diario = resumoResolucoesDiarias(estado);` and insert:

```js
'<div class="tf-status-msg" id="tf-limite-diario">Resoluções hoje: ' + diario.usadas + '/' + diario.limite + ' · Restam ' + diario.restantes + '</div>'
```

Call `UI.renderProgresso()` after a successful `reservarResolucaoDiaria` and when the limit branch pauses execution, so the number changes immediately without requiring a tab switch.

- [ ] **Step 7: Run UI and full regression tests**

```powershell
node --test test/daily-resolution-limit.test.mjs test/ui-integration.test.mjs
```

Expected: PASS before moving to the next task.

- [ ] **Step 8: Commit the isolated quota UI change**

```powershell
git add src/fabrica/05-estado.js src/fabrica/18-ui.js test/daily-resolution-limit.test.mjs test/ui-integration.test.mjs
git commit -m "feat: exibe saldo diario de resolucoes"
```

---

### Task 2: Criar o modo manual sem gabarito

**Files:**
- Modify: `src/fabrica/06-persistencia.js`
- Modify: `src/fabrica/18-ui.js:272-301,451-476`
- Modify: `src/fabrica/08-extracao.js` only if a small helper export is needed; do not change extraction semantics unnecessarily
- Create: `test/no-answer-manual-mode.test.mjs`

**Interfaces:**
- Adds `estado.config.modoColeta`, with allowed values `com-gabarito` and `sem-gabarito-manual`; legacy states normalize to `com-gabarito`.
- Produces `salvarQuestaoAtualSemGabarito(caderno)` in the UI layer.
- The function extracts the current DOM question, sets `answer: ''`, sets `answerSource: 'nao-aplicavel'`, appends/replaces by question id, persists with `salvarEstado(true)`, and returns `{ saved: true, questionId, number }`.
- It must not call `resolverParaGabarito`, `navegarQuestao`, `GabaritoInterceptor`, `modalRecaptchaAberto`, or `reservarResolucaoDiaria`.

- [ ] **Step 1: Write the failing state-normalization test**

```js
test('estado legado recebe modo de coleta com gabarito', () => {
  const estado = normalizarEstadoPersistido({ biblioteca: {}, config: {} });
  assert.equal(estado.config.modoColeta, 'com-gabarito');
});
```

- [ ] **Step 2: Run it and verify the expected failure**

```powershell
node --test test/no-answer-manual-mode.test.mjs
```

Expected: FAIL because `modoColeta` is not normalized.

- [ ] **Step 3: Normalize the mode without changing the active collector**

In `normalizarEstadoPersistido`, use:

```js
valor.config = valor.config && typeof valor.config === 'object' ? valor.config : {};
if (valor.config.modoColeta !== 'sem-gabarito-manual') valor.config.modoColeta = 'com-gabarito';
```

Do not add an automatic no-answer branch to `14-coleta.js`; the existing automatic collector remains answer-aware and quota-controlled.

- [ ] **Step 4: Add the manual extraction behavior test**

Use a VM context with a fake `extrairQuestaoAtual()` returning a question with two options and spies for `resolverParaGabarito`, `navegarQuestao` and `reservarResolucaoDiaria`. Assert that:

```js
const result = await salvarQuestaoAtualSemGabarito(caderno);
assert.deepEqual(result, { saved: true, questionId: 'q-1', number: 1 });
assert.equal(caderno.questoes[0].answer, '');
assert.equal(caderno.questoes[0].answerSource, 'nao-aplicavel');
assert.equal(resolveCalls, 0);
assert.equal(navigationCalls, 0);
assert.equal(quotaCalls, 0);
```

- [ ] **Step 5: Run the behavior test and verify it fails**

```powershell
node --test test/no-answer-manual-mode.test.mjs
```

Expected: FAIL because the manual action does not exist.

- [ ] **Step 6: Implement the manual UI action**

Add a button visible only on a caderno route when a current question is available:

```html
<button class="tf-btn sec" data-acao="salvar-sem-gabarito">Salvar questão sem gabarito</button>
```

The handler must call `extrairQuestaoAtual()`, preserve `statementHtml`, `statement`, `options`, subject, topic and metadata, clear `answer`, save the caderno in `estado.biblioteca`, call `salvarEstado(true)`, render the library/progress and show `Questão salva sem gabarito.`.

- [ ] **Step 7: Add a visible safety explanation**

In the configuration UI, label this mode as `Manual/offline — sem gabarito` and explain that it saves the currently visible question only; it does not run automatic clicks or navigation. Do not expose a 5 ms interval or a “sem limite” switch.

- [ ] **Step 8: Run focused and full tests**

```powershell
node --test test/no-answer-manual-mode.test.mjs test/daily-resolution-limit.test.mjs
$testFiles = Get-ChildItem test -Filter '*.test.mjs' | Select-Object -ExpandProperty FullName
node --test $testFiles
```

Expected: all tests pass and the existing 1,200-limit tests remain unchanged and green.

- [ ] **Step 9: Commit the safe manual-mode change**

```powershell
git add src/fabrica/06-persistencia.js src/fabrica/18-ui.js test/no-answer-manual-mode.test.mjs
git commit -m "feat: adiciona coleta manual sem gabarito"
```

---

### Task 3: Add a reusable filter model to the exported HTML

**Files:**
- Modify: `src/fabrica/17-exportacao.js:59-190`
- Create: `test/export-filtered-downloads.test.mjs`

**Interfaces:**
- Produces `normalizeExportFilters(filters)` returning `{ subjects: [], banks: [] }`.
- Produces `filterExportQuestions(questions, filters)` preserving original order.
- A question matches when its subject is in `subjects` (or subjects is empty) and its bank is in `banks` (or banks is empty).
- The generated HTML runtime must use the same filter model for on-screen questions, TXT and PDF/print output.

- [ ] **Step 1: Write failing pure filter tests**

```js
test('filtra por uma matéria e várias bancas preservando a ordem', () => {
  const questions = [
    { id: '1', subject: 'Morfologia', bank: 'FCC' },
    { id: '2', subject: 'Sintaxe', bank: 'FGV' },
    { id: '3', subject: 'Morfologia', bank: 'FGV' }
  ];
  assert.deepEqual(filterExportQuestions(questions, { subjects: ['Morfologia'], banks: ['FCC', 'FGV'] }).map(q => q.id), ['1', '3']);
  assert.deepEqual(filterExportQuestions(questions, { subjects: [], banks: [] }).map(q => q.id), ['1', '2', '3']);
});
```

- [ ] **Step 2: Run and verify the filter test fails**

```powershell
node --test test/export-filtered-downloads.test.mjs
```

Expected: FAIL because the filter functions are not exported.

- [ ] **Step 3: Implement pure filter functions**

Add the functions before `buildInteractiveHtml`, normalize empty values, trim strings and deduplicate selected values. Expose them through `__TecFabricaExport` for tests and keep the browser runtime implementation aligned with the same matching rules.

- [ ] **Step 4: Run the filter tests**

Expected: filter tests pass for one bank, multiple banks, one subject, no filters, unknown values and stable question order.

---

### Task 4: Add filtered TXT download inside the HTML

**Files:**
- Modify: `src/fabrica/17-exportacao.js` inside the generated runtime and `buildInteractiveHtml`
- Modify: `test/export-filtered-downloads.test.mjs`

**Interfaces:**
- Produces `formatQuestionAsTxt(question, index)` and `buildTxtExport(questions, entry)`.
- TXT includes question number, subject, topic, bank, statement text and every option; it must not require a gabarito.
- The exported HTML contains `#downloadTxt` and uses the currently selected filters.

- [ ] **Step 1: Write failing TXT tests**

Assert that filtered TXT contains only matching question ids/titles, includes `Certo` and `Errado` options, and remains usable when `answer` is empty.

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
node --test test/export-filtered-downloads.test.mjs
```

Expected: FAIL because the TXT builder/button does not exist.

- [ ] **Step 3: Implement TXT generation and button wiring**

Use `Blob([text], { type: 'text/plain;charset=utf-8' })` and the existing `baixarBlob`. The runtime must call `filterExportQuestions(data.questions, currentFilters)` before generating text and update the status with the filtered count.

- [ ] **Step 4: Run the TXT tests and full export tests**

```powershell
node --test test/export-filtered-downloads.test.mjs test/exportacao.test.mjs
```

Expected: PASS.

---

### Task 5: Add filtered PDF/print output inside the HTML

**Files:**
- Modify: `src/fabrica/17-exportacao.js` inside the generated runtime and `buildInteractiveHtml`
- Modify: `test/export-filtered-downloads.test.mjs`

**Interfaces:**
- Produces `buildPrintHtml(questions, entry)` with escaped text/HTML and print-only CSS.
- The exported HTML contains `#downloadPdf` with label `Salvar PDF / Imprimir`.
- The action opens a print view/window containing only filtered questions, then calls `print()` after load; it must not include the interactive controls or nonmatching questions.

- [ ] **Step 1: Write failing print/PDF tests**

Assert that `buildPrintHtml` contains matching questions only, has `@media print`, escapes unsafe user-provided content and does not contain the interactive answer controls.

- [ ] **Step 2: Run and verify failure**

```powershell
node --test test/export-filtered-downloads.test.mjs
```

Expected: FAIL because `buildPrintHtml` and `#downloadPdf` are absent.

- [ ] **Step 3: Implement print view**

Create a new window with a `Blob` URL or a data URL containing the print HTML, register `onload` to call `print()`, and revoke the URL after the window is closed. Use `textContent`/escaped strings for text and preserve trusted question HTML only through the existing sanitized `statementHtml` path.

- [ ] **Step 4: Run focused export tests**

```powershell
node --test test/export-filtered-downloads.test.mjs test/exportacao.test.mjs
```

Expected: PASS. The test should verify the generated contract rather than claiming a native PDF file was created in Node; browser manual validation must confirm the print dialog opens.

---

### Task 6: Add subject/multi-bank controls and finish integration

**Files:**
- Modify: `src/fabrica/17-exportacao.js`
- Modify: `src/fabrica/18-ui.js:272-301,461-476`
- Modify: `test/ui-integration.test.mjs`
- Modify: `test/build.test.mjs`
- Modify: `dist/tec_fabrica_cadernos.user.js` generated by build

**Interfaces:**
- The exported HTML provides a multi-select or checkbox group for `subject` and `bank`, with clear-all controls.
- The userscript library cards expose TXT/PDF actions for a caderno and category export where applicable.
- Existing HTML/Excel/JSON/ZIP actions remain available.

- [ ] **Step 1: Write failing UI/build contract tests**

Assert for the generated HTML and UI source:

```js
assert.match(html, /id="downloadTxt"/);
assert.match(html, /id="downloadPdf"/);
assert.match(html, /data-filter="subject"/);
assert.match(html, /data-filter="bank"/);
assert.match(uiSource, /data-acao="txt"/);
assert.match(uiSource, /data-acao="pdf"/);
```

- [ ] **Step 2: Run and verify the contracts fail**

```powershell
node --test test/ui-integration.test.mjs test/build.test.mjs
```

- [ ] **Step 3: Wire filter controls and export actions**

Use delegated listeners in the generated HTML runtime, update the visible question count, and make TXT/PDF use the same `currentFilters` object. In the userscript library, add `baixarTxtCaderno` and `baixarPdfCaderno` wrappers that call the same filtered builders with no filters selected.

- [ ] **Step 4: Build and run the complete suite**

```powershell
node scripts/build.mjs
node --check dist/tec_fabrica_cadernos.user.js
$testFiles = Get-ChildItem test -Filter '*.test.mjs' | Select-Object -ExpandProperty FullName
node --test $testFiles
git diff --check
```

Expected: build succeeds, syntax check succeeds and every test passes.

- [ ] **Step 5: Perform browser validation**

On a generated HTML file containing at least two subjects and two banks:

1. Select one subject and two banks; verify the visible count and TXT contain only the intersection.
2. Clear subject and keep one bank; verify all subjects from that bank remain.
3. Click `Salvar PDF / Imprimir`; verify only the filtered questions appear in print preview.
4. Open a question without a gabarito; verify TXT/PDF still include its statement and alternatives.
5. On the userscript execution tab, verify `Resoluções hoje: x/1200 · Restam y` changes after a real quota reservation.
6. On a caderno page, click `Salvar questão sem gabarito`; verify one question is persisted without triggering Resolver or changing the daily quota.

- [ ] **Step 6: Commit the integration**

```powershell
git add src/fabrica/17-exportacao.js src/fabrica/18-ui.js test/export-filtered-downloads.test.mjs test/ui-integration.test.mjs test/build.test.mjs dist/tec_fabrica_cadernos.user.js
git commit -m "feat: adiciona exportacao filtrada txt e pdf"
```

## Self-review

- Quota display: covered by Task 1 and refreshed after reservations.
- Requested unlimited 5 ms automatic mode: intentionally not implemented; Task 2 provides the safe manual/offline substitute and explicitly prevents resolver, network interception and batch navigation.
- No-gabarito question capture: covered by Task 2 and browser validation step 6.
- TXT download: covered by Tasks 4 and 6.
- PDF flow: covered by Task 5 as print-to-PDF, with the browser limitation documented.
- Subject filter: covered by Tasks 3 and 6.
- One or multiple bank filters: covered by Tasks 3 and 6.
- Existing modes and exports: preserved by global constraints and full-suite/build checks.

