import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'src/fabrica/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
if (version !== '2.1.5') throw new Error(`versão inesperada: ${version}`);
if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
  throw new Error('manifest sem fragmentos');
}

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
console.log(`[build] versão ${version}; APIs globais e sintaxe validadas`);
