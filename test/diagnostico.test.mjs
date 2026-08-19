import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { gerar, VARIANTE, MARKER_INICIO, MARKER_FIM, achadosDeAssemble } from '../scripts/diagnostico.mjs';
import { extrairBloco, criarJanelaFalsa, exercitar, RELATORIO } from '../scripts/diagnostico-instrumentado.mjs';

const root = resolve(import.meta.dirname, '..');
const DIST = resolve(root, 'dist/tec_fabrica_cadernos.user.js');

test('gerador cria variante válida, marcada e determinística (sem tocar em dist)', async () => {
  const r = await gerar();
  assert.equal(r.outPath, VARIANTE);
  assert.ok(existsSync(VARIANTE));
  const src = readFileSync(VARIANTE, 'utf8');
  assert.equal(src.split(MARKER_INICIO).length - 1, 1, 'marcador de início único');
  assert.equal(src.split(MARKER_FIM).length - 1, 1, 'marcador de fim único');
  assert.match(src, /window\.__TecFabricaDiagnostico\s*=/);
  assert.match(src, /^\/\/ @version\s+2\.2\.0$/m);
  const check = spawnSync(process.execPath, ['--check', VARIANTE], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  // determinística: regerar produz bytes idênticos
  const antes = readFileSync(VARIANTE, 'utf8');
  await gerar();
  assert.equal(readFileSync(VARIANTE, 'utf8'), antes);
});

test('build limpo permanece sem métricas de diagnóstico', () => {
  const res = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const dist = readFileSync(DIST, 'utf8');
  assert.ok(!/__TecFabricaDiagnostico|DIAGNÓSTICO INJETADO|TFD_instalar/.test(dist), 'dist contaminado');
  const frags = JSON.parse(readFileSync(resolve(root, 'src/fabrica/manifest.json'), 'utf8')).fragments;
  for (const f of frags) {
    const c = readFileSync(resolve(root, 'src/fabrica', f.file), 'utf8');
    assert.ok(!/__TecFabricaDiagnostico|DIAGNÓSTICO INJETADO/.test(c), `${f.file} contaminado`);
  }
});

test('análise estática detecta uso de estado sem declaração', () => {
  const achados = achadosDeAssemble('var x = 1;\nestado = estadoVazio();\nfunction f() { return estado.status; }');
  const critico = achados.find((a) => a.severidade === 'critico');
  assert.ok(critico, 'esperado achado crítico');
  assert.match(critico.mensagem, /estado/);
  assert.equal(achadosDeAssemble('var estado = estadoVazio();\nvoid estado.status;').length, 0);
});

test('bloco injetado conta timers/URLs/workers/XHR/fetch/IDB e observa persistência', async () => {
  const fonte = readFileSync(VARIANTE, 'utf8');
  const bloco = extrairBloco(fonte);
  assert.ok(bloco, 'bloco extraível entre marcadores');
  const janela = criarJanelaFalsa();
  const contexto = vm.createContext({ window: janela, Set, Date, Object, String, Math, console, Promise, JSON });
  vm.runInContext(bloco, contexto);
  const api = janela.__TecFabricaDiagnostico;
  assert.ok(api, 'API instalada na janela falsa');
  const rel = await exercitar(api, janela);
  assert.equal(rel.ok, true, rel.verificacoes.join('\n'));
  assert.equal(rel.contadores.requests.xhrApi, 1);
  assert.equal(rel.contadores.urls.delta, 1);
  assert.equal(rel.observaveis.indices.cadernos, 2);
});

test('CLI instrumentada executa e grava relatório', () => {
  const res = spawnSync(process.execPath, ['scripts/diagnostico-instrumentado.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const rel = JSON.parse(readFileSync(RELATORIO, 'utf8'));
  assert.equal(rel.ok, true);
  assert.ok(rel.contadores.requests.xhrApi >= 1);
  assert.ok(Array.isArray(rel.achados));
});
