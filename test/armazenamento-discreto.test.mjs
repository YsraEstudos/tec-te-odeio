import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const persistencia = readFileSync(resolve(root, 'src/fabrica/06-persistencia.js'), 'utf8');

test('banco IndexedDB tem nome por instalação (nada de chave global óbvia)', () => {
  assert.match(persistencia, /function obterIdInstalacao\(\)/);
  assert.match(persistencia, /tec_prefs/);
  assert.match(persistencia, /prefs\.v === 1/);
  assert.match(persistencia, /\^\[A-Za-z0-9\]\{16\}\$/);
  assert.match(persistencia, /IDB_DB = 'tec_fabrica_db' \+ \(idInstalacao \? '_' \+ idInstalacao : ''\)/);
});

test('semente de instalação é gerada uma única vez e reutilizada', () => {
  assert.match(persistencia, /window\.localStorage\.setItem\('tec_prefs', JSON\.stringify\(\{ v: 1, i: novo \}\)/);
  assert.match(persistencia, /JSON\.parse\(bruto\)/);
  assert.match(persistencia, /window\.crypto\.getRandomValues\(aleatorios\)/);
});

test('sem localStorage (testes/mocks) o sufixo não é aplicado', () => {
  assert.match(persistencia, /!window\.localStorage\) return '';/);
  assert.match(persistencia, /catch \(e\) \{\s*return '';\s*\}/);
});

test('migração do banco antigo é fail-safe e só apaga após cópia confirmada', () => {
  assert.match(persistencia, /function migrarBancoAntigo\(\)/);
  assert.match(persistencia, /factory\.databases\(\)/);
  assert.match(persistencia, /evento\.oldVersion === 0/);
  assert.match(persistencia, /req\.transaction\.abort\(\)/);
  assert.match(persistencia, /deleteDatabase\('tec_fabrica_db'\)/);
  assert.match(persistencia, /req\.onblocked = function \(\) \{ resolve\(false\); \}/);
  assert.match(persistencia, /IDB_LEGACY_STORE\)/);
  assert.match(persistencia, /parseLegadoV1\(rec\.json\)/);
  assert.match(persistencia, /txNovo\.onerror = function \(\) \{ reject/);
  assert.doesNotMatch(persistencia, /txNovo\.onerror = function \(\) \{ resolve/);
  assert.doesNotMatch(persistencia, /salvarSnapshot\(legado\)\.then\([^)]*\)\.catch\([^)]*continuar/);
});

test('banco novo válido vence e migração só roda se ele estiver vazio', () => {
  assert.match(persistencia, /if \(!idInstalacao\) return carregarV2\(\)\.then/);
  assert.match(persistencia, /return carregarV2\(\)\.then\(function \(v2Existente\) \{/);
  assert.match(persistencia, /if \(v2Existente\) return v2Existente;/);
  assert.match(persistencia, /return migrarBancoAntigo\(\)\.then\(function \(\) \{/);
});

test('escrita continua indo para o banco com sufixo (mesmo IDB_DB do runtime)', () => {
  const usos = persistencia.match(/abrirIdb\(\)/g);
  assert.ok(usos && usos.length >= 1, 'abrirIdb continua sendo a única porta de acesso');
});

function contextoPersistencia(indexedDB) {
  const armazenamento = new Map();
  const window = {
    indexedDB,
    localStorage: {
      getItem(chave) { return armazenamento.get(chave) || null; },
      setItem(chave, valor) { armazenamento.set(chave, valor); }
    },
    crypto: { getRandomValues(array) { array.fill(7); return array; } }
  };
  const contexto = {
    window,
    CONFIG: { storageKey: 'tec_fabrica_estado_v1' },
    setTimeout, clearTimeout, Promise, Map, Set, Uint32Array,
    Number, Object, Array, String, JSON, Date, Math
  };
  vm.runInNewContext(persistencia, contexto);
  return contexto;
}

test('banco antigo ausente não é criado nem apagado durante a migração', async () => {
  let aberturas = 0;
  let exclusoes = 0;
  const contexto = contextoPersistencia({
    databases: async () => [],
    open() { aberturas += 1; throw new Error('não deveria abrir'); },
    deleteDatabase() { exclusoes += 1; return {}; }
  });
  assert.equal(await contexto.migrarBancoAntigo(), false);
  assert.equal(aberturas, 0);
  assert.equal(exclusoes, 0);
});

test('falha de escrita preserva o banco antigo', async () => {
  let exclusoes = 0;
  let fechamentos = 0;
  const contexto = contextoPersistencia({ databases: async () => [] });
  const nomes = ['meta'];
  nomes.contains = (nome) => nomes.includes(nome);
  contexto.abrirBancoAntigoSeExistir = async () => ({
    objectStoreNames: nomes,
    close() { fechamentos += 1; }
  });
  contexto.lerStoresDoBanco = async () => [[{ key: 'state', schema: 2 }]];
  contexto.lerLegadoDoBanco = async () => null;
  contexto.copiarStoresParaBancoNovo = async () => { throw new Error('disco cheio'); };
  contexto.apagarBancoAntigo = async () => { exclusoes += 1; return true; };

  assert.equal(await contexto.migrarBancoAntigo(), false);
  assert.equal(exclusoes, 0, 'falha de cópia não pode apagar a origem');
  assert.equal(fechamentos, 1, 'conexão antiga deve ser fechada após a falha');
});
