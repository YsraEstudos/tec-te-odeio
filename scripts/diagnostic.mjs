import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'dist/tec_fabrica_cadernos.user.js');
const outDir = resolve(root, '.tmp');
const outPath = resolve(outDir, 'tec_fabrica_cadernos.diagnostic.user.js');
const flag = '__TecFabricaDiagnostics';

export function instrument(source) {
  if (source.includes(flag)) throw new Error('fonte já instrumentada');
  const probe = `
/* diagnostic-only: não instalar */
(function () {
  var counters = { saves: 0, timers: 0, workers: 0, blobUrls: 0 };
  var memory = function () { return (typeof performance !== 'undefined' && performance.memory) ? {
    usedJSHeapSize: performance.memory.usedJSHeapSize,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
  } : null; };
  window.${flag} = {
    counters: counters,
    memory: memory,
    snapshot: function () { return { counters: Object.assign({}, counters), memory: memory() }; },
    reset: function () { Object.keys(counters).forEach(function (key) { counters[key] = 0; }); }
  };
  var originalSetTimeout = window.setTimeout;
  if (originalSetTimeout) window.setTimeout = function () { counters.timers += 1; return originalSetTimeout.apply(this, arguments); };
  var originalWorker = window.Worker;
  if (originalWorker) window.Worker = function () { counters.workers += 1; return new (Function.prototype.bind.apply(originalWorker, [null].concat([].slice.call(arguments))))(); };
})();
`;
  const marker = /\r?\n\}\)\(\);\r?\n/g;
  let match;
  let index = -1;
  while ((match = marker.exec(source))) index = match.index;
  if (index < 0) throw new Error('fecho da IIFE não encontrado');
  return source.slice(0, index) + probe + source.slice(index);
}

export function generate() {
  const source = readFileSync(sourcePath, 'utf8');
  const output = instrument(source);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, output, 'utf8');
  const check = spawnSync(process.execPath, ['--check', outPath], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(check.stderr || check.stdout);
  return { path: outPath, bytes: Buffer.byteLength(output), flag };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const result = generate();
  console.log(`[diagnostic] gerado fora de dist: ${result.path} (${result.bytes} bytes)`);
  console.log('[diagnostic] carregue a variante em um perfil temporário e consulte window.__TecFabricaDiagnostics.snapshot()');
}
