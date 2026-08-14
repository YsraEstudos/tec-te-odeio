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
