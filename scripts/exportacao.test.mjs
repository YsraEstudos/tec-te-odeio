// =============================================================================
// Testes dos helpers puros de src/fabrica/17-exportacao.js
// -----------------------------------------------------------------------------
// Carrega APENAS o fragmento 17-exportacao.js em um contexto vm (sem DOM),
// como test/persistence.test.mjs faz com 06-persistencia.js, e valida:
//   1. node --check aceita o fragmento;
//   2. zipStore: sem Array.from(...).flat(), ZIP válido (assinaturas, crc32,
//      nomes, conteúdos) e byte-a-byte idêntico ao algoritmo antigo;
//   3. cache por URL de imagens (dedupe, inclusive falhas) e clearImageCache;
//   4. concorrência limitada (3) no carregamento de imagens;
//   5. ordem de mediaIndex preservada; helpers de imagem/HTML/colunas.
// Rode com: node scripts/exportacao.test.mjs   (ou node --test)
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fragmentPath = resolve(root, 'src/fabrica/17-exportacao.js');
const source = readFileSync(fragmentPath, 'utf8');

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);

// --- carga do fragmento em vm (mesma convenção de test/persistence.test.mjs) -
function loadExport({ fetch } = {}) {
  const window = {};
  const sandbox = {
    window,
    Map, Set, Promise, Date, JSON, Object, Array, Uint8Array, TextEncoder,
    // atob estrito como o do navegador (Buffer.from é leniente demais)
    atob: (b64) => {
      const cleaned = String(b64).replace(/\s/g, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) {
        throw new Error('invalid base64');
      }
      return Buffer.from(cleaned, 'base64').toString('latin1');
    },
    setTimeout, clearTimeout, console,
    // Definições de outros fragmentos referenciadas na montagem do objeto de
    // exportação (no bundle real vêm de 03-dom-helpers.js;
    // aqui só precisam existir como valor — nunca são chamadas pelos puros).
    clean: (v) => String(v == null ? '' : v).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
  };
  if (fetch) sandbox.fetch = fetch;
  vm.runInNewContext(source, sandbox, { filename: '17-exportacao.js' });
  return window.__TecFabricaExport;
}

// --- leitor ZIP mínimo para validar o arquivo produzido ----------------------
function readU16(bytes, off) { return bytes[off] | (bytes[off + 1] << 8); }
function readU32(bytes, off) { return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0; }

function parseZip(zip) {
  const eocd = zip.length - 22;
  assert.equal(readU32(zip, eocd), 0x06054b50, 'assinatura EOCD no fim do arquivo');
  const count = readU16(zip, eocd + 10);
  const dirSize = readU32(zip, eocd + 12);
  const dirOffset = readU32(zip, eocd + 16);
  assert.equal(dirSize + dirOffset + 22, zip.length, 'diretório central termina exatamente no EOCD');
  const entries = [];
  let pos = dirOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(readU32(zip, pos), 0x02014b50, 'assinatura do diretório central #' + i);
    const crc = readU32(zip, pos + 16);
    const csize = readU32(zip, pos + 20);
    const nameLen = readU16(zip, pos + 28);
    const extraLen = readU16(zip, pos + 30);
    const commentLen = readU16(zip, pos + 32);
    const localOffset = readU32(zip, pos + 42);
    const name = Buffer.from(zip.buffer, zip.byteOffset + pos + 46, nameLen).toString('utf8');
    assert.equal(readU32(zip, localOffset), 0x04034b50, 'assinatura do cabeçalho local: ' + name);
    const localNameLen = readU16(zip, localOffset + 26);
    const localExtraLen = readU16(zip, localOffset + 28);
    assert.equal(localNameLen, nameLen, 'nome do cabeçalho local bate: ' + name);
    assert.equal(readU32(zip, localOffset + 18), csize, 'tamanho comprimido local = central: ' + name);
    assert.equal(readU32(zip, localOffset + 14), crc, 'crc32 local = central: ' + name);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    entries.push({ name, content: zip.slice(start, start + csize), crc });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(pos, eocd, 'fim do diretório central coincide com o EOCD');
  return entries;
}

function crc32Bytes(bytes) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i;
    for (let b = 0; b < 8; b++) v = (v & 1) ? (0xedb88320 ^ (v >>> 1)) : (v >>> 1);
    table[i] = v >>> 0;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

// réplica exata do algoritmo antigo (Array.from(...).flat()) para provar que a
// reescrita preserva o formato byte a byte
function legacyZipStore(files) {
  const encoder = new TextEncoder();
  const u16 = (v) => [v & 255, (v >>> 8) & 255];
  const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const chunks = [], directory = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const content = typeof file.content === 'string' ? encoder.encode(file.content) : new Uint8Array(file.content);
    const crc = crc32Bytes(content);
    const local = [0x50, 0x4b, 0x03, 0x04].concat(u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(content.length), u32(content.length), u16(name.length), u16(0), Array.from(name), Array.from(content));
    chunks.push(local);
    directory.push([0x50, 0x4b, 0x01, 0x02].concat(u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(content.length), u32(content.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), Array.from(name)));
    offset += local.length;
  }
  const directorySize = directory.reduce((t, e) => t + e.length, 0);
  const output = chunks.concat(directory);
  output.push([0x50, 0x4b, 0x05, 0x06].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(directorySize), u32(offset), u16(0)));
  return new Uint8Array(output.flat());
}

