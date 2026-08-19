import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const coleta = readFileSync(resolve(root, 'src/fabrica/14-coleta.js'), 'utf8');

test('jitter gaussiano respeita os limites de 300-800ms', () => {
  assert.match(coleta, /function jitterRapido\(cfg\)/);
  assert.match(coleta, /Math\.max\(50, Number\(cfg\.rapidoDelayMin\) \|\| 300\)/);
  assert.match(coleta, /Math\.max\(min \+ 1, Number\(cfg\.rapidoDelayMax\) \|\| 800\)/);
  assert.match(coleta, /boxMullerRandom\(media, desvio\)/);
  assert.match(coleta, /Math\.min\(max, Math\.max\(min, Math\.round\(base\)\)\)/);
});

test('cadência irregular: distribuição gaussiana, não uniforme', () => {
  assert.match(coleta, /desvio = Math\.max\(25, \(max - min\) \/ 4\)/);
  const somaIdx = coleta.indexOf('(Math.random() + Math.random() + Math.random() - 1.5)');
  assert.ok(somaIdx > 0, 'fallback triangular presente');
});

test('espera pelo payload usa poll rápido de 80ms e timeout limitado', () => {
  assert.match(coleta, /function aguardarPayloadQuestao\(questaoId, tempoLimiteMs\)/);
  assert.match(coleta, /workerTick\(80, function \(\)/);
  assert.match(coleta, /GabaritoInterceptor\.cacheSemGabarito\[chave\]/);
  assert.match(coleta, /Date\.now\(\) - inicio >= limite/);
});

test('retry único e curto: no máximo uma segunda tentativa de navegação', () => {
  const retry = coleta.match(/timeout: 8000/g);
  assert.ok(retry && retry.length === 2, 'exatamente dois timeouts de 8s (principal + retry)');
  assert.match(coleta, /carregada && !porId\.has\(String\(numeroAlvo\)\)/);
});