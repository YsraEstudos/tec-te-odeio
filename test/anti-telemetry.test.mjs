import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/02-anti-detecao.js'), 'utf8');

function carregar() {
  const xhrs = [];
  const beacons = [];
  const fetches = [];

  function XHR() {}
  XHR.prototype.open = function (method, url) {
    this.method = method;
    this.url = url;
    xhrs.push({ tipo: 'open', method, url });
  };
  XHR.prototype.send = function (body) {
    xhrs.push({ tipo: 'send', body });
  };

  const window = {
    fetch(input) {
      fetches.push(input);
      return Promise.resolve({ ok: true });
    },
    fetchLater(input) {
      fetches.push(input);
      return { queued: true };
    },
    Response: class Response {
      constructor(body, init) { this.body = body; this.status = init.status; }
    },
  };
  const navigator = {
    sendBeacon(url, data) {
      beacons.push({ url, data });
      return true;
    },
  };
  const context = vm.createContext({
    window,
    navigator,
    XMLHttpRequest: XHR,
    URL,
    location: { href: 'https://www.tecconcursos.com.br/questoes/1' },
    Promise,
    Object,
    Array,
    String,
    TypeError,
    Response: window.Response,
  });
  vm.runInContext(source, context, { filename: '02-anti-detecao.js' });
  context.bloquearTelemetria();
  return { context, window, xhrs, beacons, fetches };
}

test('bloqueia XHR de tracker antes de send e preserva API própria', () => {
  const { context, xhrs } = carregar();
  const bloqueado = new context.XMLHttpRequest();
  bloqueado.open('POST', 'https://analytics.example.invalid/collect');
  bloqueado.send('payload');

  const proprio = new context.XMLHttpRequest();
  proprio.open('GET', 'https://www.tecconcursos.com.br/api/cadernos/1');
  proprio.send();

  assert.equal(xhrs[0].url, 'about:blank');
  assert.equal(xhrs.filter((item) => item.tipo === 'send').length, 1);
});

test('bloqueia fetch, fetchLater e beacon de destinos de telemetria', async () => {
  const { context, window, beacons, fetches } = carregar();
  const blocked = await window.fetch('https://www.google-analytics.com/g/collect');
  assert.equal(blocked.status, 204);
  const queued = window.fetchLater('https://metrics.example.invalid/events');
  assert.equal(queued.activated, false);
  assert.equal(context.navigator.sendBeacon('https://stats.example.invalid/beacon', 'x'), false);
  assert.equal(beacons.length, 0);

  await window.fetch('https://www.tecconcursos.com.br/api/filtros');
  assert.equal(fetches.length, 1);
});

test('globals internos não são enumeráveis nem reconfiguráveis', () => {
  const { context, window } = carregar();
  context.ocultarGlobal('__testeInterno', { ok: true });
  assert.equal(Object.prototype.propertyIsEnumerable.call(window, '__testeInterno'), false);
  assert.equal(Object.getOwnPropertyDescriptor(window, '__testeInterno').configurable, false);
  assert.equal(Object.getOwnPropertyDescriptor(window, '__testeInterno').writable, false);
});
