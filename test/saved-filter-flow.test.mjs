import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/11-filtros.js'), 'utf8');

test('filtro Padrao usa o menu desktop quando o site duplica o id para mobile', () => {
  assert.match(source, /querySelectorAll\('#sub-menu-filtros-salvos'\)/);
  assert.match(source, /pai\.offsetParent !== null/);
  assert.match(source, /nomeEl\.textContent/);
  assert.match(source, /menuFiltrosSalvosAberto\(\)/);
});

test('filtro Padrao é carregado antes da matéria sem reaplicar banca e ano', () => {
  const aplicarInicio = source.indexOf('async function aplicarFiltros');
  const aplicar = source.slice(aplicarInicio);
  assert.ok(aplicarInicio >= 0);
  assert.ok(aplicar.indexOf('await carregarFiltroPadrao();') < aplicar.indexOf("await selecionarValor('Matéria e assunto', folha);"));
  assert.doesNotMatch(aplicar, /selecionarValor\('Banca'/);
  assert.doesNotMatch(aplicar, /selecionarValor\('Ano'/);
});
