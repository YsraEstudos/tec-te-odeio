import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const distSource = readFileSync(resolve(root, 'dist/tec_fabrica_cadernos.user.js'), 'utf8');
const coletorSource = readFileSync(resolve(root, 'tec_coletor.user.js'), 'utf8');
const manifestSource = readFileSync(resolve(root, 'src/fabrica/manifest.json'), 'utf8');
const domHelpersSource = readFileSync(resolve(root, 'src/fabrica/03-dom-helpers.js'), 'utf8');

test('manifesto e headers contêm @match para iframe do reCAPTCHA', () => {
  const manifest = JSON.parse(manifestSource);
  assert.ok(manifest.userscript.match.includes('https://www.google.com/recaptcha/api2/anchor*'));
  assert.ok(manifest.userscript.match.includes('https://www.recaptcha.net/recaptcha/api2/anchor*'));

  assert.match(distSource, /\/\/ @match\s+https:\/\/www\.google\.com\/recaptcha\/api2\/anchor\*/);
  assert.match(distSource, /\/\/ @match\s+https:\/\/www\.recaptcha\.net\/recaptcha\/api2\/anchor\*/);

  assert.match(coletorSource, /\/\/ @match\s+https:\/\/www\.google\.com\/recaptcha\/api2\/anchor\*/);
  assert.match(coletorSource, /\/\/ @match\s+https:\/\/www\.recaptcha\.net\/recaptcha\/api2\/anchor\*/);
});

test('código de auto-clique no reCAPTCHA identifica iframe e elemento .recaptcha-checkbox-border', () => {
  assert.match(distSource, /recaptcha-checkbox-border/);
  assert.match(distSource, /autoClicarRecaptcha/);
  assert.match(distSource, /recaptcha\/api2\/anchor/);

  assert.match(coletorSource, /recaptcha-checkbox-border/);
  assert.match(coletorSource, /autoClicarRecaptcha/);
  assert.match(coletorSource, /recaptcha\/api2\/anchor/);
});

test('modalRecaptchaAberto detecta container e texto de confirmação de robô', () => {
  assert.match(domHelpersSource, /function modalRecaptchaAberto\(\)/);
  assert.match(domHelpersSource, /recaptcha-limite-container/);
  assert.match(domHelpersSource, /não é um robô/i);
});
