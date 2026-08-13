import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const planoSource = readFileSync(resolve(root, 'src/fabrica/04-plano.js'), 'utf8');
const modelSource = readFileSync(resolve(root, 'src/fabrica/18-ui-model.js'), 'utf8');
const persistenceSource = readFileSync(resolve(root, 'src/fabrica/06-persistencia.js'), 'utf8');
const uiSource = readFileSync(resolve(root, 'src/fabrica/18-ui.js'), 'utf8');

function extrairHtmlPlano() {
  const inicio = uiSource.indexOf('function htmlPlano() {');
  const fim = uiSource.indexOf('function htmlConfig() {', inicio);
  assert.notEqual(inicio, -1, 'htmlPlano ausente');
  assert.notEqual(fim, -1, 'limite de htmlPlano ausente');
  return uiSource.slice(inicio, fim);
}

function extrairStatusMaterias() {
  const inicio = uiSource.indexOf('function statusMaterias(estado) {');
  const fim = uiSource.indexOf('function htmlPlano() {', inicio);
  assert.notEqual(inicio, -1, 'statusMaterias ausente');
  assert.notEqual(fim, -1, 'limite de statusMaterias ausente');
  return uiSource.slice(inicio, fim);
}

const htmlPlanoSource = extrairHtmlPlano();
const statusMateriasSource = extrairStatusMaterias();

function escaparHtml(valor) {
  return String(valor == null ? '' : valor).replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
}

function criarContextoPlano(estado) {
  const contexto = vm.createContext({
    CONFIG: { banks: ['Cebraspe'], years: [2024] },
    estado,
    clean: (valor) => String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim(),
    log: () => {},
    escapeHtml: escaparHtml,
    acharCadernoPorTitulo: () => null,
    JSON,
    console
  });
  contexto.window = contexto;
  vm.runInContext(`${modelSource}\n${planoSource}\n${statusMateriasSource}\n${htmlPlanoSource}\nthis.renderizarPlano = htmlPlano;`, contexto);
  return contexto;
}

function restaurarEstado(estado) {
  const window = {};
  const contexto = vm.createContext({ window, Map, Set, Promise, Date, JSON, Object, Array, console, setTimeout, clearTimeout });
  vm.runInContext(`var CONFIG = { storageKey: 'tec_fabrica_estado_v1' };\n${persistenceSource}`, contexto);
  return window.__TecFabricaPersistence.reconstruirEstadoV2({
    key: 'state',
    schema: 2,
    planoTexto: estado.planoTexto,
    plano: JSON.parse(JSON.stringify(estado.plano))
  }, [], []);
}

function valorDoTextarea(html) {
  const inicio = html.indexOf('<textarea id="tf-plano-texto"');
  assert.notEqual(inicio, -1, 'textarea do plano ausente');
  let aspas = '';
  let fimAbertura = -1;
  for (let indice = inicio; indice < html.length; indice += 1) {
    const caractere = html.charAt(indice);
    if (aspas) {
      if (caractere === aspas) aspas = '';
    } else if (caractere === '"' || caractere === "'") {
      aspas = caractere;
    } else if (caractere === '>') {
      fimAbertura = indice;
      break;
    }
  }
  assert.notEqual(fimAbertura, -1, 'fecho da abertura do textarea ausente');
  const fim = html.indexOf('</textarea>', fimAbertura);
  assert.notEqual(fim, -1, 'fecho do textarea ausente');
  return html.slice(fimAbertura + 1, fim)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const primeiroTexto = JSON.stringify({
  name: 'Plano <Alfa>',
  banks: ['Cebraspe'],
  years: [2024],
  matters: [
    { code: 'MAT-001', title: 'Português', group: 'Base', subjectIds: ['101', '102'], subjectPaths: ['Língua > Morfologia', 'Língua > Sintaxe'] },
    { code: 'MAT-002', title: 'Direito', group: 'Específica', subjectIds: ['201'], subjectPaths: ['Constitucional'] }
  ]
});

const segundoTexto = JSON.stringify({
  name: 'Plano Beta',
  banks: ['FGV'],
  years: [2025],
  matters: [
    { code: 'MAT-003', title: 'Administração', group: 'Base', subjectIds: ['301'], subjectPaths: ['Gestão'] }
  ]
});

test('resumo do Plano fica antes da edição e informa nome escapado e contagens', () => {
  const vazio = criarContextoPlano({ plano: { name: 'Vazio', matters: [], banks: [], years: [] }, planoTexto: '{"matters":[]}' });
  assert.doesNotThrow(() => vazio.renderizarPlano());

  const estado = { plano: null, planoTexto: '' };
  const contexto = criarContextoPlano(estado);
  contexto.PLANO_UI_MODEL.carregarPlano(primeiroTexto, contexto.normalizarPlano, estado);
  const html = contexto.renderizarPlano();

  assert.match(html, /<div class="tf-resumo tf-plano-resumo"><b>Plano &lt;Alfa&gt;<\/b>/);
  assert.match(html, /2 matérias/);
  assert.match(html, /2 categorias/);
  assert.match(html, /3 assuntos/);
  assert.equal((html.match(/tf-plano-resumo/g) || []).length, 1, 'deve renderizar exatamente um resumo do plano');
  assert.ok(html.indexOf('tf-plano-resumo') < html.indexOf('for="tf-plano-texto"'), 'resumo precisa preceder o editor');
  assert.equal(valorDoTextarea(html), primeiroTexto);
});

test('ciclo comportamental mantém o último plano válido em persistência e re-render', () => {
  const estadoInicial = { plano: null, planoTexto: '' };
  const primeiroContexto = criarContextoPlano(estadoInicial);

  primeiroContexto.PLANO_UI_MODEL.carregarPlano(primeiroTexto, primeiroContexto.normalizarPlano, estadoInicial);
  assert.equal(valorDoTextarea(primeiroContexto.renderizarPlano()), primeiroTexto);

  const restaurado = restaurarEstado(estadoInicial);
  assert.ok(restaurado, 'estado persistido precisa ser restaurável');
  const contextoRestaurado = criarContextoPlano(restaurado);
  assert.equal(valorDoTextarea(contextoRestaurado.renderizarPlano()), primeiroTexto);

  contextoRestaurado.PLANO_UI_MODEL.carregarPlano(segundoTexto, contextoRestaurado.normalizarPlano, restaurado);
  const antesDoInvalido = JSON.stringify(restaurado);
  assert.throws(
    () => contextoRestaurado.PLANO_UI_MODEL.carregarPlano('{"matters":[', contextoRestaurado.normalizarPlano, restaurado),
    /JSON incompleto/
  );
  assert.equal(JSON.stringify(restaurado), antesDoInvalido, 'plano inválido não pode apagar o plano anterior');

  const htmlReRenderizado = contextoRestaurado.renderizarPlano();
  assert.equal(valorDoTextarea(htmlReRenderizado), segundoTexto, 'texto do último plano válido não pode sumir no re-render');
  assert.match(htmlReRenderizado, /<b>Plano Beta<\/b>/);
  assert.match(htmlReRenderizado, /1 matéria/);
  assert.match(htmlReRenderizado, /1 categoria/);
  assert.match(htmlReRenderizado, /1 assunto/);
});
