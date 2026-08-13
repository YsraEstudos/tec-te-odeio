import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('coleta registra ciclo completo por questão e por retry', () => {
  const source = read('src/fabrica/14-coleta.js');

  for (const marker of [
    "tipo: 'observacao'",
    "tipo: 'tentativa'",
    "tipo: 'resultado'",
    "tipo: 'erro'",
    'answerSource',
    'duracaoMs',
    'gabarito',
    'questaoId',
    'salvas',
  ]) {
    assert.ok(source.includes(marker), `instrumentação ausente na coleta: ${marker}`);
  }
  assert.match(source, /Retry.*questões sem gabarito/);
  assert.match(source, /coleta.*completa/i);
});

test('resolução registra decisões e resultados sem guardar resposta bruta', () => {
  const source = read('src/fabrica/10-resolucao.js');

  for (const marker of [
    "tipo: 'decisao'",
    "tipo: 'tentativa'",
    "tipo: 'resultado'",
    'viaCache',
    'viaResolucaoVisivel',
    'viaClique',
    'semGabarito',
  ]) {
    assert.ok(source.includes(marker), `instrumentação ausente na resolução: ${marker}`);
  }
  assert.doesNotMatch(source, /contexto:\s*\{[^}]*responsetext/i);
});

test('extração e interceptor registram identificação e método do gabarito', () => {
  const extracao = read('src/fabrica/08-extracao.js');
  const interceptor = read('src/fabrica/09-interceptor.js');

  for (const marker of ['questaoId', 'numero', 'total', 'opcoes', "tipo: 'observacao'"]) {
    assert.ok(extracao.includes(marker), `metadado de extração ausente: ${marker}`);
  }
  for (const marker of ['cadernoId', 'metodo', 'gabarito', "tipo: 'resultado'"]) {
    assert.ok(interceptor.includes(marker), `metadado de interceptação ausente: ${marker}`);
  }
});

test('orquestrador registra decisões do plano e inicialização registra retomada', () => {
  const orquestrador = read('src/fabrica/15-orquestrador.js');
  const inicializacao = read('src/fabrica/19-inicializacao.js');

  assert.match(orquestrador, /planIndex/);
  assert.match(orquestrador, /tipo: 'decisao'/);
  assert.match(orquestrador, /tipo: 'erro'/);
  assert.match(inicializacao, /tipo: 'observacao'/);
  assert.match(inicializacao, /tipo: 'decisao'/);
  assert.match(inicializacao, /estado.fase/);
});
