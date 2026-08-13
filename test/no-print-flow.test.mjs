import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('manifesto não inclui fragmento nem configuração de impressão', () => {
  const manifest = JSON.parse(read('src/fabrica/manifest.json'));
  assert.equal(existsSync(resolve(root, 'src/fabrica/13-impressao.js')), false);
  assert.equal(manifest.fragments.some((fragment) => /impress/i.test(fragment.file + fragment.section)), false);
  assert.doesNotMatch(read('src/fabrica/01-config.js'), /usarImpressao|impressaoLimiteDia/);
  assert.doesNotMatch(read('src/fabrica/18-ui.js'), /tf-usar-impressao|tf-impressao-limite|tf-impressao-usadas/);
});

test('orquestrador encaminha caderno incompleto diretamente para coleta', () => {
  const source = read('src/fabrica/15-orquestrador.js');
  assert.doesNotMatch(source, /impr-(?:caderno|saida)|submeterParteImpressao|processarSaidaImpressao|saldoImpressao/);
  assert.match(source, /await coletarCaderno\(existente\)/);
});

test('exportação não depende de parsers da página de impressão', () => {
  const source = read('src/fabrica/17-exportacao.js');
  assert.doesNotMatch(source, /extrairQuestoesImpressas|parseGabaritoBloco/);
  assert.match(source, /baixarHtmlCaderno/);
  assert.match(source, /baixarExcelCaderno/);
  assert.match(source, /baixarJsonCaderno/);
});

test('navegação e inicialização não têm rota de saída PDF/print', () => {
  assert.doesNotMatch(read('src/fabrica/07-paginas.js'), /\/imprimir|paginaAtual\(\).*impressao/);
  assert.doesNotMatch(read('src/fabrica/19-inicializacao.js'), /bloquearPrintAutomatico|impressao/);
});
