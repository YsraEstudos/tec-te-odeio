import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const paginasSource = readFileSync(resolve(root, 'src/fabrica/07-paginas.js'), 'utf8');
const orquestradorSource = readFileSync(resolve(root, 'src/fabrica/15-orquestrador.js'), 'utf8');
const coletaSource = readFileSync(resolve(root, 'src/fabrica/14-coleta.js'), 'utf8');

function loadPaginas(texto) {
  const window = {};
  const document = { querySelector: () => ({ textContent: texto }) };
  const context = {
    window,
    document,
    location: { pathname: '/questoes/cadernos/1', search: '' },
    estado: { fase: 'coletando' },
    CONFIG: { pollInterval: 100, loadTimeout: 1000 },
    log() {},
    salvarEstado() {},
    workerTick() {},
    angular: {},
    clean: (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim(),
    console,
  };
  vm.runInNewContext(`${paginasSource}\nwindow.__resumeTest = { lerPosicao };`, context, { filename: '07-paginas.js' });
  const resultado = window.__resumeTest.lerPosicao();
  return resultado && { posicao: resultado.posicao, total: resultado.total };
}

test('lerPosicao aceita milhares formatados pelo site em pt-BR', () => {
  assert.deepEqual(loadPaginas('Questão 1.167 de 7.373'), { posicao: 1167, total: 7373 });
  assert.deepEqual(loadPaginas('Questão 1167 de 7373'), { posicao: 1167, total: 7373 });
});

test('coleta não pode transformar posição desconhecida em caderno completo', () => {
  assert.doesNotMatch(coletaSource, /if \(!pos \|\| pos\.posicao >= total\) break/);
  assert.match(coletaSource, /if \(!pos\) \{[\s\S]*?throw new Error\([^)]*posição/);
  assert.match(coletaSource, /var total = pos\.total \|\| caderno\.total/);
  assert.match(coletaSource, /caderno\.totalConfirmado = true/);
});

test('retomada encontra caderno ignorando caixa e acentos no título', () => {
  assert.match(orquestradorSource, /function normalizarTituloCaderno\(titulo\)/);
  assert.match(orquestradorSource, /normalizarTituloCaderno\(b\.titulo\) === alvo/);
  assert.match(orquestradorSource, /existente\.totalConfirmado === true/);
});
