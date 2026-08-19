import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'src/fabrica/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
const TERSER_VERSION = '5.50.0';
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`versão inválida: ${version}`);
if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
  throw new Error('manifest sem fragmentos');
}

// Minificação opcional (dev): --minify roda terser via npx, preservando o
// cabeçalho do userscript e as APIs globais do script. O build padrão
// continua sem minificar — o site inspeciona o código no devtools, e código
// minificado em produção é um marcador incomum para userscript.
const minify = process.argv.includes('--minify');
// Terser testa o regex contra comment.value, que para comentários de linha
// é o texto APÓS o "//" (ex.: " ==UserScript==", com espaço inicial).
const usercssComments = '^ ==UserScript==$|^ ==\\/UserScript==$|^ @(name|namespace|version|description|author|match|grant|run-at|exclude)';

const parts = manifest.fragments.map(({ file }) => {
  const path = resolve(root, 'src/fabrica', file);
  if (!existsSync(path)) throw new Error(`fragmento ausente: ${file}`);
  const content = readFileSync(path, 'utf8');
  if (!content.trim()) throw new Error(`fragmento vazio: ${file}`);
  return { file, content };
});

let output = parts.map((part) => part.content).join('');
output = output.replace(/^\/\/ @version\s+.*$/m, `// @version      ${version}`);
output = output.replace(/^(\s*var SCRIPT_VERSION = ')[^']*(';\s*)$/m, `$1${version}$2`);

const checks = [
  [`@version ${version}`, new RegExp(`^// @version\\s+${version.replaceAll('.', '\\.')}$`, 'm').test(output)],
  [`SCRIPT_VERSION ${version}`, new RegExp(`^\\s*var SCRIPT_VERSION = '${version.replaceAll('.', '\\.')}'`, 'm').test(output)],
  ['__TecFabrica', /window\.__TecFabrica\s*=/.test(output)],
  ['__TecFabricaExport', /window\.__TecFabricaExport\s*=/.test(output)],
  ['__TecFabricaUI', /window\.__TecFabricaUI\s*=/.test(output)],
];
for (const [label, ok] of checks) if (!ok) throw new Error(`validação falhou: ${label}`);

const check = spawnSync(process.execPath, ['--check'], { input: output, encoding: 'utf8' });
if (check.status !== 0) throw new Error(`node --check falhou:\n${check.stderr || check.stdout}`);

// Minificação (dev, opcional): valida o source primeiro (acima) e roda o
// terser depois, para que o artefato final também passe no node --check.
// Entrada/saída por arquivos temporários: o cmd do Windows trunca stdin
// binário em pipes, então o conteúdo NUNCA passa pelo shell.
if (minify) {
  const { tmpdir } = await import('node:os');
  const tmpEntrada = resolve(tmpdir(), `tec-fabrica-min-${process.pid}.js`);
  const tmpSaida = resolve(tmpdir(), `tec-fabrica-min-${process.pid}.out.js`);
  writeFileSync(tmpEntrada, output, 'utf8');
  let terser;
  try {
    // A exportação interativa serializa helpers com Function#toString(); seus
    // nomes precisam sobreviver ao mangle para o runtime exportado funcionar.
    const base = ['--yes', `terser@${TERSER_VERSION}`, tmpEntrada, '--compress', 'passes=2', '--mangle', '--keep-fnames', `--comments=/${usercssComments}/`, '-o', tmpSaida];
    if (/^win/.test(process.platform)) {
      // npx é um .cmd no Windows: precisa do shell, e aspas duplas do cmd
      // protegem os caracteres especiais do regex (| ^ ( )).
      terser = spawnSync(`npx "${base.join('" "')}"`, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        shell: true
      });
    } else {
      terser = spawnSync('npx', base, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    }
    if (terser.status !== 0) {
      const erroSpawn = terser.error ? `${terser.error.stack || terser.error.message || terser.error}\n` : '';
      throw new Error(`terser falhou:\n${(erroSpawn + (terser.stderr || terser.stdout || '')).slice(0, 2000)}`);
    }
    const minificado = readFileSync(tmpSaida, 'utf8');
    const checksMinificados = [
      ['abertura do cabeçalho', /^\/\/ ==UserScript==$/m.test(minificado)],
      ['fechamento do cabeçalho', /^\/\/ ==\/UserScript==$/m.test(minificado)],
      [`@version ${version}`, new RegExp(`^// @version\\s+${version.replaceAll('.', '\\.')}$`, 'm').test(minificado)],
      ['__TecFabrica', /window\.__TecFabrica\s*=/.test(minificado)],
      ['__TecFabricaExport', /window\.__TecFabricaExport\s*=/.test(minificado)],
      ['__TecFabricaUI', /window\.__TecFabricaUI\s*=/.test(minificado)]
    ];
    for (const [label, ok] of checksMinificados) {
      if (!ok) throw new Error(`minificação removeu contrato: ${label}`);
    }
    const checkMin = spawnSync(process.execPath, ['--check', tmpSaida], { encoding: 'utf8' });
    if (checkMin.status !== 0) throw new Error(`node --check do artefato minificado falhou:\n${checkMin.stderr || checkMin.stdout}`);
    output = minificado;
  } finally {
    try { unlinkSync(tmpEntrada); } catch (e) {}
    try { unlinkSync(tmpSaida); } catch (e) {}
  }
}

const outPath = resolve(root, manifest.output);
const installPath = manifest.installOutput ? resolve(root, manifest.installOutput) : null;

function escreverAtomico(path) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tempPath, output, 'utf8');
    renameSync(tempPath, path);
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  }
}

escreverAtomico(outPath);
if (installPath && installPath !== outPath) escreverAtomico(installPath);

console.log(`[build] OK ${manifest.fragments.length} fragmentos -> ${manifest.output}`);
if (manifest.installOutput) console.log(`[build] instalação limpa -> ${manifest.installOutput}`);
console.log(`[build] versão ${version}; APIs globais e sintaxe validadas${minify ? '; minificado (terser)' : ''}`);
