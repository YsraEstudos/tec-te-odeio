import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const orchestratorSource = readFileSync(resolve(root, 'src/fabrica/15-orquestrador.js'), 'utf8');
const initializationSource = readFileSync(resolve(root, 'src/fabrica/19-inicializacao.js'), 'utf8');
const uiSource = readFileSync(resolve(root, 'src/fabrica/18-ui.js'), 'utf8');

test('transição pasta-caderno salva fase e caderno com checkpoint crítico', () => {
  assert.match(orchestratorSource, /estado\.fase = 'coletando';[\s\S]*?estado\.cadernoAtual = estado\.biblioteca\[idCaderno\];[\s\S]*?salvarEstado\(true\);/);
});

test('auto-retomada pendente pode ser cancelada e não executa após pausa', () => {
  assert.match(initializationSource, /var autoResumeTimer = null/);
  assert.match(initializationSource, /clearTimeout\(autoResumeTimer\)/);
  assert.match(initializationSource, /if \(estado\.status !== 'rodando'\) \{[\s\S]*?return;/);
  assert.match(orchestratorSource, /cancelarAutoResumir\(/);
});

test('controle rápido de pausa fica no cabeçalho, fora da aba que é recarregada', () => {
  assert.match(uiSource, /id="tf-quick-toggle"/);
  assert.match(uiSource, /tf-quick-toggle/);
  assert.match(uiSource, /estado\.status === 'rodando' \? parar\(\) : continuar\(\)/);
});

test('repetição da mesma transição é bloqueada com erro controlado', () => {
  assert.match(orchestratorSource, /function registrarTransicaoPastaCaderno\(idCaderno\)/);
  assert.match(orchestratorSource, /tentativas >= 3/);
  assert.match(orchestratorSource, /Loop de navegação detectado/);
});

test('caderno da rota tem prioridade para recuperar estado após reload', () => {
  assert.match(orchestratorSource, /var idCadernoRota = paginaAtual\(\) === 'caderno' \? cadernoIdDaUrl\(\) : ''/);
  assert.match(orchestratorSource, /estado\.biblioteca\[idCadernoRota\]/);
});
