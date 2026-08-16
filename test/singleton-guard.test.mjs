import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const header = readFileSync(resolve(root, 'src/fabrica/00-cabecalho.js'), 'utf8');

function executarCabecalho(contexto) {
  vm.runInContext(`${header}\n})();`, contexto, { filename: '00-cabecalho.js' });
}

test('segunda instância do userscript é bloqueada antes da inicialização', () => {
  const avisos = [];
  const contexto = vm.createContext({
    window: {},
    location: { hostname: 'www.tecconcursos.com.br', pathname: '/questoes/filtrar' },
    console: { warn: (...args) => avisos.push(args) },
    Date
  });

  executarCabecalho(contexto);
  executarCabecalho(contexto);

  assert.equal(avisos.length, 0);
  assert.equal(contexto.window.__TecFabricaRuntime.ativo, true);
  assert.equal(Object.prototype.propertyIsEnumerable.call(contexto.window, '__TecFabricaRuntime'), false);
  assert.equal(Object.getOwnPropertyDescriptor(contexto.window, '__TecFabricaRuntime').configurable, false);
});
