#!/usr/bin/env node
/**
 * diagnostico-instrumentado.mjs — valida e exercita a instrumentação injetada
 * ---------------------------------------------------------------------
 * 1) garante a variante (gera via diagnostico.mjs);
 * 2) extrai o bloco de instrumentação (entre os marcadores) da variante;
 * 3) executa o bloco em Node (vm) com uma janela falsa (timers, URL,
 *    Worker, XHR, fetch, IDB e persistência fake);
 * 4) exercita os contadores e grava/imprime relatório JSON em
 *    diagnostico/relatorio-instrumentado.json (exit 0 = tudo ok).
 *
 * Uso: node scripts/diagnostico-instrumentado.mjs
 * Também exporta extrairBloco/criarJanelaFalsa/exercitar para os testes
 * (test/diagnostico.test.mjs).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gerar, VARIANTE, MARKER_INICIO, MARKER_FIM, achadosDeAssemble } from './diagnostico.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RELATORIO = resolve(root, 'diagnostico/relatorio-instrumentado.json');

export function extrairBloco(fonte) {
  const partes = fonte.split(MARKER_INICIO);
  if (partes.length !== 2) return null;
  const resto = partes[1].split(MARKER_FIM);
  if (resto.length !== 2) return null;
  const bloco = resto[0];
  return bloco.trim() ? bloco : null;
}

/* Janela falsa com as APIs que a instrumentação envolve. */
export function criarJanelaFalsa() {
  let seq = 0;

  function XHRFake() { this.status = 200; this.responseText = '{}'; this._onload = null; }
  XHRFake.prototype.open = function (method, url) { this._url = url; };
  XHRFake.prototype.send = function () {
    if (typeof this._onload === 'function') {
      const fn = this._onload;
      this._onload = null;
      fn();
    }
  };
  XHRFake.prototype.addEventListener = function (ev, fn) { if (ev === 'load') this._onload = fn; };

  function WorkerFake(url) { this.url = url; this.terminate = function () {}; }

  function IDBReq() {}
  IDBReq.prototype.addEventListener = function () {};

  function IDBFactoryFake() {}
  IDBFactoryFake.prototype.open = function (nome, versao) { return new IDBReq(); };

  function IDBDatabaseFake() {}
  IDBDatabaseFake.prototype.transaction = function () { return {}; };

  const janela = {
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    __origSetTimeout: setTimeout,
    performance: {
      memory: { usedJSHeapSize: 12 * 1024 * 1024, totalJSHeapSize: 16 * 1024 * 1024, jsHeapSizeLimit: 2147483648 }
    },
    URL: {
      createObjectURL: () => `blob:fake-${++seq}`,
      revokeObjectURL: () => {}
    },
    Worker: WorkerFake,
    XMLHttpRequest: XHRFake,
    IDBFactory: IDBFactoryFake,
    IDBDatabase: IDBDatabaseFake,
    fetch: (input) => Promise.resolve({ ok: true }),
    __TecFabricaPersistence: {
      estatisticasIndices: () => ({
        cadernos: 2,
        questoes: 3,
        porCaderno: 2
      })
    }
  };
  return janela;
}

