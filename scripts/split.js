#!/usr/bin/env node
'use strict';

/*
 * split.js — fragmentação mecânica do monólito tec_fabrica_cadernos.user.js
 * -------------------------------------------------------------------------
 * Divide o arquivo nas seções delimitadas por marcadores "/* ====..." e
 * grava um fragmento por seção em src/fabrica/, preservando bytes (EOL LF,
 * BOM, indentação, comentários) e a estrutura da IIFE. Em seguida atualiza
 * a lista "fragments" do manifest.json (ordem, nomes, seção e intervalo de
 * linhas no monólito) — a fonte de verdade da ordem de concatenação.
 *
 * É idempotente: rodar de novo regenera os fragmentos a partir do monólito.
 * O monólito NUNCA é modificado.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MONOLITH = path.join(ROOT, 'tec_fabrica_cadernos.user.js');
const SRC_DIR = path.join(ROOT, 'src', 'fabrica');
const MANIFEST = path.join(SRC_DIR, 'manifest.json');

// Nomes determinísticos por ordem de seção (não derivar do título, que é
// descritivo e contém acentos/símbolos).
const NAMES = [
    '00-cabecalho',
    '01-config',
    '02-timers',
    '03-dom-helpers',
    '04-plano',
    '05-estado',
    '06-persistencia',
    '07-paginas',
    '08-extracao',
    '09-interceptor',
    '10-resolucao',
    '11-filtros',
    '12-criacao',
    '13-impressao',
    '14-coleta',
    '15-orquestrador',
    '16-api-publica',
    '17-exportacao',
    '18-ui',
    '19-inicializacao'
];

function fail(msg) {
    console.error('[split] ERRO: ' + msg);
    process.exit(1);
}

const raw = fs.readFileSync(MONOLITH, 'utf8'); // Node mantém o BOM (\uFEFF) como primeiro char
const lines = raw.split('\n'); // EOL é LF (verificado) — o split preserva cada linha

// Última linha é "})();" seguida de '\n' → o split deixa uma string vazia final.
if (lines[lines.length - 1] !== '') {
    fail('monólito não termina com quebra de linha (EOL inesperado)');
}
lines.pop(); // remove o elemento vazio; cada linha volta a ter seu '\n' no join

// Marcadores de abertura de seção: linhas cujo conteúdo (com indentação) é "/* ===="
const markers = [];
lines.forEach(function (line, i) {
    if (/^\s*\/\* =+\s*$/.test(line)) markers.push(i); // índice 0-based
});

if (markers.length !== NAMES.length) {
    fail('encontrados ' + markers.length + ' marcadores de seção, esperados ' + NAMES.length + ' (monólito mudou?)');
}

const sections = markers.map(function (m, i) {
    // A 1ª seção começa no início do arquivo (cabeçalho userscript + banner);
    // as demais começam no marcador de abertura.
    const start = (i === 0 ? 0 : m);
    const end = (i + 1 < markers.length ? markers[i + 1] : lines.length) - 1; // linha anterior ao próximo marcador (ou EOF)
    return { start: start, end: end };
});

// Valida contiguidade: cada seção começa exatamente onde a anterior termina + 1
for (let i = 1; i < sections.length; i++) {
    if (sections[i].start !== sections[i - 1].end + 1) {
        fail('seções não são contíguas em ' + sections[i].start + ' vs ' + (sections[i - 1].end + 1));
    }
}

fs.mkdirSync(SRC_DIR, { recursive: true });

const fragments = sections.map(function (sec, i) {
    const content = lines.slice(sec.start, sec.end + 1).join('\n') + '\n';
    const file = NAMES[i] + '.js';
    const outPath = path.join(SRC_DIR, file);

    // Título da seção: primeira linha " * TEXTO" após o marcador de abertura
    let title = '(sem título)';
    for (let j = sec.start + 1; j <= sec.end; j++) {
        const m = /^\s*\* (.+)$/.exec(lines[j]);
        if (m) { title = m[1].trim(); break; }
        if (/^\s*\/\*/.test(lines[j])) continue; // marcadores aninhados (ex.: PERSISTÊNCIA SEGURA)
        break;
    }

    if (fs.existsSync(outPath)) {
        const prev = fs.readFileSync(outPath, 'utf8');
        if (prev === content) {
            console.log('[split] ok (inalterado) ' + file);
        } else {
            fs.writeFileSync(outPath, content);
            console.log('[split] atualizado ' + file);
        }
    } else {
        fs.writeFileSync(outPath, content);
        console.log('[split] criado ' + file);
    }

    return {
        id: String(i).padStart(2, '0'),
        file: file,
        section: title,
        lines: (sec.start + 1) + '-' + (sec.end + 1) // 1-based para leitura humana
    };
});

// Atualiza o manifest.json preservando os demais campos (version, versionSync, userscript...)
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
manifest.fragments = fragments;
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

// Auto-verificação: concatenação dos fragmentos == monólito (byte a byte)
const rebuilt = fragments.map(function (f) {
    return fs.readFileSync(path.join(SRC_DIR, f.file), 'utf8');
}).join('');
if (rebuilt === raw) {
    console.log('[split] VERIFICAÇÃO: concatenação byte-a-byte idêntica ao monólito (' + rebuilt.length + ' chars).');
} else {
    console.error('[split] VERIFICAÇÃO FALHOU: concatenação difere do monólito!');
    process.exit(1);
}
