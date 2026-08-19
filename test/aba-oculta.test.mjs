import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const timers = readFileSync(resolve(root, 'src/fabrica/02-timers.js'), 'utf8');
const coleta = readFileSync(resolve(root, 'src/fabrica/14-coleta.js'), 'utf8');

test('scheduler só usa Worker com a aba oculta (rastro mínimo visível)', () => {
  assert.match(timers, /function documentoOculto\(\)/);
  assert.match(timers, /document\.hidden === true/);
  assert.match(timers, /function tentarCriarWorker\(\) \{[\s\S]*?if \(!documentoOculto\(\)\)/);
  const visivel = timers.match(/if \(!documentoOculto\(\)\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.doesNotMatch(visivel, /worker = false/, 'aba visível não deve desabilitar futuras tentativas');
});

test('worker é encerrado quando a aba volta e não há tarefas pendentes', () => {
  assert.match(timers, /function limparWorkerSeOciosoVisivel\(\)/);
  assert.match(timers, /worker\.terminate\(\)/);
  assert.match(timers, /Object\.keys\(tarefas\)\.length > 0/);
  assert.match(timers, /visibilitychange/);
});

test('fallback de timers continua íntegro quando não há Worker', () => {
  assert.match(timers, /repassarAoFallback/);
  assert.match(timers, /function repassarAoFallback\(id\)/);
});

test('coleta rápida pausa enquanto a aba estiver oculta', () => {
  assert.match(coleta, /function aguardarAbaVisivel\(\)/);
  assert.match(coleta, /document\.hidden !== true/);
  assert.match(coleta, /workerTick\(500, function \(\)/);
  assert.match(coleta, /rapidoPausaAbaOculta !== false/);
});

test('scheduler usa fallback visível, cria Worker depois ao ocultar e limpa ao ficar ocioso', async () => {
  let oculto = false;
  let criados = 0;
  let terminados = 0;
  let workerAtual = null;
  const listeners = {};

  class WorkerMock {
    constructor() { criados += 1; workerAtual = this; }
    postMessage(mensagem) { this.ultimaMensagem = mensagem; }
    terminate() { terminados += 1; }
  }

  const contexto = {
    document: {
      get hidden() { return oculto; },
      addEventListener(tipo, fn) { listeners[tipo] = fn; }
    },
    Worker: WorkerMock,
    Blob: class BlobMock {},
    URL: { createObjectURL: () => 'blob:teste', revokeObjectURL() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, Date, Math, Object
  };
  vm.runInNewContext(timers, contexto);

  await contexto.Scheduler.sleep(0);
  assert.equal(criados, 0, 'aba visível deve usar fallback');

  oculto = true;
  const pendente = contexto.Scheduler.sleep(1000);
  assert.equal(criados, 1, 'Worker deve ser criado após a aba ficar oculta');
  const id = workerAtual.ultimaMensagem.id;

  oculto = false;
  listeners.visibilitychange();
  assert.equal(terminados, 0, 'Worker com tarefa pendente não deve ser encerrado');
  workerAtual.onmessage({ data: id });
  await pendente;
  assert.equal(terminados, 1, 'última tarefa visível deve encerrar o Worker');
});
