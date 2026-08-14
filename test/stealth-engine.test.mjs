import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const stealthSource = readFileSync(resolve(root, 'src/fabrica/02-stealth.js'), 'utf8');
const persistenceSource = readFileSync(resolve(root, 'src/fabrica/06-persistencia.js'), 'utf8');

function loadStealthApi() {
  const context = {
    window: { scrollX: 0, scrollY: 0, scrollTo() {}, dispatchEvent() {} },
    document: {},
    workerSleep: (ms) => Promise.resolve(),
    console
  };
  vm.runInNewContext(`${stealthSource}
window.__stealthApi = StealthEngine;`, context, { filename: '02-stealth.js' });
  return context.window.__stealthApi;
}

function loadPersistenceApi() {
  const context = { window: {}, CONFIG: { storageKey: 'test' } };
  vm.runInNewContext(`${persistenceSource}
window.__persistenceApi = { normalizarEstadoPersistido };`, context, { filename: '06-persistencia.js' });
  return context.window.__persistenceApi;
}

test('Box-Muller gera valores numéricos válidos e finitos', () => {
  const stealth = loadStealthApi();
  for (let i = 0; i < 50; i++) {
    const val = stealth.boxMullerRandom(100, 15);
    assert.equal(typeof val, 'number');
    assert.equal(Number.isFinite(val), true);
    assert.equal(val > 0, true);
  }
});

test('Lognormal sampling gera valores positivos e coerentes com a média', () => {
  const stealth = loadStealthApi();
  let soma = 0;
  const n = 100;
  for (let i = 0; i < n; i++) {
    const amostra = stealth.sampleLognormal(10000, 0.2);
    assert.equal(typeof amostra, 'number');
    assert.equal(amostra > 0, true);
    assert.equal(amostra >= 4000 && amostra <= 28000, true);
    soma += amostra;
  }
  const media = soma / n;
  assert.equal(media >= 8000 && media <= 12000, true);
});

test('contagem de palavras limpa tags HTML e pontuações em português', () => {
  const stealth = loadStealthApi();
  const html = '<p>A <b>Constituição</b> da República Federativa do Brasil, promulgada em 1988, garante os direitos fundamentais.</p>';
  const count = stealth.contarPalavras(html);
  assert.equal(count, 14);
  assert.equal(stealth.contarPalavras(''), 0);
  assert.equal(stealth.contarPalavras(null), 0);
});

test('cálculo de tempo de leitura proporcional ao volume textual (WPM) e complexidade', () => {
  const stealth = loadStealthApi();

  const questaoCurta = {
    statement: 'O princípio da legalidade aplica-se à Administração Pública.',
    options: [
      { letter: 'C', text: 'Certo' },
      { letter: 'E', text: 'Errado' }
    ]
  };

  const tempoCurto = stealth.calcularTempoLeituraMs(questaoCurta, { wpm: 220 });
  assert.equal(typeof tempoCurto, 'number');
  assert.equal(tempoCurto >= 8000, true); // respeita o piso fisiológico

  const enunciadoLongo = 'Texto '.repeat(350);
  const questaoLonga = {
    statement: `<p>${enunciadoLongo}</p><table><tr><td>Tabela</td></tr></table>`,
    options: [
      { letter: 'A', text: 'Alternativa extensa '.repeat(30) },
      { letter: 'B', text: 'Alternativa extensa '.repeat(30) },
      { letter: 'C', text: 'Alternativa extensa '.repeat(30) },
      { letter: 'D', text: 'Alternativa extensa '.repeat(30) },
      { letter: 'E', text: 'Alternativa extensa '.repeat(30) }
    ]
  };

  const tempoLongo = stealth.calcularTempoLeituraMs(questaoLonga, { wpm: 220 });
  assert.equal(tempoLongo > tempoCurto, true);
  assert.equal(tempoLongo >= 30000, true);
});

test('gerador de caminho de Bézier cria lista de coordenadas contínuas com jitter', () => {
  const stealth = loadStealthApi();
  const p0 = { x: 50, y: 100 };
  const p3 = { x: 400, y: 600 };
  const caminho = stealth.gerarCaminhoBezier(p0, p3, 20);

  assert.equal(Array.isArray(caminho), true);
  assert.equal(caminho.length, 21);
  caminho.forEach((pt) => {
    assert.equal(typeof pt.x, 'number');
    assert.equal(typeof pt.y, 'number');
    assert.equal(Number.isFinite(pt.x), true);
    assert.equal(Number.isFinite(pt.y), true);
  });
});

test('gestor de ritmo biológico registra questões e aciona Coffee Break no teto sorteado', () => {
  const stealth = loadStealthApi();
  stealth.resetarBlocoDescanso({ stealthIntervaloCoffeeBreakMin: 25, stealthIntervaloCoffeeBreakMax: 40 });

  assert.equal(stealth.precisaDescansoBiologico({ stealthCoffeeBreakAtivo: true }), false);

  for (let i = 0; i < 45; i++) {
    stealth.registrarQuestaoColetada();
  }

  assert.equal(stealth.precisaDescansoBiologico({ stealthCoffeeBreakAtivo: true }), true);
  assert.equal(stealth.precisaDescansoBiologico({ stealthCoffeeBreakAtivo: false }), false);

  const tempoDescanso = stealth.calcularTempoDescansoMs({ stealthCoffeeBreakDuracaoMedia: 60000 });
  assert.equal(tempoDescanso >= 30000 && tempoDescanso <= 150000, true);

  stealth.resetarBlocoDescanso();
  assert.equal(stealth.obterEstatisticasBloco().questoesNoBloco, 0);
  assert.equal(stealth.precisaDescansoBiologico({ stealthCoffeeBreakAtivo: true }), false);
});

test('normalização de estado persiste e preserva modo stealth-offline', () => {
  const { normalizarEstadoPersistido } = loadPersistenceApi();
  const estado = normalizarEstadoPersistido({
    biblioteca: {},
    config: {
      modoColeta: 'stealth-offline',
      perfilStealth: 'ultra-furtivo',
      stealthWpm: 220
    }
  });

  assert.equal(estado.config.modoColeta, 'stealth-offline');
  assert.equal(estado.config.modoOperacao, 'stealth-offline');
  assert.equal(estado.config.perfilStealth, 'ultra-furtivo');
  assert.equal(estado.config.stealthWpm, 220);
  assert.equal(estado.config.stealthCoffeeBreakAtivo, true);
});
