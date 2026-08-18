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

function loadQuestaoId({ href, textoLink, titulo }) {
  const window = {};
  const link = href || textoLink ? {
    href,
    textContent: textoLink || '',
    getAttribute: (nome) => nome === 'href' ? href : null,
  } : null;
  const document = {
    querySelector(selector) {
      if (selector === "a.id-questao[href*='/questoes/']") return link;
      if (selector === 'h1') return titulo == null ? null : { textContent: titulo };
      return null;
    },
  };
  const context = { window, document, location: { pathname: '', search: '' }, estado: {}, CONFIG: {}, log() {}, console };
  vm.runInNewContext(`${paginasSource}\nwindow.__questaoIdTest = { lerQuestaoIdAtual };`, context, { filename: '07-paginas.js' });
  return window.__questaoIdTest.lerQuestaoIdAtual();
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

test('identifica a questão pelo link id-questao antes do texto do h1', () => {
  assert.equal(loadQuestaoId({
    href: 'https://www.tecconcursos.com.br/questoes/3815580',
    textoLink: '#3815580',
    titulo: '#9999999',
  }), '3815580');
  assert.equal(loadQuestaoId({ titulo: '#3815581 FCC - 2025' }), '3815581');
});

test('coleta consulta o índice global antes de extrair e ignora IDs existentes', () => {
  const consulta = coletaSource.indexOf('questoesPorId.get(String(idQuestaoAtual))');
  const extracao = coletaSource.indexOf(': extrairQuestaoAtual();');
  const pulo = coletaSource.indexOf("if (existente) {");
  const resolucao = coletaSource.indexOf('resolverParaGabarito(questao)');
  assert.ok(consulta >= 0 && consulta < extracao);
  assert.ok(pulo >= 0 && pulo < resolucao);
  assert.match(coletaSource, /Questão já existe na biblioteca; coleta duplicada ignorada/);
});

test('questão existente na biblioteca não é extraída nem resolvida novamente', async () => {
  const window = {};
  let extracoes = 0;
  let resolucoes = 0;
  const caderno = { id: 'caderno-novo', titulo: 'Novo', total: 1, questoes: [] };
  const context = {
    window,
    CONFIG: { loadTimeout: 1000 },
    estado: { status: 'rodando', config: { modoColeta: 'stealth-offline' } },
    cicloExecucaoId: 0,
    questoesPorId: new Map([['3815580', { id: '3815580', statement: 'já salva' }]]),
    questaoIdsPorCaderno: new Map([['caderno-novo', new Set()]]),
    indexarEstado() {},
    log() {},
    UI: { setStatus() {}, renderBiblioteca() {}, renderProgresso() {} },
    workerTick(intervalo, verificar, timeout, concluir) { concluir(true); },
    lerQuestaoIdAtual: () => '3815580',
    lerPosicao: () => ({ posicao: 1, total: 1 }),
    extrairQuestaoAtual() { extracoes += 1; return null; },
    resolverParaGabarito: async () => { resolucoes += 1; return 'A'; },
    salvarEstado() {},
    console,
  };
  vm.runInNewContext(`${coletaSource}\nwindow.__coletaDuplicadaTest = { coletarCaderno };`, context, { filename: '14-coleta.js' });

  await window.__coletaDuplicadaTest.coletarCaderno(caderno);

  assert.equal(extracoes, 0);
  assert.equal(resolucoes, 0);
  assert.equal(caderno.questoes.length, 0);
  assert.equal(caderno.completo, true);
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

test('pasta reconhece caderno quando o cartão acrescenta metadados ao título', () => {
  const linha = { offsetParent: null, innerText: 'Classes de palavras · 120 questões' };
  const link = {
    href: 'https://www.tecconcursos.com.br/questoes/cadernos/100658768',
    innerText: 'Classes de palavras · 120 questões',
    textContent: 'Classes de palavras · 120 questões',
    offsetParent: null,
    closest(selector) { return selector === '.list-item-caderno' ? linha : null; },
  };
  const helpers = loadFolderHelpers([link]);
  assert.equal(helpers.encontrarLinkCadernoNaPasta('Classes de palavras'), link);
});

test('boot recupera pausa legada somente na fase pasta-check', () => {
  assert.match(inicializacaoSource, /estado\.status === 'pausado' && estado\.fase === 'pasta-check'/);
  assert.match(inicializacaoSource, /estado\.pausaManual !== true/);
  assert.match(inicializacaoSource, /estado\.status = 'rodando'/);
  assert.match(inicializacaoSource, /estado\.pausaManual = false/);
  assert.match(orquestradorSource, /estado\.pausaManual = true/);
  assert.match(orquestradorSource, /estado\.pausaManual = false/);
});
