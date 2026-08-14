import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/06-persistencia.js'), 'utf8');

function loadHooks() {
  const window = {};
  const context = { window, Map, Set, Promise, Date, JSON, Object, Array, console, setTimeout, clearTimeout };
  vm.runInNewContext(`var CONFIG = { storageKey: 'tec_fabrica_estado_v1' };\n${source}`, context);
  return window.__TecFabricaPersistence;
}

test('sanitização remove imagens sem mutar o cache', () => {
  const hooks = loadHooks();
  const original = { statement: 'x data:image/png;base64,AAAA y', nested: ['data:image/jpeg;base64,BBBB'] };
  const clean = hooks.sanitizarParaPersistencia(original);
  assert.equal(clean.statement, 'x ');
  assert.equal(clean.nested[0], '');
  assert.match(original.statement, /data:image/);
});

test('índices Map/Set refletem cadernos e questões', () => {
  const hooks = loadHooks();
  const q = { id: 'q1', number: 2 };
  const state = { biblioteca: { c1: { id: 'c1', questoes: [q] } } };
  hooks.indexarEstado(state);
  assert.equal(hooks.indices.cadernosPorId.get('c1'), state.biblioteca.c1);
  assert.equal(hooks.indices.questoesPorId.get('q1'), q);
  assert.equal(hooks.indices.questaoIdsPorCaderno.get('c1').has('q1'), true);
});

test('validação rejeita snapshots sem biblioteca e aceita agregado', () => {
  const hooks = loadHooks();
  assert.equal(hooks.validarEstado({ schema: 2 }), false);
  assert.equal(hooks.validarEstado({ biblioteca: {} }), true);
});

test('persistência v2 declara stores e índices exigidos', () => {
  assert.match(source, /var estado = estadoVazio\(\);/);
  assert.match(source, /IDB_META_STORE = 'meta'/);
  assert.match(source, /IDB_CADERNOS_STORE = 'cadernos'/);
  assert.match(source, /IDB_QUESTOES_STORE = 'questoes'/);
  assert.match(source, /createIndex\('cadernoId'/);
  assert.match(source, /createIndex\('posicao'/);
  assert.match(source, /legacy-v1-archive/);
  assert.match(source, /SAVE_DEBOUNCE_MS = 5000/);
});

test('reconstrução meta+cadernos+questões preserva o agregado', () => {
  const hooks = loadHooks();
  const state = hooks.reconstruirEstadoV2(
    { key: 'state', schema: 2, status: 'pausado' },
    [{ id: 'c1', titulo: 'Caderno' }],
    [{ id: 'q1', cadernoId: 'c1', number: 1 }]
  );
  assert.equal(state.status, 'pausado');
  assert.deepEqual(JSON.parse(JSON.stringify(state.biblioteca.c1.questoes)), [{ id: 'q1', cadernoId: 'c1', number: 1 }]);
  assert.equal(hooks.reconstruirEstadoV2({ key: 'bad', schema: 1 }, [], []), null);
});

test('estado vazio inicializa texto do plano e v2 preserva texto original', () => {
  const hooks = loadHooks();
  assert.equal(hooks.estadoVazio().planoTexto, '');
  assert.deepEqual(JSON.parse(JSON.stringify(hooks.estadoVazio().logs)), []);
  const restored = hooks.reconstruirEstadoV2(
    { key: 'state', schema: 2, planoTexto: '{"materias":[]}' },
    [],
    []
  );
  assert.equal(restored.planoTexto, '{"materias":[]}');
});

test('estado antigo sem logs é normalizado sem misturar logs à biblioteca', () => {
  const hooks = loadHooks();
  const restored = hooks.reconstruirEstadoV2(
    { key: 'state', schema: 2, status: 'pausado' },
    [{ id: 'c1', titulo: 'Caderno' }],
    []
  );

  assert.deepEqual(JSON.parse(JSON.stringify(restored.logs)), []);
  assert.equal(restored.biblioteca.c1.logs, undefined);
});

test('reconstrução v2 preserva logs no estado e não na biblioteca', () => {
  const hooks = loadHooks();
  const logs = [{ id: 1, at: '2026-08-13T12:00:00.000Z', mensagem: 'ok' }];
  const restored = hooks.reconstruirEstadoV2(
    { key: 'state', schema: 2, logs, planoTexto: 'plano' },
    [{ id: 'c1', titulo: 'Caderno' }],
    [{ id: 'q1', cadernoId: 'c1', number: 1 }]
  );

  assert.deepEqual(JSON.parse(JSON.stringify(restored.logs)), logs);
  assert.equal(restored.biblioteca.c1.logs, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.biblioteca.c1.questoes)), [
    { id: 'q1', cadernoId: 'c1', number: 1 }
  ]);
});

test('parser de migração aceita JSON v1 válido e rejeita inválido', () => {
  const hooks = loadHooks();
  const valid = { biblioteca: { c1: { id: 'c1', questoes: [] } } };
  assert.deepEqual(JSON.parse(JSON.stringify(hooks.parseLegadoV1(JSON.stringify(valid)))), {
    ...valid,
    config: { modoColeta: 'com-gabarito' },
    logs: []
  });
  assert.equal(hooks.parseLegadoV1('{not-json'), null);
  assert.equal(hooks.parseLegadoV1(JSON.stringify({ status: 'parado' })), null);
});

test('debounce coalesce chamadas sucessivas', async () => {
  const hooks = loadHooks();
  let calls = 0;
  const d = hooks.criarDebounce(() => { calls += 1; });
  d.agendar(15); d.agendar(15); d.agendar(15);
  assert.equal(d.pendente(), true);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(calls, 1);
  assert.equal(d.pendente(), false);
});
