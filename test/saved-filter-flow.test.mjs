import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/11-filtros.js'), 'utf8');

test('filtro Padrao usa o menu desktop quando o site duplica o id para mobile', () => {
  assert.match(source, /querySelectorAll\('#sub-menu-filtros-salvos'\)/);
  assert.match(source, /pai\.offsetParent !== null/);
  assert.match(source, /nomeEl\.textContent/);
  assert.match(source, /menuFiltrosSalvosAberto\(\)/);
  assert.match(source, /\.ajs-button\.ajs-ok/);
  assert.match(source, /confirmarCarregamentoFiltro\(\)/);
});

test('filtro Padrao é carregado antes da matéria sem reaplicar banca e ano', () => {
  const aplicarInicio = source.indexOf('async function aplicarFiltros');
  const aplicar = source.slice(aplicarInicio);
  assert.ok(aplicarInicio >= 0);
  assert.ok(aplicar.indexOf('await carregarFiltroPadrao();') < aplicar.indexOf("await selecionarValor('Matéria e assunto', folha);"));
  assert.doesNotMatch(aplicar, /selecionarValor\('Banca'/);
  assert.doesNotMatch(aplicar, /selecionarValor\('Ano'/);
});

test('assunto com parêntese aberto aceita o nome completo exibido pelo site', () => {
  const context = {
    clean: (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim(),
    mesmoTexto: (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(),
    item: {
      classList: { contains: () => false },
      querySelector: () => ({ textContent: 'Sistemas Distribuídos (Cluster, GRID, etc.)' }),
      getAttribute: () => 'Sistemas Distribuídos (Cluster, GRID, etc.)'
    }
  };
  vm.runInNewContext(`${source}\nresult = itemCorresponde(item, 'Sistemas Distribuídos (Cluster, GRID');`, context);
  assert.equal(context.result, true);
});

test('assunto abreviado sem etc aceita o sufixo completo exibido pelo site', () => {
  const context = {
    clean: (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim(),
    mesmoTexto: (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(),
    item: {
      classList: { contains: () => false },
      querySelector: () => ({ textContent: 'EXT2, EXT3, XFS, etc.' }),
      getAttribute: () => 'EXT2, EXT3, XFS, etc.'
    }
  };
  vm.runInNewContext(`${source}\nresult = itemCorresponde(item, 'EXT2, EXT3, XFS');`, context);
  assert.equal(context.result, true);
});
