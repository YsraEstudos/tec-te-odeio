import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const coleta = readFileSync(resolve(root, 'src/fabrica/14-coleta.js'), 'utf8');
const stealth = readFileSync(resolve(root, 'src/fabrica/02-stealth.js'), 'utf8');
const orquestrador = readFileSync(resolve(root, 'src/fabrica/15-orquestrador.js'), 'utf8');
const resolucao = readFileSync(resolve(root, 'src/fabrica/10-resolucao.js'), 'utf8');
const interceptor = readFileSync(resolve(root, 'src/fabrica/09-interceptor.js'), 'utf8');
const paginas = readFileSync(resolve(root, 'src/fabrica/07-paginas.js'), 'utf8');

test('engine de coleta nunca dispara requisições próprias', () => {
  for (const fonte of [coleta, stealth, orquestrador, resolucao]) {
    assert.ok(!/new XMLHttpRequest\(\)/.test(fonte), 'new XMLHttpRequest não permitido');
    assert.ok(!/\.send\(/.test(fonte), '.send() não permitido');
    assert.ok(!/\bfetch\(/.test(fonte), 'fetch() não permitido');
  }
});

test('a única leitura de rede é a observação passiva no interceptor', () => {
  assert.match(interceptor, /xhr\.responseText/);
  assert.match(interceptor, /JSON\.parse\(xhr\.responseText\)/);
  const rede = interceptor.match(/\bfetch\(/g) || [];
  assert.ok(rede.length <= 2, 'fetch só aparece na definição do patch opcional');
});

test('navegação usa o mecanismo da própria aplicação (broadcast do Angular)', () => {
  assert.match(paginas, /\$broadcast\('abrir-questao'/);
  assert.match(paginas, /inj\.get\('\$rootScope'\)/);
  assert.match(coleta, /navegarQuestao\(numeroAlvo\)/);
});

test('nenhuma rota de rede no caminho rápido: só caches e scope em memória', () => {
  const inicio = coleta.indexOf('async function coletarQuestaoRapida');
  assert.ok(inicio > 0, 'coletarQuestaoRapida não encontrada');
  const fim = coleta.indexOf('\n    }\n', coleta.indexOf('return { fim: false };\n', inicio));
  const trecho = coleta.slice(inicio, fim > inicio ? fim : coleta.length);
  assert.ok(!/XMLHttpRequest|\.send\(|\bfetch\(|\.open\(/.test(trecho), 'caminho rápido não pode tocar em rede');
});