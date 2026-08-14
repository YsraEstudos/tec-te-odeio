import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const persistenceSource = readFileSync(resolve(root, 'src/fabrica/06-persistencia.js'), 'utf8');
const paginasSource = readFileSync(resolve(root, 'src/fabrica/07-paginas.js'), 'utf8');
const orchestratorSource = readFileSync(resolve(root, 'src/fabrica/15-orquestrador.js'), 'utf8');

test('salvarEstado expõe a conclusão da transação usada pelo checkpoint crítico', () => {
  assert.match(persistenceSource, /function salvarEstado\(checkpointCritico\)[\s\S]*?return new Promise\(function \(resolve, reject\)/);
  assert.match(persistenceSource, /salvarEstadoIdb\(snapshot\)\.then\(resolve, function \(e\)/);
  assert.match(persistenceSource, /var anterior = saveChain\.catch\(function \(\) \{ return false; \}\)/);
});

test('navegação completa espera o checkpoint crítico antes de descarregar a página', async () => {
  const originalUrl = 'https://www.tecconcursos.com.br/questoes/pastas/1';
  const destinationUrl = 'https://www.tecconcursos.com.br/questoes/cadernos/2';
  let releaseCheckpoint;
  const context = {
    window: {},
    document: {},
    location: { pathname: '/questoes/pastas/1', search: '', href: originalUrl },
    estado: { fase: 'coletando', status: 'rodando' },
    log() {},
    salvarEstado() {
      return new Promise((resolveSave) => { releaseCheckpoint = resolveSave; });
    },
    workerTick(interval, condition, timeout, callback) { callback(); },
    console,
  };

  vm.runInNewContext(`${paginasSource}\nwindow.__navigationTest = { irPara };`, context, { filename: '07-paginas.js' });
  const navigation = context.window.__navigationTest.irPara(destinationUrl);

  assert.equal(context.location.href, originalUrl, 'a rota não pode mudar antes de o IndexedDB confirmar o checkpoint');
  releaseCheckpoint();
  await navigation;
  assert.equal(context.location.href, destinationUrl);
});

test('pausa durante o checkpoint cancela a navegação pendente', async () => {
  const originalUrl = 'https://www.tecconcursos.com.br/questoes/pastas/1';
  const destinationUrl = 'https://www.tecconcursos.com.br/questoes/cadernos/2';
  let releaseCheckpoint;
  const context = {
    window: {},
    document: {},
    location: { pathname: '/questoes/pastas/1', search: '', href: originalUrl },
    estado: { fase: 'coletando', status: 'rodando' },
    log() {},
    salvarEstado() {
      return new Promise((resolveSave) => { releaseCheckpoint = resolveSave; });
    },
    workerTick(interval, condition, timeout, callback) { callback(); },
    console,
  };

  vm.runInNewContext(`${paginasSource}\nwindow.__navigationTest = { irPara };`, context, { filename: '07-paginas.js' });
  const navigation = context.window.__navigationTest.irPara(destinationUrl);
  context.estado.status = 'pausado';
  releaseCheckpoint();

  assert.equal(await navigation, false);
  assert.equal(context.location.href, originalUrl);
});

test('falha no checkpoint crítico impede navegação e deixa a execução em erro', () => {
  assert.match(persistenceSource, /if \(checkpointCritico === true\) \{[\s\S]*?reject\(e\);/);
  assert.match(paginasSource, /Falha ao persistir o estado antes da navegação/);
  assert.match(paginasSource, /estado\.status = 'erro'/);
});

test('caderno da rota só recupera o item atual quando corresponde à matéria do plano', () => {
  assert.match(
    orchestratorSource,
    /var cadernoDaRota = idCadernoRota \? estado\.biblioteca\[idCadernoRota\] : null;[\s\S]*?normalizarTituloCaderno\(cadernoDaRota\.titulo\) === normalizarTituloCaderno\(materia\.title\)/,
  );
});
