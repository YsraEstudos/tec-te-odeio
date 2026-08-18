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

test('carregar plano reinicia o reparo anterior à coleta', () => {
  assert.match(source, /estado\.reparoCriacao = null;/);
  assert.match(source, /estado\.reparoCriacaoConcluido = false;/);
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

test('cria fallback para caminho vazio ou nulo e preserva a associação por índice', () => {
  const model = loadModel();
  const assuntos = model.construirAssuntos({
    subjectIds: ['sem-caminho', 'com-caminho', 'sem-caminho-2'],
    subjectPaths: ['', 'Raiz > Folha', null]
  });
  const semCaminho = assuntos.filter((item) => item.label === 'Assunto sem caminho');
  assert.equal(semCaminho.length, 2);
  assert.deepEqual(semCaminho.map((item) => item.code), ['sem-caminho', 'sem-caminho-2']);
  assert.equal(assuntos[1].children[0].code, 'com-caminho');
});

test('agrupa categorias reservadas sem colisão de propriedades e preserva a ordem', () => {
  const model = loadModel();
  const categorias = model.agruparPorCategoria({ matters: [
    { title: 'A', group: '__proto__', subjectIds: [] },
    { title: 'B', group: 'constructor', subjectIds: [] },
    { title: 'C', group: '__proto__', subjectIds: [] }
  ] });
  assert.deepEqual(categorias.map((item) => item.name), ['__proto__', 'constructor']);
  assert.equal(categorias[0].matters.length, 2);
  assert.equal(categorias[1].matters.length, 1);
});

test('renderiza a árvore recolhida e escapa nomes fornecidos pelo plano', () => {
  const model = loadModel();
  const html = model.renderArvore({ matters: [{ title: '<Português>', group: 'Base', subjectIds: ['1'], subjectPaths: ['Língua > Classes'] }] });
  assert.match(html, /&lt;Português&gt;/);
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.doesNotMatch(html, /<details[^>]+open/);
});

test('renderiza selo de status e ações por matéria quando recebe o mapa de status', () => {
  const model = loadModel();
  const html = model.renderArvore({ matters: [
    { title: 'A', group: 'G', subjectIds: ['1'], subjectPaths: ['X'] },
    { title: 'B', group: 'G', subjectIds: ['2'], subjectPaths: ['Y'] }
  ] }, { 0: { tipo: 'atual', rotulo: 'em execução', temCaderno: true }, 1: { tipo: 'pendente', rotulo: 'pendente', temCaderno: false } });
  assert.match(html, /tf-tree-badge-atual">em execução</);
  assert.match(html, /tf-tree-badge-pendente">pendente</);
  assert.match(html, /data-acao="executar-materia" data-indice="0"/);
  assert.match(html, /data-acao="refazer-materia" data-indice="0"/);
  assert.doesNotMatch(html, /data-acao="refazer-materia" data-indice="1"/);
});
