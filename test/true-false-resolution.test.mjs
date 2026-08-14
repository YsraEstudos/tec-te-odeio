import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const resolutionSource = readFileSync(resolve(root, 'src/fabrica/10-resolucao.js'), 'utf8');

function loadResolutionApi(overrides = {}) {
  const context = {
    window: {},
    CONFIG: { pollInterval: 1, loadTimeout: 1 },
    estado: { status: 'rodando', config: { usarCliqueGabarito: true } },
    GabaritoInterceptor: {
      ultimoMetodo: null,
      estatisticas: { viaCache: 0, viaResolucaoVisivel: 0, viaClique: 0, semGabarito: 0 },
      obterPorQuestaoId: () => null
    },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    log() {},
    ...overrides
  };
  vm.runInNewContext(`${resolutionSource}
window.__resolutionApi = { lerGabaritoDoTexto, mapearGabaritoParaOpcoes, resolverParaGabarito };`, context, { filename: '10-resolucao.js' });
  return { api: context.window.__resolutionApi, context };
}

test('interpreta resolução visível de questões Certo/Errado', () => {
  const { api } = loadResolutionApi();

  assert.equal(api.lerGabaritoDoTexto('Parabéns, você selecionou: Certo, alternativa correta.'), 'C');
  assert.equal(api.lerGabaritoDoTexto('Você selecionou: Errado, alternativa correta.'), 'E');
});

test('converte gabarito posicional A/B para as letras reais C/E', () => {
  const { api } = loadResolutionApi();
  const opcoes = [
    { letter: 'C', text: 'Certo' },
    { letter: 'E', text: 'Errado' }
  ];

  assert.equal(api.mapearGabaritoParaOpcoes('A', opcoes), 'C');
  assert.equal(api.mapearGabaritoParaOpcoes('B', opcoes), 'E');
  assert.equal(api.mapearGabaritoParaOpcoes('Errado', opcoes), 'E');
});

test('resolução Certo visível é capturada sem novo clique', async () => {
  let clicks = 0;
  const { api } = loadResolutionApi({
    document: {
      querySelector(selector) {
        if (selector.includes('questao-enunciado-resolucao-errou')) {
          return { innerText: 'Parabéns, você selecionou: Certo, alternativa correta.' };
        }
        if (selector === 'article.questao-enunciado') {
          return { querySelectorAll: () => [] };
        }
        return null;
      },
      querySelectorAll: () => [{ innerText: 'RESOLVER QUESTÃO', disabled: false, click() { clicks += 1; } }]
    }
  });

  const result = await api.resolverParaGabarito({ id: 'q-tf', number: 1, options: [{ letter: 'C', text: 'Certo' }, { letter: 'E', text: 'Errado' }] });

  assert.equal(result, 'C');
  assert.equal(clicks, 0);
});
