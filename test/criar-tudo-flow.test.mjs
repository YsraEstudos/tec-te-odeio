import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const orchestratorSource = readFileSync(resolve(root, 'src/fabrica/15-orquestrador.js'), 'utf8');
const persistenceSource = readFileSync(resolve(root, 'src/fabrica/06-persistencia.js'), 'utf8');
const uiSource = readFileSync(resolve(root, 'src/fabrica/18-ui.js'), 'utf8');

test('config declara o fluxo de criação criar-tudo', () => {
  const configSource = readFileSync(resolve(root, 'src/fabrica/01-config.js'), 'utf8');
  assert.match(configSource, /modoCriacao: 'padrao'/);
  assert.match(configSource, /'criar-tudo'/);
});

test('estado vazio inicia na passada de criação', () => {
  const context = { window: {}, CONFIG: { storageKey: 'test' } };
  vm.runInNewContext(`${persistenceSource}
window.__persist = { estadoVazio, normalizarEstadoPersistido };`, context, { filename: '06-persistencia.js' });
  const { estadoVazio, normalizarEstadoPersistido } = context.window.__persist;
  assert.equal(estadoVazio().passada, 'criacao');
  const legado = normalizarEstadoPersistido({ biblioteca: {}, config: {} });
  assert.equal(legado.passada, 'criacao');
  assert.equal(legado.config.modoCriacao, 'padrao');
  const coleta = normalizarEstadoPersistido({ biblioteca: {}, passada: 'coleta', config: { modoCriacao: 'criar-tudo' } });
  assert.equal(coleta.passada, 'coleta');
  assert.equal(coleta.config.modoCriacao, 'criar-tudo');
});

test('orquestrador: passada de criação avança matérias com caderno sem coletar', () => {
  assert.match(orchestratorSource, /function modoCriarTudoAtivo\(\)/);
  assert.match(orchestratorSource, /function passadaCriacao\(\)/);
  assert.match(orchestratorSource, /function iniciarPassadaColeta\(\)/);
  assert.match(orchestratorSource, /if \(passadaCriacao\(\) && estado\.plano && estado\.planIndex >= estado\.plano\.matters\.length\)/);
  assert.match(orchestratorSource, /if \(passadaCriacao\(\) && estado\.planIndex >= plano\.matters\.length\)/);
});

