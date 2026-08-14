import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const exportSource = readFileSync(resolve(root, 'src/fabrica/17-exportacao.js'), 'utf8');

function loadExport() {
  const window = {};
  vm.runInNewContext(exportSource, {
    window,
    Map, Set, Promise, Date, JSON, Object, Array, Uint8Array, TextEncoder,
    setTimeout, clearTimeout,
    clean: (value) => String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
  }, { filename: '17-exportacao.js' });
  return window.__TecFabricaExport;
}

class FakeElement {
  constructor(document, tagName, attributes = {}) {
    this.document = document;
    this.tagName = tagName;
    this.attributes = { ...attributes };
    this.children = [];
    this.options = [];
    this.listeners = new Map();
    this.parentElement = null;
    this.textContent = '';
    this.innerHTML = '';
    this.value = attributes.value || '';
    this.href = '';
    this.download = '';
    this._id = attributes.id || '';
    if (this._id) document.elements.set(this._id, this);
  }

  get id() { return this._id; }

  set id(value) {
    if (this._id) this.document.elements.delete(this._id);
    this._id = String(value);
    if (this._id) this.document.elements.set(this._id, this);
  }

  getAttribute(name) { return this.attributes[name] == null ? null : this.attributes[name]; }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertAdjacentHTML(_position, html) {
    const match = html.match(/<option>([\s\S]*)<\/option>/);
    if (!match) return;
    const value = match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    this.options.push({ value, selected: false });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, target = this) {
    (this.listeners.get(type) || []).forEach((listener) => listener({ target, preventDefault() {} }));
  }

  matches(selector) {
    return selector === '[data-filter]' && this.getAttribute('data-filter') != null;
  }

  closest(selector) {
    return selector === '[data-clear-filter]' && this.getAttribute('data-clear-filter') != null ? this : null;
  }

  click() {
    if (this.onclick) this.onclick();
    this.dispatch('click');
    if (this.download) this.document.downloads.push({ name: this.download, href: this.href });
  }

  remove() {}
}

class FakeDocument {
  constructor(data, state) {
    this.elements = new Map();
    this.downloads = [];
    this.head = new FakeElement(this, 'head');
    this.body = new FakeElement(this, 'body');
    this.documentElement = { outerHTML: '<html></html>' };
    this.create('title');
    const controls = this.create('controls', { class: 'controls' });
    this.create('prev');
    this.create('next');
    this.create('jump');
    this.create('go');
    this.create('subject', { 'data-filter': 'subject' });
    this.create('bank', { 'data-filter': 'bank' });
    const year = this.create('year');
    year.options.push({ value: '', selected: true });
    year.parentElement = new FakeElement(this, 'label');
    year.parentElement.parentElement = controls;
    this.create('newAttempt');
    this.create('saveHtml');
    this.create('downloadTxt');
    this.create('downloadPdf');
    this.create('status');
    this.create('summary');
    this.create('question');
    const dataElement = this.create('tec-caderno-data');
    dataElement.textContent = JSON.stringify(data);
    const stateElement = this.create('tec-caderno-state');
    stateElement.textContent = JSON.stringify(state);
  }

  create(id, attributes = {}) { return new FakeElement(this, 'div', { ...attributes, id }); }

  createElement(tagName) { return new FakeElement(this, tagName); }

  getElementById(id) { return this.elements.get(id) || null; }

  querySelector(selector) {
    if (selector === '.controls') return this.getElementById('controls');
    const filter = selector.match(/^\[data-filter="(.+)"\]$/);
    if (filter) return Array.from(this.elements.values()).find((element) => element.getAttribute('data-filter') === filter[1]) || null;
    return null;
  }

  querySelectorAll(selector) { return selector === '.option' ? [] : []; }
}

