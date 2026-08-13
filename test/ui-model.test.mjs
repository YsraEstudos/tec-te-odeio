import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/18-ui-model.js'), 'utf8');

function loadModel() {
  const window = {};
  const context = { window, JSON, Object, Array, String, Map };
  vm.runInNewContext(source, context);
  return window.PLANO_UI_MODEL || context.PLANO_UI_MODEL;
}

test('mantém o texto colado e usa fallback para estados antigos', () => {
  const model = loadModel();
  const original = '{\n  "materias": []\n}';
  assert.equal(model.textoParaEdicao({ planoTexto: original, plano: { matters: [] } }), original);
  assert.match(model.textoParaEdicao({ plano: { name: 'Plano antigo', matters: [] } }), /Plano antigo/);
  assert.equal(model.textoParaEdicao({ plano: null }), '');
});

test('só substitui o plano depois que a normalização termina', () => {
  const model = loadModel();
  const anterior = { planoTexto: 'anterior', plano: { name: 'Anterior' } };
  assert.throws(() => model.carregarPlano('novo inválido', () => { throw new Error('inválido'); }, anterior), /inválido/);
  assert.deepEqual(anterior, { planoTexto: 'anterior', plano: { name: 'Anterior' } });

  const novo = { name: 'Novo', matters: [] };
  assert.equal(model.carregarPlano('novo válido', () => novo, anterior), novo);
  assert.equal(anterior.planoTexto, 'novo válido');
  assert.equal(anterior.plano, novo);
});

test('agrupa matérias por categoria e cria níveis deduplicados de submatérias', () => {
  const model = loadModel();
  const categorias = model.agruparPorCategoria({ matters: [
    { title: 'Português', group: 'Base', subjectIds: ['1', '2'], subjectPaths: ['Língua > Morfologia', 'Língua > Morfologia > Classes'] },
    { title: 'Direito', group: 'Específica', subjectIds: ['3'], subjectPaths: ['Constitucional'] },
    { title: 'Redação', group: 'Base', subjectIds: ['4'], subjectPaths: ['Língua > Morfologia'] }
  ] });
  assert.deepEqual(categorias.map((item) => item.name), ['Base', 'Específica']);
  assert.equal(categorias[0].matters.length, 2);
  assert.equal(model.construirAssuntos(categorias[0].matters[0]).length, 1);
  assert.equal(model.construirAssuntos(categorias[0].matters[0])[0].children.length, 1);
  assert.equal(model.construirAssuntos(categorias[0].matters[0])[0].children[0].label, 'Morfologia');
});

test('renderiza a árvore recolhida e escapa nomes fornecidos pelo plano', () => {
  const model = loadModel();
  const html = model.renderArvore({ matters: [{ title: '<Português>', group: 'Base', subjectIds: ['1'], subjectPaths: ['Língua > Classes'] }] });
  assert.match(html, /&lt;Português&gt;/);
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.doesNotMatch(html, /<details[^>]+open/);
});
