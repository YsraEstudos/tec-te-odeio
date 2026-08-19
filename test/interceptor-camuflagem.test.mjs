import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const interceptor = readFileSync(resolve(root, 'src/fabrica/09-interceptor.js'), 'utf8');

test('nenhuma propriedade própria enumerável vaza a URL do XHR', () => {
  assert.ok(!/__tecFabricaUrl/.test(interceptor), '__tecFabricaUrl não deve existir mais');
  assert.match(interceptor, /new WeakMap\(\)/);
  assert.match(interceptor, /urlsDeXhr\.set\(this, String\(url \|\| ''\)\)/);
  assert.match(interceptor, /urlsDeXhr\.get\(xhr\) \|\| ''/);
});

test('patches de XHR usam camuflagem de assinatura nativa', () => {
  assert.match(interceptor, /camuflarFuncaoNativa\(novoOpen, origOpen, 'open'\)/);
  assert.match(interceptor, /camuflarFuncaoNativa\(novoSend, origSend, 'send'\)/);
  assert.match(interceptor, /camuflarFuncaoNativa\(novoFetch, origFetch, 'fetch'\)/);
});

test('interceptação de fetch é opcional e desligada por padrão', () => {
  assert.match(interceptor, /configGlobal\.interceptarFetch === true/);
  assert.ok(!/window\.fetch = novoFetch;[^}]*(?:\n\s*})?\n\s*(?:catch|[A-Za-z])/s.test(interceptor), 'fetch deve estar dentro da condicional');
});

test('o listener de load é registrado antes do send original (zero custo de latência)', () => {
  const sendIdx = interceptor.indexOf('var novoSend = function () {');
  const addIdx = interceptor.indexOf("this.addEventListener('load', function () {", sendIdx);
  const origIdx = interceptor.indexOf('origSend.apply(this, arguments)', sendIdx);
  assert.ok(sendIdx > 0 && addIdx > 0 && origIdx > 0, 'novoSend não encontrado');
  assert.ok(addIdx < origIdx, 'listener deve ser registrado antes do send original');
});

test('estatísticas incluem o contador do modo rápido', () => {
  assert.match(interceptor, /viaRapido: 0/);
});

test('toString próprio da função substituta não é enumerável', () => {
  const contexto = { WeakMap, Object };
  vm.runInNewContext(interceptor, contexto);
  function original(a) { return a; }
  const substituta = function (a) { return a; };
  contexto.camuflarFuncaoNativa(substituta, original, 'original');
  const descriptor = Object.getOwnPropertyDescriptor(substituta, 'toString');
  assert.equal(descriptor.enumerable, false);
  assert.equal(substituta.toString(), 'function original() { [native code] }');
});
