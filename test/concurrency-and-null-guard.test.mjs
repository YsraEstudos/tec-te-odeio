import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const coletaSource = readFileSync(resolve(root, 'src/fabrica/14-coleta.js'), 'utf8');
const resolucaoSource = readFileSync(resolve(root, 'src/fabrica/10-resolucao.js'), 'utf8');
const orquestradorSource = readFileSync(resolve(root, 'src/fabrica/15-orquestrador.js'), 'utf8');
const estadoSource = readFileSync(resolve(root, 'src/fabrica/05-estado.js'), 'utf8');

test('controle de concorrência: cicloExecucaoId é incrementado em iniciar, parar, continuar e coletarCaderno', () => {
  assert.match(estadoSource, /var cicloExecucaoId = 0;/);
  assert.match(coletaSource, /cicloExecucaoId \+= 1;\s*var meuCiclo = cicloExecucaoId;/);
  assert.match(coletaSource, /if \(meuCiclo !== cicloExecucaoId \|\| estado\.status !== 'rodando'\) return;/);
  assert.match(orquestradorSource, /function iniciar\(\) \{[\s\S]*?cicloExecucaoId \+= 1;/);
  assert.match(orquestradorSource, /function parar\(\) \{[\s\S]*?cicloExecucaoId \+= 1;/);
  assert.match(orquestradorSource, /function continuar\(\) \{[\s\S]*?cicloExecucaoId \+= 1;/);
});

test('guarda contra gabarito nulo: coleta pausa imediatamente sem salvar resposta vazia', () => {
  assert.match(coletaSource, /if \(!gabarito\) \{/);
  assert.match(coletaSource, /parar\(\);/);
  assert.match(coletaSource, /UI\.setStatus\('Pausado na questão/);
  assert.match(coletaSource, /questao\.answer = gabarito;/);
});

test('prioridade do DOM na resolução: checa texto de resolução antes do modalRecaptchaAberto', () => {
  const indexRes = resolucaoSource.indexOf('// 1. Prioridade absoluta: checar se a resolução já apareceu na tela');
  const indexCaptcha = resolucaoSource.indexOf('// 2. Checagem de reCAPTCHA real');
  assert.ok(indexRes > 0, 'Comentário de prioridade do DOM não encontrado');
  assert.ok(indexCaptcha > 0, 'Comentário de checagem de reCAPTCHA não encontrado');
  assert.ok(indexRes < indexCaptcha, 'A verificação da resolução no DOM deve ocorrer antes da checagem do reCAPTCHA');
});
