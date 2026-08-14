import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'src/fabrica/17-exportacao.js'), 'utf8');

function loadExport() {
  const window = {};
  vm.runInNewContext(source, {
    window,
    Map, Set, Promise, Date, JSON, Object, Array, Uint8Array, TextEncoder,
    setTimeout, clearTimeout,
    clean: (value) => String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
  }, { filename: '17-exportacao.js' });
  return window.__TecFabricaExport;
}

const questions = [
  { id: '1', subject: 'Morfologia', bank: 'FCC' },
  { id: '2', subject: 'Sintaxe', bank: 'FGV' },
  { id: '3', subject: 'Morfologia', bank: 'FGV' },
];

test('normaliza filtros: remove vazios, aplica trim e deduplica seleções', () => {
  const exp = loadExport();

  const normalized = exp.normalizeExportFilters({ subjects: [' Morfologia ', '', 'Morfologia', null], banks: [' FCC ', 'FCC', ' ', undefined] });
  assert.deepEqual(
    { subjects: Array.from(normalized.subjects), banks: Array.from(normalized.banks) },
    { subjects: ['Morfologia'], banks: ['FCC'] },
  );
  const empty = exp.normalizeExportFilters();
  assert.deepEqual({ subjects: Array.from(empty.subjects), banks: Array.from(empty.banks) }, { subjects: [], banks: [] });
});

test('filtra por uma matéria e várias bancas preservando a ordem', () => {
  const exp = loadExport();

  assert.deepEqual(
    Array.from(exp.filterExportQuestions(questions, { subjects: ['Morfologia'], banks: ['FCC', 'FGV'] }), (question) => question.id),
    ['1', '3'],
  );
});

test('trata filtros vazios como todos e desconhecidos como nenhum resultado', () => {
  const exp = loadExport();

  assert.deepEqual(Array.from(exp.filterExportQuestions(questions, { subjects: [], banks: ['FGV'] }), (question) => question.id), ['2', '3']);
  assert.deepEqual(Array.from(exp.filterExportQuestions(questions, { subjects: [], banks: [] }), (question) => question.id), ['1', '2', '3']);
  assert.deepEqual(Array.from(exp.filterExportQuestions(questions, { subjects: ['Inexistente'], banks: [] })), []);
  assert.deepEqual(Array.from(exp.filterExportQuestions(questions, { subjects: [], banks: ['CESPE'] })), []);
});
