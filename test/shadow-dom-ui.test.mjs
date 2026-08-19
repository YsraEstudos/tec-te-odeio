import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ui = readFileSync(resolve(root, 'src/fabrica/18-ui.js'), 'utf8');

test('painel fica dentro de Shadow DOM fechado com host discreto', () => {
  assert.match(ui, /hospedeiro\.id = 'tf-host'/);
  assert.match(ui, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.match(ui, /sombra\.appendChild\(estilo\)/);
  assert.match(ui, /sombra\.appendChild\(painelEl\)/);
});

test('document.querySelector do site não atravessa o shadow root', () => {
  assert.match(ui, /seletores globais do/);
  assert.match(ui, /não atravessam o shadow root/);
  assert.match(ui, /não uma[\s\S]*fronteira de segurança/);
});

test('fallback preserva o comportamento antigo quando não há attachShadow', () => {
  assert.match(ui, /document\.head\.appendChild\(estilo\)/);
  assert.match(ui, /document\.body\.appendChild\(painelEl\)/);
});

test('o id tec-fabrica é mantido (contrato da UI inalterado)', () => {
  assert.match(ui, /painelEl\.id = 'tec-fabrica'/);
});

test('config do modo rápido exposta na aba Config com campos esperados', () => {
  assert.match(ui, /id="tf-rapido-ativo"/);
  assert.match(ui, /id="tf-rapido-delay"/);
  assert.match(ui, /id="tf-rapido-cb"/);
  assert.match(ui, /id="tf-rapido-oculta"/);
  assert.match(ui, /rapidoSemGabaritoAtivo !== false \? 'checked' : ''/);
});

test('salvar configuração lê e persiste os campos do modo rápido', () => {
  assert.match(ui, /cfg\.rapidoSemGabaritoAtivo = rapidoAtivoEl\.checked/);
  assert.match(ui, /cfg\.rapidoDelayMin = Math\.max\(100, Math\.round\(\(parseFloat\(rapidoPartes\[0\]\) \|\| 0\.3\) \* 1000\)\)/);
  assert.match(ui, /cfg\.rapidoCoffeeBreakAtivo = rapidoCbEl\.checked/);
  assert.match(ui, /cfg\.rapidoPausaAbaOculta = rapidoOcultaEl\.checked/);
});

test('consultas internas funcionam dentro do Shadow DOM fechado', () => {
  assert.match(ui, /function buscarNaUI\(seletor\)/);
  assert.match(ui, /painelEl\.querySelector\(seletor\)/);
  assert.doesNotMatch(ui, /document\.getElementById\('tf-/);
  for (const id of ['tf-log-box', 'tf-plano-arvore', 'tf-restantes-exec', 'tf-eta-exec', 'tf-msg']) {
    assert.match(ui, new RegExp(`buscarNaUI\\('#${id}'\\)`));
  }
});