function createRuntime(entry) {
  const html = loadExport().buildInteractiveHtml(entry);
  const data = JSON.parse(html.match(/<script id="tec-caderno-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const state = JSON.parse(html.match(/<script id="tec-caderno-state" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const runtime = html.match(/<script>([\s\S]*)<\/script><\/body><\/html>$/)[1];
  const document = new FakeDocument(data, state);
  const blobs = [];
  const printWindows = [];
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
      blobs.push(this);
    }
  }
  const window = {
    open: () => {
      const printWindow = { prints: 0, focus() {}, print() { this.prints++; }, addEventListener() {} };
      printWindows.push(printWindow);
      return printWindow;
    },
  };
  vm.runInNewContext(runtime, {
    window, document, Blob: FakeBlob,
    URL: { createObjectURL: () => 'blob:runtime', revokeObjectURL() {} },
    Map, Set, Promise, Date, JSON, Object, Array, String, Number,
    setTimeout: () => 0, clearTimeout,
  }, { filename: 'interactive-runtime.js' });
  return { document, blobs, printWindows };
}

function selectOnly(element, values) {
  element.options.forEach((option) => { option.selected = values.includes(option.value); });
  element.value = values[0] || '';
}

test('runtime filtra, limpa e exporta o mesmo recorte de matéria, banca, ano e vaga', () => {
  const runtime = createRuntime({
    id: 'runtime', code: 'runtime', title: 'Runtime',
    questions: [
      { id: 'q1', number: 1, subject: 'Português', bank: 'FCC', year: 2024, vacancy: 7, statement: 'P-FCC', options: [{ letter: 'A', text: 'Primeira' }] },
      { id: 'q2', number: 2, subject: 'Português', bank: 'FGV', year: 2024, vacancy: 7, statement: 'P-FGV', options: [{ letter: 'B', text: 'Segunda' }] },
      { id: 'q3', number: 3, subject: 'Direito', bank: 'FCC', year: 2024, vacancy: 7, statement: 'D-FCC', options: [{ letter: 'C', text: 'Terceira' }] },
      { id: 'q4', number: 4, subject: 'Português', bank: 'FCC', year: 2023, vacancy: 7, statement: 'Ano antigo', options: [] },
      { id: 'q5', number: 5, subject: 'Português', bank: 'FCC', year: 2024, vacancy: 8, statement: 'Outra vaga', options: [] },
      { id: 'q6', number: 6, subject: 'Português', bank: 'FGV', year: 2024, vacancy: 7, statement: 'Sem gabarito', options: [{ letter: 'D', text: 'Alternativa sem gabarito' }] },
    ],
  });
  const { document, blobs, printWindows } = runtime;
  const controls = document.querySelector('.controls');
  const subject = document.getElementById('subject');
  const bank = document.getElementById('bank');
  const year = document.getElementById('year');
  const vacancy = document.getElementById('vacancy');

  selectOnly(subject, ['Português']);
  selectOnly(bank, ['FCC', 'FGV']);
  selectOnly(year, ['2024']);
  selectOnly(vacancy, ['7']);
  controls.dispatch('change', subject);
  assert.match(document.getElementById('summary').textContent, /3 questão\(ões\) filtrada\(s\) de 6/);

  document.getElementById('downloadTxt').click();
  const txt = String(blobs[0].parts[0]);
  assert.match(txt, /P-FCC|P-FGV|Sem gabarito/);
  assert.doesNotMatch(txt, /D-FCC|Ano antigo|Outra vaga/);

  document.getElementById('downloadPdf').click();
  const printHtml = String(blobs[1].parts[0]);
  assert.match(printHtml, /P-FCC|P-FGV|Sem gabarito/);
  assert.match(printHtml, /Alternativa sem gabarito/);
  assert.doesNotMatch(printHtml, /D-FCC|Ano antigo|Outra vaga/);
  assert.equal(printWindows[0].prints, 0, 'recorte é construído antes do diálogo nativo de impressão');
  printWindows[0].onload();
  assert.equal(printWindows[0].prints, 1);

  const clearSubject = new FakeElement(document, 'button', { 'data-clear-filter': 'subject' });
  controls.dispatch('click', clearSubject);
  assert.ok(subject.options.every((option) => !option.selected));
  assert.match(document.getElementById('summary').textContent, /4 questão\(ões\) filtrada\(s\) de 6/);
});
