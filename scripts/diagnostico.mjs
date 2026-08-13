#!/usr/bin/env node
/**
 * diagnostico.mjs — gerador da variante de diagnóstico (fora de dist/)
 * ---------------------------------------------------------------------
 * Monta o userscript exatamente como scripts/build.mjs (mesmos fragmentos
 * do manifest.json e mesma sincronização de versão), mas NUNCA escreve em
 * dist/ nem modifica fontes: injeta um bloco de instrumentação no fim da
 * IIFE principal (contadores de persistência, timers, Workers, blob URLs,
 * XHR/fetch, IndexedDB, memória observável) e grava apenas em
 * diagnostico/tec_fabrica_cadernos.diagnostico.user.js.
 *
 * Segurança:
 *  - aborta se qualquer fragmento já contiver instrumentação (marcadores
 *    ou __TecFabricaDiagnostico) — o build limpo fica garantidamente sem
 *    métricas;
 *  - valida sintaxe (node --check), marcadores únicos e versão;
 *  - roda uma sonda de boot (fragmento 06 em vm, sem indexedDB) e relata
 *    achados estáticos + de execução (ex.: `estado` usado sem declaração).
 *    Achados são avisos: não bloqueiam a geração, que serve justamente
 *    para diagnosticar builds quebrados.
 *
 * Uso: node scripts/diagnostico.mjs
 * Testes: node --test test/diagnostico.test.mjs
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MARKER_INICIO = '/* ==== DIAGNÓSTICO INJETADO (início) ==== */';
export const MARKER_FIM = '/* ==== DIAGNÓSTICO INJETADO (fim) ==== */';
export const VARIANTE = resolve(root, 'diagnostico/tec_fabrica_cadernos.diagnostico.user.js');
export const DIR_DIAG = resolve(root, 'diagnostico');

const MARCA_INSTRUMENTACAO = /__TecFabricaDiagnostico|TFD_instalar|DIAGNÓSTICO INJETADO/;
const MARCA_FECHA = /\}\)\(\);\s*$/;

/* ----------------------------------------------------------------------
 * Análise estática: achados sobre o assemble limpo (não bloqueiam).
 * -------------------------------------------------------------------- */
export function achadosDeAssemble(output) {
  const achados = [];
  const usaEstado = /\bestado\b/.test(output);
  const declaraEstado = /\b(?:var|let|const)\s+estado\b/.test(output);
  if (usaEstado && !declaraEstado) {
    achados.push({
      severidade: 'critico',
      alvo: '06-persistencia.js',
      mensagem: "'estado' é atribuído em modo estrito sem declaração (faltou 'var estado = estadoVazio();') — ReferenceError no boot, a UI nunca é criada."
    });
  }
  return achados;
}

/* ----------------------------------------------------------------------
 * Sonda de boot: executa o fragmento 06 em vm com window sem indexedDB
 * (o caminho de erro do boot) e verifica se degrada limpo ou quebra.
 * -------------------------------------------------------------------- */
export async function sondarBootPersistencia(parts) {
  const frag06 = parts.find((p) => p.file === '06-persistencia.js');
  if (!frag06) {
    return { severidade: 'aviso', alvo: 'sonda', mensagem: 'fragmento 06-persistencia.js não encontrado; sonda de boot não executada.' };
  }
  const window = {};
  const context = { window, Map, Set, Promise, Date, JSON, Object, Array, console, setTimeout, clearTimeout };
  const script = [
    "'use strict';",
    "var CONFIG = { storageKey: 'tec_fabrica_estado_v1' };",
    'var log = function () {};',
    frag06.content,
    "carregarEstado().then(function (e) { globalThis.__probe = { ok: true, status: e && e.status }; }, function (e) { globalThis.__probe = { ok: false, erro: String((e && e.message) || e) }; });"
  ].join('\n');
  try {
    vm.runInNewContext(script, context);
  } catch (e) {
    return { severidade: 'critico', alvo: 'sonda', mensagem: `boot de persistência quebrou sincronamente: ${e.name}: ${e.message}` };
  }
  // As microtasks do vm só drenam após um tick do event loop do host.
  await new Promise((resolveProbe) => setImmediate(resolveProbe));
  const probe = context.__probe;
  if (!probe) return { severidade: 'aviso', alvo: 'sonda', mensagem: 'sonda não respondeu (fluxo de boot inesperado).' };
  if (probe.ok) return { severidade: 'ok', alvo: 'sonda', mensagem: `boot de persistência sem indexedDB degrada limpo (estado=${probe.status}).` };
  return { severidade: 'critico', alvo: 'sonda', mensagem: `boot de persistência sem indexedDB: ${probe.erro}` };
}

