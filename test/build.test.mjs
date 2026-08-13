import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist/tec_fabrica_cadernos.user.js');

test('build gera artefato válido e APIs globais', () => {
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(dist));
  const source = readFileSync(dist, 'utf8');
  assert.match(source, /^\/\/ @version\s+2\.0\.0$/m);
  assert.match(source, /var SCRIPT_VERSION = '2\.0\.0';/);
  for (const api of ['__TecFabrica', '__TecFabricaExport', '__TecFabricaUI']) {
    assert.match(source, new RegExp(`window\\.${api}\\s*=`));
  }
  const check = spawnSync(process.execPath, ['--check', dist], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

test('manifesto contém ordem explícita e nenhum fragmento vazio', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'src/fabrica/manifest.json'), 'utf8'));
  assert.ok(manifest.fragments.length >= 2);
  for (const fragment of manifest.fragments) {
    const content = readFileSync(resolve(root, 'src/fabrica', fragment.file), 'utf8');
    assert.ok(content.trim(), fragment.file);
  }
});
