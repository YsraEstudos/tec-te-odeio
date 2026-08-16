import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/03-log.js'), 'utf8');

function loadLogger({ logs = [], fase = 'coletando', estadoExtras = {} } = {}) {
  const eventos = [];
  const saves = [];
  const window = {};
  const contexto = {
    window,
    estado: { fase, logs, ...estadoExtras },
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

  assert.equal(evento.contexto.questaoId, 'q-1');
  assert.equal(evento.contexto.metodo, 'cache');
  assert.equal(evento.contexto.opcoes, 5);
  assert.equal(evento.contexto.operacional.faseEstado, 'resolvendo');
  assert.equal(typeof evento.contexto.operacional.bootId, 'string');
  assert.match(api.formatarEventoLog(evento), /q-1/);
});

test('logger adiciona contexto operacional da matéria, lote e caderno', () => {
  const { api } = loadLogger({
    estadoExtras: {
      status: 'rodando',
      planIndex: 4,
      loteInicio: 0,
      loteFim: 20,
      passada: 'criacao',
      plano: { matters: [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }, { title: 'Concordância' }] },
      cadernoAtual: { id: 'c-1', coletadas: 3, total: 30, completo: false },
    },
  });
  const evento = api.log('falha de diagnóstico', { persist: false });

  assert.equal(evento.contexto.operacional.estadoStatus, 'rodando');
  assert.equal(evento.contexto.operacional.planIndex, 4);
  assert.equal(evento.contexto.operacional.loteFim, 20);
  assert.equal(evento.contexto.operacional.passada, 'criacao');
  assert.equal(evento.contexto.operacional.materiaAtual, 'Concordância');
  assert.equal(evento.contexto.operacional.cadernoId, 'c-1');
  assert.equal(evento.contexto.operacional.cadernoColetadas, 3);
  assert.equal(evento.contexto.operacional.cadernoTotal, 30);
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