/* ----------------------------------------------------------------------
 * Bloco injetado (protocolo de diagnóstico). Fica DENTRO da IIFE, logo
 * antes do `})();` final: compartilha o escopo (salvarEstado, Scheduler,
 * workerSleep, GabaritoInterceptor...) com acesso typeof-guardado para
 * que o bloco também execute isolado (extração em testes/runner).
 * -------------------------------------------------------------------- */
const BLOCO_CODIGO = `/*
 * Instrumentação de diagnóstico — NUNCA faz parte do build limpo (dist/).
 * Gerada por scripts/diagnostico.mjs; delimitada por marcadores próprios
 * para extração e testes. Conta chamadas feitas APÓS a injeção (fim do
 * boot): timers, Workers, blob URLs, XHR/fetch, IndexedDB, persistência
 * (salvarEstado, salvarEstadoIdb, salvarSnapshot, carregarEstado) e
 * scheduler. Estado, índices e gabarito continuam observáveis via
 * __TecFabricaDiagnostico.observaveis().
 */
var TFD_instalar = function (janela) {
    if (!janela) return null;
    if (janela.__TecFabricaDiagnostico) return janela.__TecFabricaDiagnostico;
    var cont = {
        iniciadoEm: Date.now(),
        timers: { setTimeout: 0, setInterval: 0, clearTimeout: 0, clearInterval: 0, ativosTimeout: 0, ativosInterval: 0 },
        urls: { criadas: 0, revogadas: 0, delta: 0 },
        workers: { criados: 0, terminados: 0, ativos: 0 },
        requests: { xhrOpen: 0, xhrSend: 0, xhrApi: 0, xhrStatus200: 0, xhrErros: 0, fetch: 0, fetchApi: 0 },
        idb: { aberturas: 0, sucesso: 0, erro: 0, transacoes: 0 },
        persistencia: { salvarEstado: 0, salvarEstadoIdb: 0, salvarSnapshot: 0, carregarEstado: 0 },
        scheduler: { sleep: 0, poll: 0, cancelar: 0, limpar: 0 },
        interceptor: { instalado: 0 },
        dominios: {},
        ultimasUrls: [],
        amostras: []
    };
    var ativosTimeout = new Set();
    var ativosInterval = new Set();
    var restauraveis = [];
    var intervaloAmostra = null;

    function registrarUrl(u) {
        var s = String(u || '');
        cont.ultimasUrls.push(s);
        if (cont.ultimasUrls.length > 20) cont.ultimasUrls.shift();
        var m = s.match(/^https?:\\/\\/([^/]+)/);
        var d = m ? m[1] : '(local)';
        cont.dominios[d] = (cont.dominios[d] || 0) + 1;
        return s;
    }
    function memorizar() {
        var m = null;
        try { m = janela.performance && janela.performance.memory; } catch (e) { m = null; }
        if (!m || typeof m.usedJSHeapSize !== 'number') return null;
        return { usado: m.usedJSHeapSize, total: m.totalJSHeapSize, limite: m.jsHeapSizeLimit };
    }
    function amostrar() {
        cont.amostras.push({
            t: Date.now(),
            memoria: memorizar(),
            timersAtivos: ativosTimeout.size + ativosInterval.size,
            urlsDelta: cont.urls.delta,
            workersAtivos: cont.workers.ativos,
            idbAberturas: cont.idb.aberturas,
            salvarEstado: cont.persistencia.salvarEstado,
            salvarSnapshot: cont.persistencia.salvarSnapshot
        });
        if (cont.amostras.length > 30) cont.amostras.shift();
    }
    function guardar(alvo, prop, valor) {
        if (!alvo) return;
        restauraveis.push({ alvo: alvo, prop: prop, valor: alvo[prop] });
        alvo[prop] = valor;
    }
    function copiar(o) {
        var out = {};
        Object.keys(o || {}).forEach(function (k) { out[k] = o[k]; });
        return out;
    }

    var origSetTimeout = janela.setTimeout;
    var origSetInterval = janela.setInterval;
    var origClearTimeout = janela.clearTimeout;
    var origClearInterval = janela.clearInterval;

    if (typeof origSetTimeout === 'function') {
        guardar(janela, 'setTimeout', function (fn, ms) {
            cont.timers.setTimeout += 1;
            var id = origSetTimeout(typeof fn === 'function' ? function () {
                ativosTimeout.delete(id);
                return fn.apply(janela, arguments);
            } : fn, ms);
            ativosTimeout.add(id);
            cont.timers.ativosTimeout = ativosTimeout.size;
            return id;
        });
    }
    if (typeof origSetInterval === 'function') {
        guardar(janela, 'setInterval', function (fn, ms) {
            cont.timers.setInterval += 1;
            var id = origSetInterval(typeof fn === 'function' ? function () {
                return fn.apply(janela, arguments);
            } : fn, ms);
            ativosInterval.add(id);
            cont.timers.ativosInterval = ativosInterval.size;
            return id;
        });
    }
    if (typeof origClearTimeout === 'function') {
        guardar(janela, 'clearTimeout', function (id) {
            cont.timers.clearTimeout += 1;
            ativosTimeout.delete(id);
            cont.timers.ativosTimeout = ativosTimeout.size;
            return origClearTimeout(id);
        });
    }
    if (typeof origClearInterval === 'function') {
        guardar(janela, 'clearInterval', function (id) {
            cont.timers.clearInterval += 1;
            ativosInterval.delete(id);
            cont.timers.ativosInterval = ativosInterval.size;
            return origClearInterval(id);
        });
    }

    if (janela.URL && typeof janela.URL.createObjectURL === 'function') {
        var origCreate = janela.URL.createObjectURL;
        guardar(janela.URL, 'createObjectURL', function (blob) {
            cont.urls.criadas += 1;
            cont.urls.delta = cont.urls.criadas - cont.urls.revogadas;
            return origCreate.call(janela.URL, blob);
        });
    }
    if (janela.URL && typeof janela.URL.revokeObjectURL === 'function') {
        var origRevoke = janela.URL.revokeObjectURL;
        guardar(janela.URL, 'revokeObjectURL', function (url) {
            cont.urls.revogadas += 1;
            cont.urls.delta = cont.urls.criadas - cont.urls.revogadas;
            return origRevoke.call(janela.URL, url);
        });
    }

    var OrigWorker = janela.Worker;
    if (typeof OrigWorker === 'function') {
        var TFD_WorkerNovo = function (url, opts) {
            cont.workers.criados += 1;
            cont.workers.ativos += 1;
            var w = new OrigWorker(url, opts);
            var origTerminate = w.terminate;
            w.terminate = function () {
                cont.workers.terminados += 1;
                cont.workers.ativos = Math.max(0, cont.workers.ativos - 1);
                return origTerminate.apply(w, arguments);
            };
            return w;
        };
        TFD_WorkerNovo.prototype = OrigWorker.prototype;
        guardar(janela, 'Worker', TFD_WorkerNovo);
    }

    if (janela.XMLHttpRequest && janela.XMLHttpRequest.prototype) {
        var xp = janela.XMLHttpRequest.prototype;
        if (typeof xp.open === 'function') {
            var origXhrOpen = xp.open;
            guardar(xp, 'open', function (method, url) {
                cont.requests.xhrOpen += 1;
                var s = registrarUrl(url);
                if (/\\/api\\//.test(s)) cont.requests.xhrApi += 1;
                this.__tecFabricaDiagUrl = s;
                return origXhrOpen.apply(this, arguments);
            });
        }
        if (typeof xp.send === 'function') {
            var origXhrSend = xp.send;
            guardar(xp, 'send', function () {
                cont.requests.xhrSend += 1;
                var x = this;
                if (typeof x.addEventListener === 'function') {
                    x.addEventListener('load', function () {
                        if (x.status >= 400) cont.requests.xhrErros += 1;
                        else if (x.status === 200) cont.requests.xhrStatus200 += 1;
                    });
                }
                return origXhrSend.apply(this, arguments);
            });
        }
    }

    if (typeof janela.fetch === 'function') {
        var origFetch = janela.fetch;
        guardar(janela, 'fetch', function (input, init) {
            cont.requests.fetch += 1;
            var s = registrarUrl(typeof input === 'string' ? input : (input && input.url) || '');
            if (/\\/api\\//.test(s)) cont.requests.fetchApi += 1;
            return origFetch.call(janela, input, init);
        });
    }

    if (janela.IDBFactory && janela.IDBFactory.prototype && typeof janela.IDBFactory.prototype.open === 'function') {
        var origIdbOpen = janela.IDBFactory.prototype.open;
        guardar(janela.IDBFactory.prototype, 'open', function () {
            cont.idb.aberturas += 1;
            var req = origIdbOpen.apply(this, arguments);
            if (req && typeof req.addEventListener === 'function') {
                req.addEventListener('success', function () { cont.idb.sucesso += 1; });
                req.addEventListener('error', function () { cont.idb.erro += 1; });
            }
            return req;
        });
    }
    if (janela.IDBDatabase && janela.IDBDatabase.prototype && typeof janela.IDBDatabase.prototype.transaction === 'function') {
        var origIdbTx = janela.IDBDatabase.prototype.transaction;
        guardar(janela.IDBDatabase.prototype, 'transaction', function () {
            cont.idb.transacoes += 1;
            return origIdbTx.apply(this, arguments);
        });
    }

    if (typeof origSetInterval === 'function') {
        intervaloAmostra = origSetInterval(amostrar, 10000);
    }

    function resumo() {
        return {
            iniciadoEm: cont.iniciadoEm,
            timers: copiar(cont.timers),
            urls: copiar(cont.urls),
            workers: copiar(cont.workers),
            requests: copiar(cont.requests),
            idb: copiar(cont.idb),
            persistencia: copiar(cont.persistencia),
            scheduler: copiar(cont.scheduler),
            interceptor: copiar(cont.interceptor),
            dominios: copiar(cont.dominios),
            ultimasUrls: cont.ultimasUrls.slice(),
            memoria: memorizar(),
            nosDocumento: (janela.document && janela.document.getElementsByTagName)
                ? janela.document.getElementsByTagName('*').length
                : null
        };
    }
    function zerar() {
        Object.keys(cont).forEach(function (k) {
            if (k === 'iniciadoEm' || k === 'ultimasUrls' || k === 'amostras' || k === 'dominios') return;
            var v = cont[k];
            if (v && typeof v === 'object') {
                Object.keys(v).forEach(function (k2) { if (typeof v[k2] === 'number') v[k2] = 0; });
            } else if (typeof v === 'number') {
                cont[k] = 0;
            }
        });
        cont.ultimasUrls.length = 0;
        cont.amostras.length = 0;
        cont.dominios = {};
    }
    function desativar() {
        if (!api.ativo) return;
        if (intervaloAmostra !== null && typeof origClearInterval === 'function') {
            origClearInterval(intervaloAmostra);
            intervaloAmostra = null;
        }
        restauraveis.forEach(function (r) { r.alvo[r.prop] = r.valor; });
        restauraveis.length = 0;
        api.ativo = false;
        cont.restaurado = true;
    }

    var api = {
        ativo: true,
        versao: '1',
        contadores: cont,
        resumo: resumo,
        snapshot: function () {
            amostrar();
            return {
                resumo: resumo(),
                observaveis: api.observaveis(),
                amostras: cont.amostras.slice(-5)
            };
        },
        amostrar: amostrar,
        zerar: zerar,
        desativar: desativar,
        observaveis: function () {
            var out = {};
            if (typeof estado !== 'undefined' && estado) {
                out.estado = {
                    status: estado.status,
                    fase: estado.fase,
                    modo: estado.modo,
                    cadernos: Object.keys(estado.biblioteca || {}).length,
                    atualizadoEm: estado.atualizadoEm
                };
            }
            if (typeof GabaritoInterceptor === 'object' && GabaritoInterceptor) {
                out.gabarito = {
                    instalado: GabaritoInterceptor.instalado === true,
                    cacheQuestoes: Object.keys(GabaritoInterceptor.cache || {}).length,
                    cachePorIndex: Object.keys(GabaritoInterceptor.cachePorIndex || {}).length,
                    estatisticas: copiar(GabaritoInterceptor.estatisticas || {})
                };
            }
            var p = window.__TecFabricaPersistence;
            if (p && p.indices) {
                out.indices = {
                    cadernos: p.indices.cadernosPorId && p.indices.cadernosPorId.size,
                    questoes: p.indices.questoesPorId && p.indices.questoesPorId.size,
                    porCaderno: p.indices.questaoIdsPorCaderno && p.indices.questaoIdsPorCaderno.size
                };
            }
            return out;
        }
    };
    janela.__TecFabricaDiagnostico = api;
    return api;
};
var TFD_api = TFD_instalar(window);
(function (api) {
    if (!api) return;
    var c = api.contadores;
    if (typeof salvarEstado === 'function') {
        var t0 = salvarEstado;
        salvarEstado = function () { c.persistencia.salvarEstado += 1; return t0.apply(null, arguments); };
    }
    if (typeof salvarEstadoIdb === 'function') {
        var t1 = salvarEstadoIdb;
        salvarEstadoIdb = function () { c.persistencia.salvarEstadoIdb += 1; return t1.apply(null, arguments); };
    }
    if (typeof salvarSnapshot === 'function') {
        var t2 = salvarSnapshot;
        salvarSnapshot = function () { c.persistencia.salvarSnapshot += 1; return t2.apply(null, arguments); };
    }
    if (typeof carregarEstado === 'function') {
        var t3 = carregarEstado;
        carregarEstado = function () { c.persistencia.carregarEstado += 1; return t3.apply(null, arguments); };
    }
    if (typeof workerSleep === 'function') {
        var t4 = workerSleep;
        workerSleep = function () { c.scheduler.sleep += 1; return t4.apply(null, arguments); };
    }
    if (typeof workerTick === 'function') {
        var t5 = workerTick;
        workerTick = function () { c.scheduler.poll += 1; return t5.apply(null, arguments); };
    }
    if (typeof Scheduler === 'object' && Scheduler) {
        if (typeof Scheduler.cancelar === 'function') {
            var t6 = Scheduler.cancelar;
            Scheduler.cancelar = function () { c.scheduler.cancelar += 1; return t6.apply(Scheduler, arguments); };
        }
        if (typeof Scheduler.limpar === 'function') {
            var t7 = Scheduler.limpar;
            Scheduler.limpar = function () { c.scheduler.limpar += 1; return t7.apply(Scheduler, arguments); };
        }
    }
    if (typeof GabaritoInterceptor === 'object' && GabaritoInterceptor) {
        c.interceptor.instalado = GabaritoInterceptor.instalado === true ? 1 : 0;
    }
})(TFD_api);
window.__TecFabricaDiagnostico = TFD_api;`;

