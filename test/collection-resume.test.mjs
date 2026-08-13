import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const paginasSource = readFileSync(resolve(root, 'src/fabrica/07-paginas.js'), 'utf8');
const orquestradorSource = readFileSync(resolve(root, 'src/fabrica/15-orquestrador.js'), 'utf8');
const coletaSource = readFileSync(resolve(root, 'src/fabrica/14-coleta.js'), 'utf8');
const inicializacaoSource = readFileSync(resolve(root, 'src/fabrica/19-inicializacao.js'), 'utf8');

function loadPaginas(texto) {
  const window = {};
  const document = { querySelector: () => ({ textContent: texto }) };
  const context = {
    window,
    document,
    location: { pathname: '/questoes/cadernos/1', search: '' },
    estado: { fase: 'coletando' },
    CONFIG: { pollInterval: 100, loadTimeout: 1000 },
    log() {},
    salvarEstado() {},
    workerTick() {},
    angular: {},
    clean: (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim(),
    console,
  };
  vm.runInNewContext(`${paginasSource}\nwindow.__resumeTest = { lerPosicao };`, context, { filename: '07-paginas.js' });
  const resultado = window.__resumeTest.lerPosicao();
  return resultado && { posicao: resultado.posicao, total: resultado.total };
}

function loadFolderHelpers(links) {
  const window = {};
  const context = {
    window,
    document: { querySelectorAll: () => links },
    estado: { biblioteca: {} },
    clean: (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim(),
    log() {},
    console,
  };
  vm.runInNewContext(`${orquestradorSource}\nwindow.__folderTest = { encontrarLinkCadernoNaPasta, clicarCadernoNaPasta };`, context, { filename: '15-orquestrador.js' });
  return window.__folderTest;
}

test('lerPosicao aceita milhares formatados pelo site em pt-BR', () => {
  assert.deepEqual(loadPaginas('Questão 1.167 de 7.373'), { posicao: 1167, total: 7373 });
  assert.deepEqual(loadPaginas('Questão 1167 de 7373'), { posicao: 1167, total: 7373 });
});

test('coleta não pode transformar posição desconhecida em caderno completo', () => {
  assert.doesNotMatch(coletaSource, /if \(!pos \|\| pos\.posicao >= total\) break/);
  assert.match(coletaSource, /if \(!pos\) \{[\s\S]*?throw new Error\([^)]*posição/);
  assert.match(coletaSource, /var total = pos\.total \|\| caderno\.total/);
  assert.match(coletaSource, /caderno\.totalConfirmado = true/);
});

test('retomada encontra caderno ignorando caixa e acentos no título', () => {
  assert.match(orquestradorSource, /function normalizarTituloCaderno\(titulo\)/);
  assert.match(orquestradorSource, /normalizarTituloCaderno\(b\.titulo\) === alvo/);
  assert.match(orquestradorSource, /existente\.totalConfirmado === true/);
});

test('pasta usa a linha Angular do caderno e não depende de offsetParent', () => {
  assert.match(orquestradorSource, /function clicarCadernoNaPasta\(link\)/);
  assert.match(orquestradorSource, /closest\('\.list-item-caderno'\)/);
  assert.match(orquestradorSource, /if \(typeof alvo\.click === 'function'\)/);
  assert.match(orquestradorSource, /if \(typeof link\.click === 'function'\)/);
});

test('linha real do TecConcursos é localizada e clicada pelo item pai', () => {
  let clicado = false;
  const linha = {
    offsetParent: null,
    click() { clicado = true; },
  };
  const link = {
    href: 'https://www.tecconcursos.com.br/questoes/cadernos/100658768',
    innerText: 'Classes de palavras',
    textContent: 'Classes de palavras',
    offsetParent: null,
    closest(selector) { return selector === '.list-item-caderno' ? linha : null; },
    click() { throw new Error('o teste exige o clique da linha'); },
  };
  const helpers = loadFolderHelpers([link]);
  const encontrado = helpers.encontrarLinkCadernoNaPasta('Classes de palavras');
  assert.equal(encontrado, link);
  assert.equal(helpers.clicarCadernoNaPasta(encontrado), true);
  assert.equal(clicado, true);
});

test('boot recupera pausa legada somente na fase pasta-check', () => {
  assert.match(inicializacaoSource, /estado\.status === 'pausado' && estado\.fase === 'pasta-check'/);
  assert.match(inicializacaoSource, /estado\.pausaManual !== true/);
  assert.match(inicializacaoSource, /estado\.status = 'rodando'/);
  assert.match(inicializacaoSource, /estado\.pausaManual = false/);
  assert.match(orquestradorSource, /estado\.pausaManual = true/);
  assert.match(orquestradorSource, /estado\.pausaManual = false/);
});