test('orquestrador: caderno registrado na passada de criação apenas avança', () => {
  assert.match(orchestratorSource, /if \(passadaCriacao\(\)\) \{\s*log\('decisão: caderno já registrado; avançando matéria \(passada de criação\)\.'/);
});

test('orquestrador: caderno recém-criado avança diretamente na passada de criação', () => {
  assert.match(orchestratorSource, /var deveAvancarSemColetar = passadaCriacao\(\);/);
  assert.match(orchestratorSource, /if \(deveAvancarSemColetar\) \{\s*avancarMateria\(\);\s*return;/);
});

test('orquestrador continua quando a criação muda a rota por SPA', () => {
  assert.match(orchestratorSource, /if \(paginaAtual\(\) === 'caderno'\) processarLote\(\);/);
});

test('retomada em caderno recupera checkpoint que ficou em criar-novo', () => {
  assert.match(orchestratorSource, /function registrarCadernoCriadoNaRota\(materia\)/);
  assert.match(orchestratorSource, /paginaAtual\(\) === 'caderno' && estado\.fase === 'criar-novo'/);
  assert.match(orchestratorSource, /origem: 'rota-pos-criacao'/);
});

test('orquestrador: passada de coleta pula matérias sem caderno', () => {
  assert.match(orchestratorSource, /estado\.passada === 'coleta' && !existente/);
  assert.match(orchestratorSource, /a passada de criação já rodou/);
});

test('orquestrador: caderno encontrado na pasta na passada de criação não abre para coleta', () => {
  assert.match(orchestratorSource, /if \(passadaCriacao\(\)\) \{\s*log\('decisão: caderno registrado sem coletar \(passada de criação\)/);
});

test('UI expõe o seletor de fluxo de criação e o persiste na config', () => {
  assert.match(uiSource, /id="tf-modo-criacao"/);
  assert.match(uiSource, /value="criar-tudo"/);
  assert.match(uiSource, /Criar todos os cadernos primeiro, depois coletar as questões/);
  assert.match(uiSource, /cfg\.modoCriacao = \(modoCriacaoEl\.value === 'criar-tudo'\) \? 'criar-tudo' : 'padrao';/);
  assert.match(uiSource, /modoCriacao: CONFIG\.modoCriacao/);
});

test('UI indica a passada atual na aba de execução', () => {
  assert.match(uiSource, /Passada 1\/2 · criando cadernos/);
  assert.match(uiSource, /Passada 2\/2 · coletando questões/);
});

test('estado vazio e normalização preservam a cronometria de criação', () => {
  const context = { window: {}, CONFIG: { storageKey: 'test' } };
  vm.runInNewContext(`${persistenceSource}
window.__persist = { estadoVazio, normalizarEstadoPersistido };`, context, { filename: '06-persistencia.js' });
  const { estadoVazio, normalizarEstadoPersistido } = context.window.__persist;
  assert.deepEqual(JSON.parse(JSON.stringify(estadoVazio().cronometriaCriacao)), { amostras: [], atual: null });
  const legado = normalizarEstadoPersistido({ biblioteca: {}, config: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(legado.cronometriaCriacao)), { amostras: [], atual: null });
  const comAmostras = normalizarEstadoPersistido({ biblioteca: {}, config: {}, cronometriaCriacao: { amostras: [{ ms: 61000, delayMin: 3000, delayMax: 6000 }], atual: { planIndex: 1, inicio: 1, delayMin: 3000, delayMax: 6000 } } });
  assert.equal(comAmostras.cronometriaCriacao.amostras.length, 1);
  assert.equal(comAmostras.cronometriaCriacao.atual.planIndex, 1);
});

test('cronometria: início e conclusão da criação registram amostra com o delay usado', () => {
  const contexto = vm.createContext({
    estado: {
      plano: { matters: [{ title: 'A' }, { title: 'B' }] },
      config: { modoCriacao: 'criar-tudo' },
      passada: 'criacao',
      planIndex: 0,
      cronometriaCriacao: { amostras: [], atual: null }
    },
    CONFIG: { delayMin: 3500, delayMax: 6500 },
    Date
  });
  vm.runInContext(orchestratorSource, contexto);
  contexto.marcarInicioCriacao();
  assert.equal(contexto.estado.cronometriaCriacao.atual.planIndex, 0);
  contexto.marcarInicioCriacao();
  assert.equal(contexto.estado.cronometriaCriacao.atual.planIndex, 0);
  contexto.estado.cronometriaCriacao.atual.inicio = Date.now() - 40000;
  contexto.registrarCriacaoConcluida();
  assert.equal(contexto.estado.cronometriaCriacao.amostras.length, 1);
  assert.equal(contexto.estado.cronometriaCriacao.atual, null);
  const amostra = contexto.estado.cronometriaCriacao.amostras[0];
  assert.ok(amostra.ms >= 39000 && amostra.ms <= 41000);
  assert.equal(amostra.delayMin, 3500);
  assert.equal(amostra.delayMax, 6500);
});

test('estimativa restante: usa a média das amostras e escala pelo delay atual', () => {
  const contexto = vm.createContext({
    estado: {
      plano: { matters: Array.from({ length: 10 }, (_, i) => ({ title: 'M' + i })) },
      config: { modoCriacao: 'criar-tudo' },
      passada: 'criacao',
      planIndex: 3,
      cronometriaCriacao: {
        amostras: [
          { ms: 60000, delayMin: 3000, delayMax: 3000 },
          { ms: 90000, delayMin: 3000, delayMax: 3000 }
        ],
        atual: null
      }
    },
    CONFIG: { delayMin: 6000, delayMax: 6000 }
  });
  vm.runInContext(orchestratorSource, contexto);
  const r = contexto.estimarRestanteCriacao();
  assert.equal(r.restantes, 7);
  assert.equal(r.temAmostras, true);
  assert.equal(r.porMateriaMs, 150000);
  assert.equal(r.totalMs, 1050000);
  contexto.CONFIG.delayMin = 3000;
  contexto.CONFIG.delayMax = 3000;
  const r2 = contexto.estimarRestanteCriacao();
  assert.equal(r2.porMateriaMs, 75000);
  const vazio = vm.createContext({
    estado: { plano: { matters: [{ title: 'A' }] }, config: { modoCriacao: 'criar-tudo' }, passada: 'criacao', planIndex: 0, cronometriaCriacao: { amostras: [], atual: null } },
    CONFIG: { delayMin: 3000, delayMax: 6000 }
  });
  vm.runInContext(orchestratorSource, vazio);
  assert.equal(vazio.estimarRestanteCriacao().temAmostras, false);
});

test('aba execução mostra matérias restantes, controle de delay e estimativa', () => {
  assert.match(uiSource, /Faltam <b id="tf-restantes-exec">/);
  assert.match(uiSource, /id="tf-delay-exec"/);
  assert.match(uiSource, /Tempo entre cliques \(s\)/);
  assert.match(uiSource, /id="tf-eta-exec"/);
  assert.match(uiSource, /atualizarCronometriaExec\(\)/);
  assert.match(uiSource, /tf-delay-exec/);
  assert.match(uiSource, /CONFIG\.delayMin = dmin;/);
});

test('transição de passada reinicia o plano para a coleta', () => {
  const contexto = vm.createContext({
    estado: {
      passada: 'criacao',
      planIndex: 2,
      loteInicio: 0,
      loteFim: 2,
      cadernoAtual: { id: 'x' },
      fase: 'coletando',
      plano: { matters: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] },
      config: { batchSize: 20, modoCriacao: 'criar-tudo' },
      mensagem: ''
    },
    salvarEstado: () => {},
    UI: { renderProgresso: () => {} },
    log: () => {},
    processarLote: () => { contexto.chamouProcessar = true; },
    CONFIG: { batchSize: 20 }
  });
  vm.runInContext(`
    function modoCriarTudoAtivo() { return !!(estado.config && estado.config.modoCriacao === 'criar-tudo'); }
    function passadaCriacao() { return modoCriarTudoAtivo() && estado.passada !== 'coleta'; }
    function iniciarPassadaColeta() {
      var plano = estado.plano || { matters: [] };
      var config = estado.config || {};
      estado.passada = 'coleta';
      estado.planIndex = 0;
      estado.loteInicio = 0;
      estado.loteFim = Math.min(config.batchSize || CONFIG.batchSize || 20, plano.matters.length);
      estado.cadernoAtual = null;
      estado.fase = 'nenhuma';
      estado.mensagem = 'Todos os cadernos do plano foram criados; iniciando a coleta das questões...';
      salvarEstado(true);
      UI.renderProgresso();
      log('x');
      processarLote();
    }
    function avancarMateria() {
      estado.planIndex += 1;
      estado.cadernoAtual = null;
      estado.fase = 'nenhuma';
      salvarEstado();
      UI.renderProgresso();
      if (passadaCriacao() && estado.plano && estado.planIndex >= estado.plano.matters.length) {
        iniciarPassadaColeta();
        return;
      }
      processarLote();
    }
    avancarMateria();
  `, contexto);
  assert.equal(contexto.estado.passada, 'coleta');
  assert.equal(contexto.estado.planIndex, 0);
  assert.equal(contexto.estado.cadernoAtual, null);
  assert.equal(contexto.estado.loteFim, 3);
  assert.equal(contexto.chamouProcessar, true);
});