const SAMPLE_FILES = [
  { name: 'ola.txt', content: 'Olá, mundo! 😀\n' },
  { name: 'pasta/arquivo.json', content: JSON.stringify({ a: 1, b: [1, 2, 3] }) },
  { name: 'bin.dat', content: new Uint8Array([0, 1, 2, 3, 255, 254, 0x89, 0x50, 0x4e, 0x47]) },
];

// --- 1. sintaxe --------------------------------------------------------------
test('node --check aceita o fragmento 17-exportacao.js', () => {
  const check = spawnSync(process.execPath, ['--check', fragmentPath], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

// --- 2. zipStore -------------------------------------------------------------
test('zipStore: sem Array.from(...).flat() e byte-a-byte igual ao antigo', () => {
  const exp = loadExport();
  const zip = exp.zipStore(SAMPLE_FILES);
  const legacy = legacyZipStore(SAMPLE_FILES);
  assert.ok(Buffer.from(zip).equals(Buffer.from(legacy)), 'bytes idênticos ao algoritmo anterior');
  const zipFn = source.slice(source.indexOf('function zipStore'), source.indexOf('function imageSourcesFromHtml'))
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(zipFn, /\.flat\(\)/, 'zipStore não usa .flat()');
  assert.match(zipFn, /new Uint8Array\(localSize \+ directorySize \+ 22\)/, 'aloca um único buffer tipado');
});

test('zipStore: ZIP válido (assinaturas, crc32, nomes, conteúdos)', () => {
  const exp = loadExport();
  const entries = parseZip(exp.zipStore(SAMPLE_FILES));
  assert.deepEqual(entries.map((e) => e.name), SAMPLE_FILES.map((f) => f.name));
  for (const entry of entries) {
    assert.equal(entry.crc, crc32Bytes(entry.content), 'crc32 confere: ' + entry.name);
  }
  assert.equal(Buffer.from(entries[0].content).toString('utf8'), 'Olá, mundo! 😀\n');
  assert.deepEqual(JSON.parse(Buffer.from(entries[1].content).toString('utf8')), { a: 1, b: [1, 2, 3] });
  assert.deepEqual(Array.from(entries[2].content), [0, 1, 2, 3, 255, 254, 0x89, 0x50, 0x4e, 0x47]);
});

test('crc32 exposto confere com referência independente', () => {
  const exp = loadExport();
  const bytes = new TextEncoder().encode('teste crc32 do fragmento');
  assert.equal(exp.crc32(bytes), crc32Bytes(bytes));
});

// --- 3. cache por URL --------------------------------------------------------
test('readImageAsset: cache por URL — mesma URL não é rebuscada', async () => {
  let calls = 0;
  const fetch = async (url) => {
    calls++;
    if (url.includes('broken')) return { ok: false, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => JPEG_BYTES.buffer };
  };
  const exp = loadExport({ fetch });
  const a1 = await exp.readImageAsset('https://img.example/x.jpg');
  const a2 = await exp.readImageAsset('https://img.example/x.jpg');
  assert.equal(calls, 1, 'segunda leitura vem do cache');
  assert.equal(a1, a2, 'mesma referência de asset (promessa cacheadas)');
  assert.equal(a1.extension, 'jpg');
  await exp.loadImageAssets([['https://img.example/x.jpg', 'https://img.example/x.jpg']]);
  assert.equal(calls, 1, 'loadImageAssets reaproveita o cache');
  const broken = await exp.readImageAsset('https://img.example/broken.png');
  assert.equal(broken, null);
  const broken2 = await exp.readImageAsset('https://img.example/broken.png');
  assert.equal(broken2, null);
  assert.equal(calls, 2, 'falha também fica em cache (sem refetch)');
});

test('clearImageCache zera o cache por URL', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG_BYTES.buffer }; };
  const exp = loadExport({ fetch });
  await exp.readImageAsset('https://img.example/c.png');
  await exp.readImageAsset('https://img.example/c.png');
  assert.equal(calls, 1);
  exp.clearImageCache();
  await exp.readImageAsset('https://img.example/c.png');
  assert.equal(calls, 2);
});

