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

test('árvore aceita item no DOM quando offsetParent é nulo', () => {
  const item = {
    hidden: false,
    disabled: false,
    className: 'arvore-item',
    classList: { contains: () => false },
    querySelector: () => ({ textContent: 'ICMP' }),
    getAttribute: () => 'TI - Redes de Computadores: ICMP'
  };
  const context = {
    clean: (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim(),
    mesmoTexto: (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(),
    document: { querySelectorAll: () => [item] },
    item,
    box: { contains: () => true }
  };
  vm.runInNewContext(`${source}\nresult = itemDaArvore(box, 'ICMP') === item;`, context);
  assert.equal(context.result, true);
});

test('busca usa o contêiner Angular atual após re-renderização', () => {
  const item = {
    hidden: false,
    disabled: false,
    className: 'arvore-item arvore-item-selecionar-tudo',
    classList: { contains: (name) => name === 'arvore-item-selecionar-tudo' },
    querySelector: () => ({ textContent: 'Protocolo IP' }),
    getAttribute: () => 'TI - Redes de Computadores: Protocolo IP'
  };
  const antigo = {
    getAttribute: () => 'Matérias',
    contains: () => false
  };
  const atual = {
    getAttribute: () => 'Matérias',
    contains: (node) => node === item
  };
  const context = {
    clean: (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim(),
    mesmoTexto: (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(),
    document: { querySelectorAll: (selector) => selector === '.arvore-item' ? [item] : [] },
    visiveis: (selector) => selector === '.gerador-buscador' ? [context.boxAtual] : [],
    boxAtual: antigo
  };
  vm.runInNewContext(source, context);
  context.boxAtual = atual;
  vm.runInNewContext("result = itemAtualDaAba('Matéria e assunto', 'Protocolo IP');", context);
  assert.equal(context.result.box, atual);
  assert.equal(context.result.item, item);
});

test('seleção reconsulta buscador e confirmação após atualizações Angular', () => {
  const selecionarInicio = source.indexOf('async function selecionarValor');
  const selecionar = source.slice(selecionarInicio, source.indexOf('function contarFiltrosAtivos'));
  assert.match(selecionar, /itemAtualDaAba\(titulo, candidatos\[i\]\)/);
  assert.match(selecionar, /box !== boxDaAba\(titulo\)/);
  assert.ok((selecionar.match(/boxDaAba\(titulo\)/g) || []).length >= 6);
  assert.match(selecionar, /CONFIG\.filtroTimeout \|\| 15000/);
  assert.match(selecionar, /search = box && box\.querySelector/);
  assert.match(selecionar, /resultado de .* foi substituído durante a busca/);
});
