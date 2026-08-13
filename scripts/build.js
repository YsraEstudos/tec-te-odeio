#!/usr/bin/env node
'use strict';

/*
 * build.js — concatenação explícita dos fragmentos de src/fabrica
 * -------------------------------------------------------------------------
 * 1. Lê manifest.json (fonte de verdade: versão, ordem dos fragmentos).
 * 2. Concatena os fragmentos na ordem explícita do manifest.
 * 3. Sincroniza a versão: @version (cabeçalho userscript) e SCRIPT_VERSION
 *    (variável em runtime) recebem manifest.version (2.0.0).
 * 4. Escreve dist/tec_fabrica_cadernos.user.js.
 * 5. Verificação embutida: o resultado deve ser byte-a-byte igual ao
 *    monólito exceto pelas linhas de versão sincronizadas; senão, sai com
 *    código de erro (não escreve nada quebrado — escreve e confere depois).
 *
 * O monólito e o coletor NUNCA são tocados.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'fabrica');
const MANIFEST_PATH = path.join(SRC_DIR, 'manifest.json');
const MONOLITH = path.join(ROOT, 'tec_fabrica_cadernos.user.js');

function fail(msg) {
    console.error('[build] ERRO: ' + msg);
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail('versão inválida no manifest: ' + version);

if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
    fail('manifest sem lista de fragmentos (rode scripts/split.js)');
}

// --- 1+2. Lê e concatena na ordem explícita --------------------------------
const parts = manifest.fragments.map(function (f) {
    const p = path.join(SRC_DIR, f.file);
    if (!fs.existsSync(p)) fail('fragmento ausente: ' + f.file);
    return { file: f.file, content: fs.readFileSync(p, 'utf8') };
});

let out = parts.map(function (p) { return p.content; }).join('');

// --- 3. Sincroniza a versão nos fragmentos-alvo ----------------------------
const syncTargets = manifest.versionSync || [];
const synced = [];
syncTargets.forEach(function (rule) {
    const target = parts.find(function (p) { return p.file === rule.fragment; });
    if (!target) fail('versionSync aponta para fragmento inexistente: ' + rule.fragment);
    const pattern = new RegExp(rule.pattern, 'm');
    const replacement = rule.template.replace('{{VERSION}}', version);
    if (!pattern.test(target.content)) {
        fail('padrão de versão não encontrado em ' + rule.fragment + ' (' + rule.kind + ')');
    }
    target.content = target.content.replace(pattern, replacement);
    synced.push(rule.kind + ' -> ' + version + ' (' + rule.fragment + ')');
});

out = parts.map(function (p) { return p.content; }).join('');

// --- 4. Escreve o dist ------------------------------------------------------
const distDir = path.join(ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(ROOT, manifest.output);
fs.writeFileSync(outPath, out);

// --- 5. Verificação embutida ------------------------------------------------
const rebuilt = out;
const checks = [];

// 5a. As duas linhas de versão realmente contêm a versão do manifest
checks.push(['@version com ' + version, new RegExp('^// @version\\s+' + version.replace(/\./g, '\\.') + '$', 'm').test(rebuilt)]);
checks.push(['SCRIPT_VERSION = \'' + version + '\'', new RegExp('^\\s*var SCRIPT_VERSION = \'' + version.replace(/'/g, '\\\'') + '\';$', 'm').test(rebuilt)]);

// 5b. Igualdade com o monólito exceto pelas linhas de versão
let monolith = '';
try { monolith = fs.readFileSync(MONOLITH, 'utf8'); } catch (e) { /* monólito ausente: pula */ }
if (monolith) {
    const norm = function (s) {
        return s
            .replace(/^\/\/ @version\s+.*$/m, '// @version      X')
            .replace(/^\s*var SCRIPT_VERSION = '[^']*';$/m, "var SCRIPT_VERSION = 'X';");
    };
    checks.push(['byte-a-byte vs monólito (exceto versões)', norm(rebuilt) === norm(monolith)]);
}

const failed = checks.filter(function (c) { return !c[1]; });
checks.forEach(function (c) {
    console.log('[build] ' + (c[1] ? 'ok  ' : 'FALHOU ') + c[0]);
});
synced.forEach(function (s) { console.log('[build] sincronizado: ' + s); });

if (failed.length > 0) {
    fail('verificações falharam; dist/ pode estar inconsistente');
}

const stats = fs.statSync(outPath);
console.log('[build] escrito ' + outPath + ' (' + stats.size + ' bytes, ' + parts.length + ' fragmentos, versão ' + version + ')');
