import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/03-log.js'), 'utf8');

function loadLogger({ logs = [], fase = 'coletando' } = {}) {
  const eventos = [];
  const saves = [];
  const window = {};
  const contexto = {
    window,
    estado: { fase, logs },
    UI: { appendLog: (evento) => eventos.push(evento) },
    salvarEstado: () => saves.push(true),
    console: { log() {}, warn() {}, error() {} },
    Date, JSON, Object, Array, String, Number, Math,
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(source, contexto, { filename: '03-log.js' });
  return { api: window.__TecFabricaLog, estado: contexto.estado, eventos, saves };
}

test('logger cria evento estruturado e mantém compatibilidade com mensagem simples', async () => {
  const { api, estado, eventos, saves } = loadLogger();
  const evento = api.log('começando a coleta');

  assert.equal(evento.tipo, 'evento');
  assert.equal(evento.nivel, 'info');
  assert.equal(evento.fase, 'coletando');
  assert.equal(evento.mensagem, 'começando a coleta');
  assert.equal(estado.logs.length, 1);
  assert.equal(eventos[0], evento);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(saves.length, 1);
  assert.match(api.formatarEventoLog(evento), /evento.*coletando.*começando a coleta/i);
});

test('logger preserva tipo, nível, fase e contexto permitido', () => {
  const { api } = loadLogger({ fase: 'resolvendo' });
  const evento = api.log('tentando gabarito', {
    tipo: 'tentativa',
    nivel: 'info',
    fase: 'resolvendo',
    contexto: { questaoId: 'q-1', metodo: 'cache', opcoes: 5 },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(evento.contexto)), { questaoId: 'q-1', metodo: 'cache', opcoes: 5 });
  assert.match(api.formatarEventoLog(evento), /q-1/);
});

test('contexto do log redige segredos e trunca dados grandes', () => {
  const { api } = loadLogger();
  const valor = 'x'.repeat(400);
  const evento = api.log('contexto limitado', {
    contexto: {
      token: 'não pode aparecer',
      authorization: 'Bearer segredo',
      resposta: valor,
    },
  });

  assert.equal(Object.hasOwn(evento.contexto, 'token'), false);
  assert.equal(Object.hasOwn(evento.contexto, 'authorization'), false);
  assert.ok(evento.contexto.resposta.length <= 280);
});

test('logger conserva apenas os 600 eventos mais recentes', () => {
  const logs = [];
  const { api, estado } = loadLogger({ logs });
  for (let i = 0; i < 605; i += 1) api.log('evento ' + i, { persist: false });

  assert.equal(estado.logs.length, 600);
  assert.equal(estado.logs[0].mensagem, 'evento 5');
  assert.equal(estado.logs.at(-1).mensagem, 'evento 604');
});
