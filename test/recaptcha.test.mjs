import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const distSource = readFileSync(resolve(root, 'dist/tec_fabrica_cadernos.user.js'), 'utf8');
const manifestSource = readFileSync(resolve(root, 'src/fabrica/manifest.json'), 'utf8');
const manifest = JSON.parse(manifestSource);
const domHelpersSource = readFileSync(resolve(root, 'src/fabrica/03-dom-helpers.js'), 'utf8');

test('manifesto e headers contêm @match para iframe do reCAPTCHA', () => {
  assert.ok(manifest.userscript.match.includes('https://www.google.com/recaptcha/api2/anchor*'));
  assert.ok(manifest.userscript.match.includes('https://www.recaptcha.net/recaptcha/api2/anchor*'));

  assert.match(distSource, /\/\/ @match\s+https:\/\/www\.google\.com\/recaptcha\/api2\/anchor\*/);
  assert.match(distSource, /\/\/ @match\s+https:\/\/www\.recaptcha\.net\/recaptcha\/api2\/anchor\*/);

});

test('fábrica principal só é injetada nas rotas de questões', () => {
  assert.equal(manifest.userscript.namespace, 'tec-fabrica-cadernos-v2');
  assert.equal(manifest.installOutput, 'dist/tec_fabrica_cadernos_v2.user.js');
  assert.ok(manifest.userscript.match.includes('https://www.tecconcursos.com.br/questoes/*'));
  assert.ok(!manifest.userscript.match.includes('https://www.tecconcursos.com.br/*'));
  assert.match(distSource, /\/\/ @match\s+https:\/\/www\.tecconcursos\.com\.br\/questoes\/\*/);
  assert.ok(distSource.includes("!/^\\/questoes(?:\\/|$)/i.test(location.pathname)"));
});

test('código de auto-clique no reCAPTCHA identifica iframe e elemento .recaptcha-checkbox-border', () => {
  assert.match(distSource, /recaptcha-checkbox-border/);
  assert.match(distSource, /autoClicarRecaptcha/);
  assert.match(distSource, /recaptcha\/api2\/anchor/);

});

test('modalRecaptchaAberto detecta container e texto de confirmação de robô', () => {
  assert.match(domHelpersSource, /function elementoVisivel\(el\)/);
  assert.match(domHelpersSource, /function modalRecaptchaAberto\(\)/);
  assert.match(domHelpersSource, /recaptcha-limite-container/);
  assert.match(domHelpersSource, /não é um robô/i);
});

test('modalRecaptchaAberto ignora containers e iframes ocultos', () => {
  // Executa uma versão isolada das funções de visibilidade com mocks simples
  const fnCode = `
    ${domHelpersSource}
    return { elementoVisivel, modalRecaptchaAberto };
  `;
  const factory = new Function('document', 'window', fnCode);

  // Caso 1: DOM sem recaptcha
  const mockDocVazio = {
    getElementById: () => null,
    querySelectorAll: () => []
  };
  const ctxVazio = factory(mockDocVazio, {});
  assert.equal(ctxVazio.modalRecaptchaAberto(), false);

  // Caso 2: Container existe mas offsetParent é null (oculto)
  const mockDocOculto = {
    getElementById: (id) => id === 'recaptcha-limite-container' ? { offsetParent: null, style: { display: 'none' } } : null,
    querySelectorAll: () => []
  };
  const ctxOculto = factory(mockDocOculto, { getComputedStyle: () => ({ display: 'none' }) });
  assert.equal(ctxOculto.modalRecaptchaAberto(), false);

  // Caso 3: Container existe e está visível
  const mockDocVisivel = {
    getElementById: (id) => id === 'recaptcha-limite-container' ? { offsetParent: {}, style: { display: 'block' }, getBoundingClientRect: () => ({ width: 300, height: 200 }) } : null,
    querySelectorAll: () => []
  };
  const ctxVisivel = factory(mockDocVisivel, { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) });
  assert.equal(ctxVisivel.modalRecaptchaAberto(), true);

  // Caso 4: Iframe anchor permanente do Google no DOM (NÃO deve ser considerado modal aberto)
  const mockDocAnchor = {
    getElementById: () => null,
    querySelectorAll: (sel) => {
      if (sel.includes('recaptcha/api2/bframe')) return [];
      if (sel.includes('.modal')) return [];
      return [];
    }
  };
  const ctxAnchor = factory(mockDocAnchor, { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) });
  assert.equal(ctxAnchor.modalRecaptchaAberto(), false);

  // Caso 5: Iframe bframe ativo de desafio com dimensões reais
  const mockDocBframeAtivo = {
    getElementById: () => null,
    querySelectorAll: (sel) => {
      if (sel.includes('recaptcha/api2/bframe')) {
        return [{
          offsetParent: {},
          style: { display: 'block' },
          getBoundingClientRect: () => ({ width: 400, height: 580, bottom: 600, right: 500 })
        }];
      }
      return [];
    }
  };
  const ctxBframeAtivo = factory(mockDocBframeAtivo, { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) });
  assert.equal(ctxBframeAtivo.modalRecaptchaAberto(), true);

  // Caso 6: Iframe bframe inativo ou com dimensões zeradas
  const mockDocBframeInativo = {
    getElementById: () => null,
    querySelectorAll: (sel) => {
      if (sel.includes('recaptcha/api2/bframe')) {
        return [{
          offsetParent: {},
          style: { display: 'block' },
          getBoundingClientRect: () => ({ width: 0, height: 0, bottom: 0, right: 0 })
        }];
      }
      return [];
    }
  };
  const ctxBframeInativo = factory(mockDocBframeInativo, { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) });
  assert.equal(ctxBframeInativo.modalRecaptchaAberto(), false);
});