test('data URI é decodificada sem fetch', async () => {
  const exp = loadExport(); // sem fetch no sandbox: só o caminho data:/base64
  const asset = await exp.readImageAsset('data:image/png;base64,iVBORw0KGgo=');
  assert.ok(asset);
  assert.equal(asset.extension, 'png');
  assert.deepEqual(Array.from(asset.bytes.slice(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

// --- 4. concorrência limitada ------------------------------------------------
test('loadImageAssets: no máximo 3 fetches em voo', async () => {
  let inFlight = 0, maxInFlight = 0, calls = 0;
  const fetch = async () => {
    calls++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG_BYTES.buffer };
  };
  const exp = loadExport({ fetch });
  const urls = Array.from({ length: 9 }, (_, i) => 'https://img.example/a' + i + '.png');
  const { assets, embedded } = await exp.loadImageAssets([urls]);
  assert.equal(calls, 9);
  assert.ok(maxInFlight <= 3, 'limite respeitado (máx em voo: ' + maxInFlight + ')');
  assert.equal(maxInFlight, 3, 'concorrência chega ao limite configurado');
  assert.equal(assets.size, 9);
  assert.equal(embedded.length, 9);
  // embedded é do realm do vm; Array.from normaliza para o realm do host
  assert.deepEqual(Array.from(embedded.map((e) => e.mediaIndex)), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('mapWithConcurrency: results na ordem de entrada e limite custom', async () => {
  const exp = loadExport();
  const out = await exp.mapWithConcurrency([3, 1, 2], 2, async (n) => {
    await new Promise((r) => setTimeout(r, n * 10));
    return n * 10;
  });
  assert.deepEqual(out, [30, 10, 20]);
});

// --- 5. preservação de ordem/formato -----------------------------------------
test('loadImageAssets: mediaIndex na ordem da primeira ocorrência', async () => {
  const exp = loadExport({
    fetch: async () => ({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG_BYTES.buffer }),
  });
  const rows = [['https://img.example/b.png', 'https://img.example/a.png'], ['https://img.example/a.png']];
  const { assets, embedded } = await exp.loadImageAssets(rows);
  assert.deepEqual(Array.from(embedded.map((e) => e.source)), ['https://img.example/b.png', 'https://img.example/a.png']);
  assert.deepEqual(Array.from(embedded.map((e) => e.mediaIndex)), [1, 2]);
  assert.equal(assets.get('https://img.example/a.png').mediaIndex, 2);
});

test('imageSourcesFromHtml / questionImageSources extraem src e data-src', () => {
  const exp = loadExport();
  assert.deepEqual(
    Array.from(exp.imageSourcesFromHtml('<img src="a.png"><img data-src="b.png"><img src="a.png">')),
    ['a.png', 'b.png']
  );
  const question = {
    statementHtml: '<img src="s1.png">',
    options: [{ html: '<img src="s2.png">' }, { html: '<img src="s1.png">' }],
  };
  assert.deepEqual(Array.from(exp.questionImageSources(question)), ['s1.png', 's2.png']);
});

test('imageFormat por assinatura de bytes e por mime', () => {
  const exp = loadExport();
  assert.deepEqual({ ...exp.imageFormat(PNG_BYTES, '') }, { extension: 'png', mime: 'image/png' });
  assert.deepEqual({ ...exp.imageFormat(JPEG_BYTES, '') }, { extension: 'jpg', mime: 'image/jpeg' });
  assert.deepEqual({ ...exp.imageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), '') }, { extension: 'gif', mime: 'image/gif' });
  assert.deepEqual({ ...exp.imageFormat(new Uint8Array([1, 2, 3]), 'image/png') }, { extension: 'png', mime: 'image/png' });
  assert.equal(exp.imageFormat(new Uint8Array([1, 2, 3]), 'text/plain'), null);
});

test('decodeBase64, columnName, xmlEscape e surface de exports', () => {
  const exp = loadExport();
  assert.deepEqual(Array.from(exp.decodeBase64('AQID')), [1, 2, 3]);
  assert.equal(exp.decodeBase64('!!!'), null);
  assert.equal(exp.columnName(0), 'A');
  assert.equal(exp.columnName(25), 'Z');
  assert.equal(exp.columnName(26), 'AA');
  assert.equal(exp.xmlEscape('<a b="c">&\'</a>'), '&lt;a b=&quot;c&quot;&gt;&amp;&apos;&lt;/a&gt;');
  for (const key of [
    'buildInteractiveHtml', 'buildXlsxBlob', 'zipStore', 'crc32', 'mapWithConcurrency',
    'readImageAsset', 'fetchImageAsset', 'loadImageAssets', 'clearImageCache',
    'imageFormat', 'decodeBase64', 'imageSourcesFromHtml', 'questionImageSources',
    'columnName', 'xmlEscape', 'escapeHtml', 'jsJson', 'safeFilename', 'baixarBlob',
    'baixarHtmlCaderno', 'baixarExcelCaderno', 'baixarJsonCaderno', 'entradaBiblioteca',
    'exportarCategoria', 'cadernosPorCategoria',
  ]) {
    assert.equal(typeof exp[key], 'function', 'export ausente: ' + key);
  }
});

test('buildInteractiveHtml preserva o template (conteúdo e escaping)', () => {
  const exp = loadExport();
  const html = exp.buildInteractiveHtml({
    id: 'c1', code: 'c1', title: 'Teste & "A"',
    questions: [{ id: 'q1', statement: 'x <y>', answer: 'A' }],
  });
  assert.match(html, /^<!doctype html/);
  assert.match(html, /id="tec-caderno-data"/);
  assert.match(html, /Teste &amp; &quot;A&quot;/);
});