/* ----------------------------------------------------------------------
 * Geração principal (idempotente e determinística).
 * -------------------------------------------------------------------- */
export async function gerar(opcoes = {}) {
  const manifestPath = resolve(root, 'src/fabrica/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const version = manifest.version;
  if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
    throw new Error('manifest sem fragmentos');
  }

  const parts = manifest.fragments.map(({ file }) => {
    const path = resolve(root, 'src/fabrica', file);
    if (!existsSync(path)) throw new Error(`fragmento ausente: ${file}`);
    const content = readFileSync(path, 'utf8');
    if (!content.trim()) throw new Error(`fragmento vazio: ${file}`);
    return { file, content };
  });

  // Segurança 1: fontes nunca podem conter instrumentação.
  for (const part of parts) {
    if (MARCA_INSTRUMENTACAO.test(part.content)) {
      throw new Error(`ABORTADO: fragmento ${part.file} já contém instrumentação de diagnóstico — o build limpo seria contaminado. Remova antes de gerar.`);
    }
  }

  // Montagem idêntica ao build.mjs (mesma ordem, mesma sincronização de versão).
  let output = parts.map((part) => part.content).join('');
  output = output.replace(/^\/\/ @version\s+.*$/m, `// @version      ${version}`);
  output = output.replace(/^(\s*var SCRIPT_VERSION = ')[^']*(';\s*)$/m, `$1${version}$2`);

  const checks = [
    [`@version ${version}`, new RegExp(`^// @version\\s+${version.replaceAll('.', '\\.')}$`, 'm').test(output)],
    [`SCRIPT_VERSION ${version}`, new RegExp(`^\\s*var SCRIPT_VERSION = '${version.replaceAll('.', '\\.')}'`, 'm').test(output)],
    ['__TecFabrica', /window\.__TecFabrica\s*=/.test(output)],
    ['__TecFabricaExport', /window\.__TecFabricaExport\s*=/.test(output)],
    ['__TecFabricaUI', /window\.__TecFabricaUI\s*=/.test(output)],
    ['__TecFabricaPersistence', /window\.__TecFabricaPersistence\s*=/.test(output)],
  ];
  for (const [label, ok] of checks) if (!ok) throw new Error(`validação falhou: ${label}`);

  // Segurança 2: o assemble precisa fechar a IIFE no fim (única âncora) e
  // não pode já conter instrumentação.
  if (!MARCA_FECHA.test(output)) throw new Error('esperado fechamento })(); no fim do assemble (fragmentos mudaram?)');
  if (MARCA_INSTRUMENTACAO.test(output)) throw new Error('ABORTADO: o assemble já contém instrumentação de diagnóstico');

  const BLOCO = `${MARKER_INICIO}\n${BLOCO_CODIGO}\n${MARKER_FIM}`;
  const final = output.replace(MARCA_FECHA, () => BLOCO + '\n})();\n');

  const nInicio = final.split(MARKER_INICIO).length - 1;
  const nFim = final.split(MARKER_FIM).length - 1;
  if (nInicio !== 1 || nFim !== 1) throw new Error(`marcadores inválidos (início=${nInicio}, fim=${nFim})`);

  const check = spawnSync(process.execPath, ['--check'], { input: final, encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`node --check falhou:\n${check.stderr || check.stdout}`);

  // Segurança 3: destino nunca dentro de dist/ (e nunca em src/).
  const outPath = VARIANTE;
  if (outPath.startsWith(resolve(root, 'dist') + sep)) throw new Error('destino inesperado dentro de dist/');

  mkdirSync(dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp-${process.pid}`;
  try {
    writeFileSync(tempPath, final, 'utf8');
    renameSync(tempPath, outPath);
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  }

  const achados = [...achadosDeAssemble(output)];
  if (!opcoes.semSonda) achados.push(await sondarBootPersistencia(parts));

  return { outPath, version, bytesLimpo: output.length, bytesVariante: final.length, partes: parts.length, achados };
}

export async function main() {
  try {
    const r = await gerar();
    console.log(`[diag] OK ${r.partes} fragmentos -> ${r.outPath}`);
    console.log(`[diag] versão ${r.version}; variante instrumentada; dist/ e src/ intactos`);
    console.log(`[diag] bytes: limpo ~${r.bytesLimpo} | variante ~${r.bytesVariante} (+${r.bytesVariante - r.bytesLimpo} de instrumentação)`);
    for (const a of r.achados) {
      console.log(`[diag] ACHADO [${a.severidade}] ${a.alvo}: ${a.mensagem}`);
    }
  } catch (e) {
    console.error(`[diag] ERRO: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[diag] ERRO: ${e.message}`);
    process.exit(1);
  });
}
