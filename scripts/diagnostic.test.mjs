import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { generate, instrument } from './diagnostic.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist/tec_fabrica_cadernos.user.js');
const tmp = resolve(root, '.tmp');

test('diagnóstico gera variante sintaticamente válida fora de dist', () => {
  const result = generate();
  assert.ok(existsSync(result.path));
  assert.notEqual(resolve(result.path), dist);
  assert.match(readFileSync(result.path, 'utf8'), /__TecFabricaDiagnostics/);
  assert.doesNotMatch(readFileSync(dist, 'utf8'), /__TecFabricaDiagnostics/);
});

test('instrumentação rejeita fonte já instrumentada', () => {
  assert.throws(() => instrument('})();\n__TecFabricaDiagnostics'), /já instrumentada/);
  rmSync(tmp, { recursive: true, force: true });
});

test('instrumentação encontra o fecho da IIFE com LF e CRLF', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = '(function () {' + newline + '  var pronta = true;' + newline + '})();' + newline;
    const output = instrument(source);

    assert.match(output, /__TecFabricaDiagnostics/);
    assert.ok(output.endsWith('})();' + newline));
  }
});