/* Exercita os contadores e retorna relatório + verificações. */
export async function exercitar(api, janela) {
  const verificacoes = [];
  const check = (cond, msg) => verificacoes.push((cond ? 'ok: ' : 'FALHOU: ') + msg);

  // timers
  janela.setTimeout(() => {}, 40);
  janela.setTimeout(() => {}, 1);
  const i = janela.setInterval(() => {}, 60000);
  janela.clearInterval(i);

  // blob URLs (uma fica sem revogar → delta 1 = vazamento estimado)
  const blob = new Blob(['x'], { type: 'text/plain' });
  const u1 = janela.URL.createObjectURL(blob);
  janela.URL.createObjectURL(blob);
  janela.URL.revokeObjectURL(u1);

  // worker (criado + terminado)
  const w = new janela.Worker('blob:fake-worker');
  w.terminate();

  // XHR para a API
  const x = new janela.XMLHttpRequest();
  x.open('GET', 'https://www.tecconcursos.com.br/api/cadernos/1/questoes/2');
  x.send();

  // IndexedDB
  new janela.IDBFactory().open('tec_fabrica_db', 2);
  new janela.IDBDatabase().transaction(['meta']);

  // fetch
  await janela.fetch('https://www.tecconcursos.com.br/api/filtros');

  const r = api.resumo();
  check(r.timers.setTimeout >= 2, `setTimeout contado (${r.timers.setTimeout})`);
  check(r.timers.setInterval === 1, `setInterval contado (${r.timers.setInterval})`);
  check(r.timers.clearInterval === 1, `clearInterval contado (${r.timers.clearInterval})`);
  check(r.timers.ativosInterval === 0, `intervalo ativo removido após clear (${r.timers.ativosInterval})`);
  check(r.timers.ativosTimeout >= 1, `timeout ativo rastreado (${r.timers.ativosTimeout})`);
  check(r.urls.criadas === 2 && r.urls.revogadas === 1 && r.urls.delta === 1,
    `blob URLs: ${r.urls.criadas} criadas / ${r.urls.revogadas} revogadas (delta ${r.urls.delta})`);
  check(r.workers.criados === 1 && r.workers.terminados === 1 && r.workers.ativos === 0,
    `worker criado/terminado (${r.workers.criados}/${r.workers.terminados}, ativos ${r.workers.ativos})`);
  check(r.requests.xhrOpen === 1 && r.requests.xhrApi === 1 && r.requests.xhrStatus200 === 1,
    `XHR api contado (open ${r.requests.xhrOpen}, api ${r.requests.xhrApi}, 200 ${r.requests.xhrStatus200})`);
  check(r.idb.aberturas === 1 && r.idb.transacoes === 1,
    `IDB contado (aberturas ${r.idb.aberturas}, transações ${r.idb.transacoes})`);
  check(r.requests.fetch === 1 && r.requests.fetchApi === 1,
    `fetch api contado (${r.requests.fetch}/${r.requests.fetchApi})`);
  check((r.dominios['www.tecconcursos.com.br'] || 0) >= 2,
    `domínio tecconcursos registrado (${r.dominios['www.tecconcursos.com.br']})`);
  check(r.memoria && r.memoria.usado > 0, 'memória observável via performance.memory');
  check(r.ultimasUrls.length >= 2, `anel de URLs com ${r.ultimasUrls.length} entradas`);

  // observáveis (índices de persistência fake)
  const obs = api.observaveis();
  check(obs.indices && obs.indices.cadernos === 2, 'índices de persistência observáveis');

  // amostragem + snapshot
  api.amostrar();
  const snap = api.snapshot();
  check(snap.amostras.length >= 1 && snap.resumo !== undefined, 'amostragem/snapshot funcionam');

  // contadores do cenário principal (antes do zerar, para o relatório)
  const contadores = api.resumo();

  // zerar reinicia contadores
  api.zerar();
  check(api.resumo().requests.xhrOpen === 0, 'zerar reinicia contadores');
  const x2 = new janela.XMLHttpRequest();
  x2.open('GET', 'https://www.tecconcursos.com.br/api/outro');
  check(api.resumo().requests.xhrOpen === 1, 'contadores voltam a contar após zerar');

  // desativar restaura as APIs originais
  api.desativar();
  check(api.ativo === false, 'desativar marca inativo');
  check(janela.setTimeout === janela.__origSetTimeout, 'desativar restaura timers originais');

  const ok = verificacoes.every((v) => v.startsWith('ok:'));
  return {
    ok,
    verificacoes,
    contadores,
    observaveis: api.observaveis(),
    amostras: snap.amostras
  };
}

async function main() {
  try {
    await gerar();
  } catch (e) {
    console.error(`[diag] ERRO ao gerar variante: ${e.message}`);
    process.exit(1);
  }
  const fonte = readFileSync(VARIANTE, 'utf8');
  const bloco = extrairBloco(fonte);
  if (!bloco) {
    console.error(`[diag] bloco de instrumentação não encontrado em ${VARIANTE}`);
    process.exit(1);
  }
  const janela = criarJanelaFalsa();
  const contexto = vm.createContext({ window: janela, Set, Date, Object, String, Math, console, Promise, JSON });
  try {
    vm.runInContext(bloco, contexto);
  } catch (e) {
    console.error(`[diag] falha ao executar o bloco injetado: ${e && e.stack || e}`);
    process.exit(1);
  }
  const api = janela.__TecFabricaDiagnostico;
  if (!api) {
    console.error('[diag] __TecFabricaDiagnostico não instalado pela janela falsa');
    process.exit(1);
  }
  const rel = await exercitar(api, janela);
  const saida = {
    geradoEm: new Date().toISOString(),
    ok: rel.ok,
    achados: achadosDeAssemble(fonte),
    verificacoes: rel.verificacoes,
    contadores: rel.contadores,
    observaveis: rel.observaveis,
    amostras: rel.amostras
  };
  writeFileSync(RELATORIO, JSON.stringify(saida, null, 2) + '\n');
  console.log(JSON.stringify(saida, null, 2));
  process.exit(rel.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[diag] ERRO inesperado: ${e && e.stack || e}`);
    process.exit(1);
  });
}
