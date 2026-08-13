import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/18-ui.js'), 'utf8');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatarEventoLog(evento) {
  return [evento.at, `[${evento.nivel}]`, `[${evento.tipo}]`, `[${evento.fase}]`, evento.mensagem,
    evento.contexto ? JSON.stringify(evento.contexto) : ''].filter(Boolean).join(' ');
}

function loadUi() {
  const window = {};
  vm.runInNewContext(source, {
    window, JSON, Object, Array, String, Date, Math, Map, Set, console,
    escapeHtml, formatarEventoLog,
  }, { filename: '18-ui.js' });
  return window.__TecFabricaLogUI;
}

test('renderizador do log mostra metadados e escapa mensagem/contexto', () => {
  const ui = loadUi();
  const html = ui.renderEventos([
    {
      at: '2026-08-13T16:00:00.000Z', nivel: 'ok', tipo: 'resultado', fase: 'coleta',
      mensagem: 'gabarito <A>', contexto: { questaoId: 'q1', valor: '<seguro>' },
    },
  ]);

  assert.match(html, /tf-log-event/);
  assert.match(html, /resultado/);
  assert.match(html, /coleta/);
  assert.match(html, /gabarito &lt;A&gt;/);
  assert.match(html, /&quot;valor&quot;:&quot;&lt;seguro&gt;&quot;/);
  assert.doesNotMatch(html, /<seguro>/);
});

test('htmlLog usa estado persistido e oferece contagem e controles', () => {
  assert.match(source, /Array\.isArray\(estado\.logs\)/);
  assert.match(source, /tf-log-copiar/);
  assert.match(source, /tf-log-limpar/);
  assert.match(source, /Eventos persistidos/);
});

test('limpar log preserva plano, biblioteca e configuração e força checkpoint', () => {
  const handler = source.slice(source.indexOf("var limparLog = corpo.querySelector('#tf-log-limpar');"), source.indexOf('corpo.querySelectorAll(\'[data-acao]\')'));
  assert.match(handler, /tf-log-limpar/);
  assert.match(handler, /estado\.logs\s*=\s*\[\]/);
  assert.match(handler, /salvarEstado\(true\)/);
  assert.doesNotMatch(handler, /estado\.(plano|biblioteca|config)\s*=/);
});

test('CSS do log é compacto, rolável e diferencia níveis', () => {
  const css = source.slice(source.indexOf('var UI_CSS = ['), source.indexOf("    ].join('');"));
  assert.match(css, /\.tf-log-event/);
  assert.match(css, /\.tf-log-context/);
  assert.match(css, /\.tf-log\{[^}]*overflow-y:auto/);
  assert.match(css, /\.tf-log-event\.warn/);
  assert.match(css, /\.tf-log-event\.erro/);
});
