import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const coleta = readFileSync(resolve(root, 'src/fabrica/14-coleta.js'), 'utf8');
const paginas = readFileSync(resolve(root, 'src/fabrica/07-paginas.js'), 'utf8');
const config = readFileSync(resolve(root, 'src/fabrica/01-config.js'), 'utf8');
const persistencia = readFileSync(resolve(root, 'src/fabrica/06-persistencia.js'), 'utf8');

test('modo rápido existe: coletarQuestaoRapida com as etapas do caminho rápido', () => {
  assert.match(coleta, /async function coletarQuestaoRapida\(/);
  assert.match(coleta, /questao\.answer = '';/);
  assert.match(coleta, /questao\.answerSource = 'sem-gabarito';/);
  assert.match(coleta, /viaRapido \+= 1/);
  assert.match(coleta, /navegarQuestao\(numeroAlvo\)/);
  assert.match(coleta, /jitterRapido\(cfg\)/);
  assert.match(coleta, /return \{ fim: true \};/);
});

test('decisão rápida é condicionada à confirmação de ausência de gabarito', () => {
  assert.match(coleta, /payloadsVistos > 0/);
  assert.match(coleta, /consultarGabaritoQuestao\(questao\.id/);
  assert.match(coleta, /consulta\.estado === 'sem-gabarito'/);
  assert.match(coleta, /consulta\.estado === 'com-gabarito'/);
  assert.match(coleta, /aguardarPayloadQuestao\(questao\.id, cfgRapido\.rapidoCacheEsperaMs \|\| 2000\)/);
  assert.match(coleta, /if \(decisaoRapida\) \{/);
});

test('navegação rápida é pipelined: navega antes do jitter e usa poll rápido', () => {
  const inicio = coleta.indexOf('async function coletarQuestaoRapida');
  const navIdx = coleta.indexOf('navegarQuestao(numeroAlvo)', inicio);
  const jitterIdx = coleta.indexOf('await workerSleep(pausaJitter)', inicio);
  assert.ok(navIdx > 0 && jitterIdx > 0, 'navegação/jitter não encontrados');
  assert.ok(navIdx < jitterIdx, 'a navegação deve ocorrer antes do jitter (pipelining)');
  assert.match(coleta, /interval: cfg\.rapidoPollInterval \|\| 120,/);
  assert.match(coleta, /timeout: 8000/);
  assert.match(coleta, /aguardarQuestaoMudar\(idAnterior, assinaturaAnterior, resolve, \{/);
});

test('aguardarQuestaoMudar aceita opções de poll e timeout', () => {
  assert.match(paginas, /function aguardarQuestaoMudar\(idAnterior, assinaturaAnterior, callback, opcoes\)/);
  assert.match(paginas, /opcoes\.interval/);
  assert.match(paginas, /opcoes\.timeout/);
});

test('micro-rolagem ocasional e pausa em aba oculta no caminho rápido', () => {
  assert.match(coleta, /Math\.random\(\) < 0\.1/);
  assert.match(coleta, /scrollOrganico\(destino, 400\)/);
  assert.match(coleta, /rapidoPausaAbaOculta/);
  assert.match(coleta, /aguardarAbaVisivel\(\)/);
});

test('pausa biológica curta do modo rápido usa bloco próprio (30-60 questões, ~9s)', () => {
  assert.match(coleta, /rapidoCoffeeBreakAtivo !== false/);
  assert.match(coleta, /rapidoCoffeeBreakIntervaloMin \|\| 30/);
  assert.match(coleta, /rapidoCoffeeBreakIntervaloMax \|\| 60/);
  assert.match(coleta, /rapidoCoffeeBreakDuracaoMedia \|\| 9000/);
  assert.match(coleta, /resetarBlocoDescanso/);
});

test('config do modo rápido presente com defaults aprovados', () => {
  assert.match(config, /rapidoSemGabaritoAtivo: true/);
  assert.match(config, /rapidoDelayMin: 300/);
  assert.match(config, /rapidoDelayMax: 800/);
  assert.match(config, /rapidoPollInterval: 120/);
  assert.match(config, /rapidoCacheEsperaMs: 2000/);
  assert.match(config, /rapidoCoffeeBreakAtivo: true/);
  assert.match(config, /rapidoCoffeeBreakIntervaloMin: 30/);
  assert.match(config, /rapidoCoffeeBreakIntervaloMax: 60/);
  assert.match(config, /rapidoCoffeeBreakDuracaoMedia: 9000/);
  assert.match(config, /rapidoPausaAbaOculta: true/);
  assert.match(config, /interceptarFetch: false/);
});

test('defaults do modo rápido também valem para estado persistido', () => {
  assert.match(persistencia, /rapidoSemGabaritoAtivo !== 'boolean'\) valor\.config\.rapidoSemGabaritoAtivo = true/);
  assert.match(persistencia, /rapidoDelayMax/);
  assert.match(persistencia, /rapidoCoffeeBreakDuracaoMedia/);
});

test('concorrência: o caminho rápido não abre exceções ao guard de ciclo', () => {
  const ocorrencias = coleta.match(/meuCiclo !== cicloExecucaoId \|\| estado\.status !== 'rodando'/g);
  assert.ok(ocorrencias && ocorrencias.length >= 3, 'guard de concorrência deve aparecer no caminho rápido');
});

test('configuração persistida do usuário sobrescreve os defaults globais', () => {
  const contexto = {
    CONFIG: { rapidoDelayMin: 300, rapidoSemGabaritoAtivo: true },
    estado: { config: { rapidoDelayMin: 975, rapidoSemGabaritoAtivo: false } },
    Object
  };
  vm.runInNewContext(coleta, contexto);
  const efetiva = contexto.configuracaoRapidaAtual();
  assert.equal(efetiva.rapidoDelayMin, 975);
  assert.equal(efetiva.rapidoSemGabaritoAtivo, false);
});
