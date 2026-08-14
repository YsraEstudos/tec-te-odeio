import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const persistenceSource = readFileSync(resolve(root, 'src/fabrica/06-persistencia.js'), 'utf8');
const uiSource = readFileSync(resolve(root, 'src/fabrica/18-ui.js'), 'utf8');

function loadPersistenceApi() {
  const context = { window: {}, CONFIG: { storageKey: 'test' } };
  vm.runInNewContext(`${persistenceSource}
window.__persistenceNoAnswer = { normalizarEstadoPersistido };`, context, { filename: '06-persistencia.js' });
  return context.window.__persistenceNoAnswer;
}

test('estado legado recebe modo de coleta com gabarito', () => {
  const { normalizarEstadoPersistido } = loadPersistenceApi();
  const estado = normalizarEstadoPersistido({ biblioteca: {}, config: {} });

  assert.equal(estado.config.modoColeta, 'com-gabarito');
});

test('salva a questão atual sem gabarito sem resolver, navegar ou consumir quota', async () => {
  let resolveCalls = 0;
  let navigationCalls = 0;
  let quotaCalls = 0;
  let saveCalls = 0;
  const caderno = { id: 'caderno-1', questoes: [] };
  const question = {
    id: 'q-1',
    number: 1,
    statementHtml: '<p>Enunciado</p>',
    statement: 'Enunciado',
    options: [{ letter: 'A', text: 'Opção A' }, { letter: 'B', text: 'Opção B' }],
    subject: 'Direito',
    topic: 'Constitucional',
    metadata: { banca: 'CESPE' },
    answer: 'A',
    answerSource: 'resolver'
  };
  const context = {
    window: {},
    estado: { biblioteca: { [caderno.id]: caderno } },
    extrairQuestaoAtual: () => ({ ...question, options: question.options.map((option) => ({ ...option })) }),
    salvarEstado: (critical) => { assert.equal(critical, true); saveCalls += 1; },
    resolverParaGabarito: () => { resolveCalls += 1; },
    navegarQuestao: () => { navigationCalls += 1; },
    reservarResolucaoDiaria: () => { quotaCalls += 1; },
    document: {},
    console
  };
  Object.defineProperty(context, 'GabaritoInterceptor', {
    get() { throw new Error('a coleta manual não pode acessar GabaritoInterceptor'); }
  });
  Object.defineProperty(context, 'modalRecaptchaAberto', {
    get() { throw new Error('a coleta manual não pode acessar modalRecaptchaAberto'); }
  });

  vm.runInNewContext(`${uiSource}
window.__noAnswerUi = { salvarQuestaoAtualSemGabarito };`, context, { filename: '18-ui.js' });
  const { salvarQuestaoAtualSemGabarito } = context.window.__noAnswerUi;
  const result = await salvarQuestaoAtualSemGabarito(caderno);

  assert.deepEqual({ ...result }, { saved: true, questionId: 'q-1', number: 1 });
  assert.equal(caderno.questoes[0].answer, '');
  assert.equal(caderno.questoes[0].answerSource, 'nao-aplicavel');
  assert.deepEqual(caderno.questoes[0].options, question.options);
  assert.equal(resolveCalls, 0);
  assert.equal(navigationCalls, 0);
  assert.equal(quotaCalls, 0);
  assert.equal(saveCalls, 1);
});

test('substitui a questão existente pelo mesmo ID sem criar duplicata', async () => {
  const caderno = {
    id: 'caderno-1',
    questoes: [{ id: 'q-1', number: 1, statement: 'versão antiga', answer: 'B', answerSource: 'resolver' }]
  };
  const context = {
    window: {},
    estado: { biblioteca: { [caderno.id]: caderno } },
    extrairQuestaoAtual: () => ({
      id: 'q-1', number: 1, statement: 'versão atual', statementHtml: '<p>versão atual</p>',
      options: [{ letter: 'A', text: 'Opção atual' }], subject: 'Direito', topic: 'Constitucional'
    }),
    salvarEstado() {},
    document: {},
    console
  };

  vm.runInNewContext(`${uiSource}
window.__noAnswerUi = { salvarQuestaoAtualSemGabarito };`, context, { filename: '18-ui.js' });
  await context.window.__noAnswerUi.salvarQuestaoAtualSemGabarito(caderno);

  assert.equal(caderno.questoes.length, 1);
  assert.equal(caderno.questoes[0].statement, 'versão atual');
  assert.equal(caderno.questoes[0].answer, '');
  assert.equal(caderno.questoes[0].answerSource, 'nao-aplicavel');
});

test('ação manual aparece somente no caderno com questão e atualiza a UI ao clicar', () => {
  let route = 'filtros';
  let questionRendered = false;
  let libraryRenders = 0;
  let progressRenders = 0;
  let status = '';
  const caderno = { id: 'caderno-1', questoes: [] };
  const button = {
    listeners: {},
    getAttribute(name) { return name === 'data-acao' ? 'salvar-sem-gabarito' : ''; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    click() { this.listeners.click(); }
  };
  const context = {
    window: {},
    estado: { config: { modoColeta: 'sem-gabarito-manual' }, biblioteca: { [caderno.id]: caderno } },
    paginaAtual: () => route,
    cadernoIdDaUrl: () => caderno.id,
    cadernosPorCategoria: () => ({ Teste: [caderno] }),
    escapeHtml: (value) => String(value),
    extrairQuestaoAtual: () => ({ id: 'q-1', number: 1, statement: 'Enunciado', statementHtml: '<p>Enunciado</p>', options: [] }),
    salvarEstado() {},
    document: { querySelector: () => (questionRendered ? {} : null) },
    console
  };

  vm.runInNewContext(`${uiSource}
window.__noAnswerUi = { htmlBiblioteca, ligarEventos };`, context, { filename: '18-ui.js' });
  assert.doesNotMatch(context.window.__noAnswerUi.htmlBiblioteca(), /salvar-sem-gabarito/);
  route = 'caderno';
  assert.doesNotMatch(context.window.__noAnswerUi.htmlBiblioteca(), /salvar-sem-gabarito/);
  questionRendered = true;
  assert.match(context.window.__noAnswerUi.htmlBiblioteca(), /salvar-sem-gabarito/);

  context.UI.renderBiblioteca = () => { libraryRenders += 1; };
  context.UI.renderProgresso = () => { progressRenders += 1; };
  context.UI.setStatus = (message) => { status = message; };
  const corpo = {
    querySelector: () => null,
    querySelectorAll(selector) { return selector === '[data-acao]' ? [button] : []; }
  };
  context.window.__noAnswerUi.ligarEventos(corpo);
  button.click();

  assert.equal(caderno.questoes.length, 1);
  assert.equal(caderno.questoes[0].answerSource, 'nao-aplicavel');
  assert.equal(libraryRenders, 1);
  assert.equal(progressRenders, 1);
  assert.equal(status, 'Questão salva sem gabarito.');
});
