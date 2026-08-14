import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/18-ui.js'), 'utf8');
const modelSource = readFileSync(resolve(root, 'src/fabrica/18-ui-model.js'), 'utf8');

function loadModel() {
  const window = {};
  const context = { window, JSON, Object, Array, String, Map };
  vm.runInNewContext(modelSource, context);
  return window.PLANO_UI_MODEL || context.PLANO_UI_MODEL;
}

function sectionBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `marcador ausente: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `marcador ausente: ${endMarker}`);
  return source.slice(start, end);
}

test('modelo renderiza árvore segura, recolhida e com metadados', () => {
  const model = loadModel();
  const html = model.renderArvore({ matters: [
    {
      code: 'MAT-"1',
      title: 'Português <script>',
      group: 'Base & <',
      subjectIds: ['101', '102'],
      subjectPaths: ['Língua > Morfologia', 'Língua > Morfologia > Classes & <']
    },
    {
      code: 'MAT-002',
      title: 'Direito',
      group: 'Base & <',
      subjectIds: ['103'],
      subjectPaths: ['Constitucional']
    }
  ] });

  assert.match(html, /<details class="tf-tree-node tf-tree-category">/);
  assert.match(html, /class="tf-tree-count">2 matérias<\/span>/);
  assert.match(html, /class="tf-tree-chevron"[^>]*viewBox="0 0 10 10"/);
  assert.match(html, /class="tf-tree-code">MAT-&quot;1<\/span>/);
  assert.match(html, /class="tf-tree-subject-count">2 assuntos<\/span>/);
  assert.match(html, /class="tf-tree-leaf"[^>]+data-code="102"/);
  assert.match(html, /Classes &amp; &lt;/);
  assert.doesNotMatch(html, /<details[^>]+\bopen(?:=|>)/);
  assert.doesNotMatch(html, /<script|<img>/);
});

test('htmlPlano hidrata o editor e o loader salva somente depois da normalização', () => {
  const htmlPlano = sectionBetween('function htmlPlano() {', 'function htmlConfig() {');
  assert.match(htmlPlano, /PLANO_UI_MODEL\.textoParaEdicao\(estado\)/);
  assert.match(htmlPlano, /PLANO_UI_MODEL\.renderArvore\(p, statusMaterias\(estado\)\)/);
  assert.match(htmlPlano, /escapeHtml\(texto\)/);
  assert.match(htmlPlano, /<label class="tf-secao-titulo" for="tf-plano-texto">/);

  const handler = sectionBetween('function ligarEventos(corpo) {', '/* Copiar sob demanda');
  const firstHandler = handler.slice(0, handler.indexOf('var salvar ='));
  const tryStart = firstHandler.indexOf('try {');
  const catchStart = firstHandler.indexOf('} catch (e) {', tryStart);
  assert.notEqual(tryStart, -1, 'try do carregamento ausente');
  assert.notEqual(catchStart, -1, 'catch do carregamento ausente');
  const tryBody = firstHandler.slice(tryStart, catchStart);
  const catchBody = firstHandler.slice(catchStart);
  const loaderIndex = tryBody.indexOf('PLANO_UI_MODEL.carregarPlano(texto, normalizarPlano, estado)');
  const checkpointIndex = tryBody.indexOf('salvarEstado(true)');

  assert.ok(loaderIndex >= 0, 'loader não está no try do handler');
  assert.ok(checkpointIndex > loaderIndex, 'checkpoint precisa vir depois do loader');
  assert.doesNotMatch(catchBody, /estado\.plano(?:Texto)?\s*=/);
  assert.doesNotMatch(catchBody, /salvarEstado\(true\)/);
});

test('UI_CSS contém os contratos visuais dentro do bloco efetivamente aplicado', () => {
  const css = sectionBetween('var UI_CSS = [', '    ].join(\'\');');
  assert.match(css, /#tec-fabrica\{[^}]*width:min\(400px,calc\(100vw - 20px\)/);
  assert.match(css, /#tec-fabrica \.tf-corpo\{[^}]*overflow-x:hidden/);
  assert.match(css, /\.tf-tree-node > summary:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /animation:none !important/);
  assert.match(css, /\.tf-tree-chevron/);
});

test('htmlExecucao exibe o saldo diário de resoluções', () => {
  const htmlExecucao = sectionBetween('function htmlExecucao() {', 'function htmlBiblioteca() {');
  const context = {
    estado: {
      plano: { matters: [{ title: 'Português' }] },
      config: { batchSize: 1 },
      planIndex: 0,
      loteInicio: 0,
      fase: 'nenhuma',
      status: 'parado',
      controleResolucoesDiarias: { data: '2026-08-14', total: 37 }
    },
    escapeHtml: (value) => String(value),
    resumoResolucoesDiarias: () => ({
      data: '2026-08-14', limite: 1200, usadas: 37, restantes: 1163, esgotado: false
    })
  };
  vm.runInNewContext(`${htmlExecucao}\nresult = htmlExecucao();`, context);

  assert.match(context.result, /id="tf-limite-diario"/);
  assert.match(context.result, /Resoluções hoje: 37\/1200 · Restam 1163/);
});
