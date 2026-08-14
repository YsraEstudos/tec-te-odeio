import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const stateSource = readFileSync(resolve(root, 'src/fabrica/05-estado.js'), 'utf8');
const persistenceSource = readFileSync(resolve(root, 'src/fabrica/06-persistencia.js'), 'utf8');
const resolutionSource = readFileSync(resolve(root, 'src/fabrica/10-resolucao.js'), 'utf8');

function loadLimitApi() {
  const context = { window: {} };
  vm.runInNewContext(`${stateSource}
window.__dailyLimit = {
  limite: LIMITE_RESOLUCOES_DIARIAS,
  chaveDiaLocal,
  normalizarControleResolucoesDiarias,
  reservarResolucaoDiaria,
  resolucoesDiariasRestantes,
  resumoResolucoesDiarias
};`, context, { filename: '05-estado.js' });
  return context.window.__dailyLimit;
}

test('saldo diário expõe usadas, limite, restantes e esgotado', () => {
  const api = loadLimitApi();
  const agora = new Date(2026, 7, 14, 12, 0, 0);
  const estado = {
    controleResolucoesDiarias: {
      data: api.chaveDiaLocal(agora),
      total: 37
    }
  };

  assert.deepEqual({ ...api.resumoResolucoesDiarias(estado, agora) }, {
    data: '2026-08-14',
    limite: 1200,
    usadas: 37,
    restantes: 1163,
    esgotado: false
  });
});

test('limite diário permite exatamente 1.200 reservas e recusa a 1.201ª', () => {
  const api = loadLimitApi();
  const agora = new Date(2026, 7, 14, 12, 0, 0);
  const estado = { controleResolucoesDiarias: { data: api.chaveDiaLocal(agora), total: 1199 } };

  assert.equal(api.limite, 1200);
  assert.equal(api.reservarResolucaoDiaria(estado, agora), true);
  assert.equal(estado.controleResolucoesDiarias.total, 1200);
  assert.equal(api.reservarResolucaoDiaria(estado, agora), false);
  assert.equal(estado.controleResolucoesDiarias.total, 1200);
  assert.equal(api.resolucoesDiariasRestantes(estado, agora), 0);
});

test('contador diário é reiniciado quando muda o dia local', () => {
  const api = loadLimitApi();
  const ontem = new Date(2026, 7, 13, 23, 59, 59);
  const hoje = new Date(2026, 7, 14, 0, 0, 1);
  const estado = { controleResolucoesDiarias: { data: api.chaveDiaLocal(ontem), total: 1200 } };

  assert.equal(api.resolucoesDiariasRestantes(estado, hoje), 1200);
  assert.equal(estado.controleResolucoesDiarias.data, api.chaveDiaLocal(hoje));
  assert.equal(estado.controleResolucoesDiarias.total, 0);
});

test('estado persistido antigo recebe contador diário seguro', () => {
  const context = { window: {}, CONFIG: { storageKey: 'test' } };
  vm.runInNewContext(`${stateSource}
${persistenceSource}
window.__persistenceLimit = { estadoVazio, normalizarEstadoPersistido };`, context, { filename: '06-persistencia.js' });

  const vazio = context.window.__persistenceLimit.estadoVazio();
  assert.equal(vazio.controleResolucoesDiarias.data, null);
  assert.equal(vazio.controleResolucoesDiarias.total, 0);

  const legado = { biblioteca: {}, controleResolucoesDiarias: { data: 'data-invalida', total: 1200 } };
  context.window.__persistenceLimit.normalizarEstadoPersistido(legado);
  assert.equal(legado.controleResolucoesDiarias.total, 0);
  assert.match(legado.controleResolucoesDiarias.data, /^\d{4}-\d{2}-\d{2}$/);
});

test('ao atingir o limite, resolverParaGabarito não clica em Resolver questão', async () => {
  let resolverClicks = 0;
  let paused = false;
  let progressRenders = 0;
  const radio = { click() {} };
  const label = { querySelector: () => radio };
  const resolver = { disabled: false, innerText: 'RESOLVER QUESTÃO', click() { resolverClicks += 1; } };
  const art = { querySelectorAll: () => [label] };
  const agora = new Date();
  const dataHoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  const context = {
    window: {},
    CONFIG: { pollInterval: 1, loadTimeout: 1 },
    estado: {
      status: 'rodando',
      config: { usarCliqueGabarito: true },
      controleResolucoesDiarias: { data: dataHoje, total: 1200 }
    },
    GabaritoInterceptor: {
      ultimoMetodo: null,
      estatisticas: { semGabarito: 0 },
      obterPorQuestaoId: () => null
    },
    document: {
      querySelector(selector) {
        if (selector === 'article.questao-enunciado') return art;
        if (selector.includes('resolucao-errou')) return null;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.questao-enunciado-alternativa') return [label];
        if (selector === 'button') return [resolver];
        return [];
      }
    },
    workerSleep: () => Promise.resolve(),
    workerTick: (interval, condition, timeout, callback) => callback(condition()),
    modalRecaptchaAberto: () => false,
    parar: () => { paused = true; context.estado.status = 'pausado'; },
    UI: { setStatus() {}, renderProgresso() { progressRenders += 1; } },
    log() {},
    console
  };

  vm.runInNewContext(`${stateSource}
${resolutionSource}
window.__resolutionTest = { resolverParaGabarito };`, context, { filename: '10-resolucao.js' });
  const result = await context.window.__resolutionTest.resolverParaGabarito({ id: 'q-1', number: 1, options: [{}] });

  assert.equal(result, null);
  assert.equal(resolverClicks, 0);
  assert.equal(paused, true);
  assert.equal(progressRenders, 1);
  assert.equal(context.GabaritoInterceptor.ultimoMetodo, 'limite-diario');
});

test('reserva diária atualiza o progresso imediatamente após o sucesso', () => {
  const reserva = resolutionSource.slice(
    resolutionSource.indexOf('if (!reservarResolucaoDiaria(estado))'),
    resolutionSource.indexOf('resolver.click();')
  );
  assert.match(reserva, /UI\.renderProgresso\(\)/);
});
