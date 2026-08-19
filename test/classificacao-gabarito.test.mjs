import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const interceptor = readFileSync(resolve(root, 'src/fabrica/09-interceptor.js'), 'utf8');

test('consultarGabaritoQuestao classifica os três estados possíveis', () => {
  assert.match(interceptor, /consultarGabaritoQuestao: function \(questaoId, artigo\)/);
  assert.match(interceptor, /estado: 'com-gabarito'/);
  assert.match(interceptor, /estado: 'sem-gabarito'/);
  assert.match(interceptor, /estado: 'desconhecido'/);
  const primeiroCache = interceptor.indexOf('this.cache[chave]');
  const primeiroSem = interceptor.indexOf('this.cacheSemGabarito[chave]');
  assert.ok(primeiroCache > 0 && primeiroSem > 0, 'caches não encontrados');
  assert.ok(primeiroCache < primeiroSem, 'cache com gabarito tem prioridade sobre sem-gabarito');
});

test('sem-gabarito registrado no payload e rastreado por index', () => {
  assert.match(interceptor, /cacheSemGabarito: \{\}/);
  assert.match(interceptor, /semGabaritoPorIndex: \{\}/);
  assert.match(interceptor, /this\.cacheSemGabarito\[chave\] = true;/);
  assert.match(interceptor, /this\.semGabaritoPorIndex\[porIndex\] = true;/);
  assert.match(interceptor, /delete this\.cacheSemGabarito\[chave\]/);
  assert.match(interceptor, /payloadsVistos \+= 1/);
});

test('payload com gabarito sobrepõe sem-gabarito e vice-versa', () => {
  assert.match(interceptor, /delete this\.cacheSemGabarito\[chave\]/);
  assert.match(interceptor, /delete this\.semGabaritoPorIndex\[porIndex\]/);
});

test('leitor passivo do scope Angular fornece gabarito sem tocar em nativos', () => {
  assert.match(interceptor, /lerGabaritoDoScope: function \(artigo\)/);
  assert.match(interceptor, /angular\.element\(artigo\)/);
  assert.match(interceptor, /scope\.\$parent/);
  assert.match(interceptor, /profundidade < 8/);
  assert.match(interceptor, /acharObjetoQuestaoNoScope/);
});

test('objeto da questão é localizado por nomes conhecidos ou varredura', () => {
  assert.match(interceptor, /nomesConhecidos = \['questao', 'q', 'item', 'questaoAtual'\]/);
  assert.match(interceptor, /Object\.keys\(scope\)/);
  assert.match(interceptor, /scope\.vm\.questao/);
  assert.match(interceptor, /scope\.ctrl\.questao/);
});

test('obterSemGabaritoPorQuestaoId/Index expõem a classificação', () => {
  assert.match(interceptor, /obterSemGabaritoPorQuestaoId: function \(id\)/);
  assert.match(interceptor, /obterSemGabaritoPorIndex: function \(cadernoId, index\)/);
});

function criarInterceptor(angular) {
  const contexto = { log() {}, WeakMap, Object, String, Number };
  if (angular) contexto.angular = angular;
  vm.runInNewContext(interceptor, contexto);
  return contexto.GabaritoInterceptor;
}

test('objeto parcial não é classificado como sem-gabarito', () => {
  const g = criarInterceptor();
  g.processarRespostaJson('/api/cadernos/1/questoes/1', { questao: { idQuestao: 101 } });
  assert.equal(g.consultarGabaritoQuestao(101).estado, 'desconhecido');
});

test('campo preenchido com valor inválido permanece desconhecido', () => {
  const g = criarInterceptor();
  g.processarRespostaJson('/api/cadernos/1/questoes/1', {
    questao: { idQuestao: 105, numeroAlternativaCorreta: 'indisponível' }
  });
  assert.equal(g.consultarGabaritoQuestao(105).estado, 'desconhecido');
});

test('campo explícito vazio ou preenchido define a classificação', () => {
  const g = criarInterceptor();
  g.processarRespostaJson('/api/cadernos/1/questoes/1', {
    questao: { idQuestao: 102, numeroAlternativaCorreta: null }
  });
  assert.equal(g.consultarGabaritoQuestao(102).estado, 'sem-gabarito');

  g.processarRespostaJson('/api/cadernos/1/questoes/2', {
    questao: { idQuestao: 103, numeroAlternativaCorreta: 2 }
  });
  assert.deepEqual({ ...g.consultarGabaritoQuestao(103) }, { estado: 'com-gabarito', letra: 'B' });
});

test('scope parcial é ignorado e a busca continua no pai completo', () => {
  const pai = { questao: { idQuestao: 104, numeroAlternativaCorreta: null }, $parent: null };
  const filho = { questao: { idQuestao: 104 }, $parent: pai };
  const g = criarInterceptor({ element: () => ({ scope: () => filho }) });
  assert.equal(g.consultarGabaritoQuestao(104, {}).estado, 'sem-gabarito');
});
