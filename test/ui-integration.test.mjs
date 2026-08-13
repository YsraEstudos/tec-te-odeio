import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/18-ui.js'), 'utf8');

test('aba Plano reutiliza texto persistido e renderiza a árvore', () => {
  assert.match(source, /PLANO_UI_MODEL\.textoParaEdicao\(estado\)/);
  assert.match(source, /PLANO_UI_MODEL\.renderArvore\(p\)/);
  assert.match(source, /escapeHtml\(texto\)/);
});

test('carregar plano usa atualização atômica e checkpoint imediato', () => {
  assert.match(source, /PLANO_UI_MODEL\.carregarPlano\(texto, normalizarPlano, estado\)/);
  assert.match(source, /salvarEstado\(true\)/);
});

test('painel é responsivo e respeita movimento reduzido', () => {
  assert.match(source, /min\(400px,calc\(100vw - 20px\)/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /tf-tree-node/);
});
