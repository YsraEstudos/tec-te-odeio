    /* =====================================================================
     * EXPORTAÇÃO — réplica fiel dos templates do projeto "Tecconcursos"
     * =================================================================== */
    function safeFilename(value) {
        return clean(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\.+$/g, '').slice(0, 100) || 'arquivo';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function jsJson(value) {
        return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
    }

    function baixarBlob(nomeArquivo, blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = nomeArquivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    function entradaBiblioteca(caderno) {
        // mesmo formato de entrada do projeto: {id, code, title, group, questions}
        return {
            id: 'caderno-' + caderno.id,
            code: caderno.id,
            title: caderno.titulo,
            group: 'Plano',
            questions: (caderno.questoes || []).map(function (q) {
                return {
                    id: q.id,
                    number: q.number,
                    url: q.url,
                    header: q.header,
                    bank: q.bank || '',
                    year: q.year != null ? q.year : '',
                    vacancy: q.vacancy || '',
                    organization: q.organization || '',
                    role: q.role || '',
                    subject: q.subject || '',
                    topic: q.topic || '',
                    statement: q.statement || '',
                    statementHtml: q.statementHtml || '',
                    options: q.options || [],
                    answer: q.answer || ''
                };
            })
        };
    }

    function normalizeExportFilters(filters) {
        var source = filters || {};
        function normalizeValues(values) {
            var list = Array.isArray(values) ? values : [values];
            var normalized = [];
            list.forEach(function (value) {
                var item = String(value == null ? '' : value).trim();
                if (item && normalized.indexOf(item) < 0) normalized.push(item);
            });
            return normalized;
        }
        return {
            subjects: normalizeValues(source.subjects),
            banks: normalizeValues(source.banks)
        };
    }

    function filterExportQuestions(questions, filters) {
        var normalized = normalizeExportFilters(filters);
        return (questions || []).filter(function (question) {
            var subject = String(question && question.subject != null ? question.subject : '').trim();
            var bank = String(question && question.bank != null ? question.bank : '').trim();
            return (!normalized.subjects.length || normalized.subjects.indexOf(subject) >= 0) &&
                (!normalized.banks.length || normalized.banks.indexOf(bank) >= 0);
        });
    }

    function formatQuestionAsTxt(question, index) {
        var number = question && question.number != null && question.number !== '' ? question.number : index + 1;
        var lines = [String(number) + '. ' + String(question && question.statement || '')];
        [
            ['Matéria', question && question.subject],
            ['Assunto', question && question.topic],
            ['Banca', question && question.bank]
        ].forEach(function (field) {
            if (field[1]) lines.push(field[0] + ': ' + field[1]);
        });
        (question && question.options || []).forEach(function (option) {
            lines.push(String(option && option.letter || '') + ') ' + String(option && option.text || ''));
        });
        return lines.join('\n');
    }

    function buildTxtExport(questions, entry) {
        var title = entry && (entry.title || entry.code);
        var sections = (questions || []).map(formatQuestionAsTxt);
        return (title ? String(title) + '\n\n' : '') + sections.join('\n\n') + (sections.length ? '\n' : '');
    }

    /* ---- HTML interativo (template do projeto) ---- */
    function buildInteractiveHtml(entry) {
        var data = Object.assign({}, entry, { questions: entry.questions || [] });
        var initial = { attempts: [{ id: 'tentativa-1', createdAt: new Date().toISOString(), answers: {}, eliminated: {} }], activeAttempt: 0 };
        var fileName = safeFilename((entry.title || entry.code || 'caderno') + '-interativo.html');
        var runtime = String.raw`(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("tec-caderno-data").textContent);
  var fallback = JSON.parse(document.getElementById("tec-caderno-state").textContent);
  var state = fallback;
  var index = 0;
  var downloadName = ${jsJson(fileName)};
  var darkTheme = document.createElement("style");
  darkTheme.textContent = ":root{color-scheme:dark}body{background:#0b1120;color:#e5e7eb}.card{background:#111827;color:#e5e7eb}.controls button,.controls input,.controls select{background:#1f2937;color:#f9fafb;border-color:#4b5563}.meta{color:#cbd5e1}.tag{background:#172554;color:#bfdbfe}.option{background:#1f2937;color:#f9fafb;border-color:#4b5563;transition:background .2s ease,border-color .2s ease,opacity .3s ease,filter .3s ease}.option:hover{border-color:#60a5fa}.option.selected{background:#172554;border-color:#60a5fa}.option.correct{background:#052e16;border-color:#22c55e}.option.incorrect{background:#450a0a;border-color:#ef4444}.option.eliminated{background:#111827;opacity:.3;filter:grayscale(.8)}.hint,.empty{color:#94a3b8}.feedback{margin:14px 0;padding:12px 14px;border-radius:8px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-weight:700}.feedback.correct{border-color:#22c55e;background:#052e16;color:#bbf7d0}.feedback.incorrect{border-color:#ef4444;background:#450a0a;color:#fecaca}.feedback.unavailable{border-color:#f59e0b;background:#451a03;color:#fde68a}.statement img,.option img{display:block;max-width:100%;height:auto;margin:12px auto;border-radius:8px}";
  document.head.appendChild(darkTheme);
  function read() { return fallback; }
  function write() {
    document.getElementById("tec-caderno-state").textContent = JSON.stringify(state);
    document.getElementById("status").textContent = "Histórico nesta sessão; baixe o HTML para preservar";
  }
  function currentAttempt() { return state.attempts[state.activeAttempt] || state.attempts[0]; }
  function escapeValue(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]; }); }
  function answerLetter(value) {
    var raw = String(value == null ? "" : value).trim().toUpperCase();
    if (/^[A-E]$/.test(raw)) return raw;
    var labeled = raw.match(/(?:GABARITO|RESPOSTA|ALTERNATIVA)\s*[:.)-]?\s*([A-E])\b/);
    if (labeled) return labeled[1];
    var prefixed = raw.match(/^([A-E])\s*[:.)-]/);
    return prefixed ? prefixed[1] : "";
  }
  ${normalizeExportFilters.toString()}
  ${filterExportQuestions.toString()}
  ${formatQuestionAsTxt.toString()}
  ${buildTxtExport.toString()}
  ${baixarBlob.toString()}
  function exportFilters() {
    return normalizeExportFilters({
      subjects: [document.getElementById("subject").value],
      banks: [document.getElementById("bank").value]
    });
  }
  function visibleQuestions() {
    return filterExportQuestions(data.questions, exportFilters()).filter(function (question) {
      return (!document.getElementById("year").value || String(question.year || "") === document.getElementById("year").value) && (!document.getElementById("vacancy").value || question.vacancy === document.getElementById("vacancy").value);
    });
  }
  function render() {
    var visible = visibleQuestions();
    var question = visible[index];
    document.getElementById("title").textContent = data.title || data.code || "Caderno";
    document.getElementById("summary").textContent = (data.group || "Sem grupo") + " · " + visible.length + " questão(ões) filtrada(s) de " + data.questions.length;
    if (!question) { document.getElementById("question").innerHTML = '<div class="empty">Nenhuma questão para esse filtro.</div>'; return; }
    var attempt = currentAttempt();
    var correctAnswer = answerLetter(question.answer || question.gabarito);
    var selectedAnswer = answerLetter(attempt.answers[question.id]);
    var confirmed = !!(attempt.confirmed || {})[question.id];
    var meta = [question.bank, question.year, question.organization, question.role, question.vacancy, question.subject, question.topic].filter(Boolean).map(function (value) { return '<span class="tag">' + escapeValue(value) + "</span>"; }).join("");
    var body = question.statementHtml || ("<p>" + escapeValue(question.statement) + "</p>");
    var alternatives = (question.options || []).map(function (option) {
      var selected = selectedAnswer === option.letter;
      var correct = confirmed && !!correctAnswer && correctAnswer === option.letter;
      var incorrect = confirmed && selected && !!correctAnswer && selectedAnswer !== correctAnswer;
      var eliminated = !!(attempt.eliminated[question.id] || {})[option.letter];
      return '<button class="option ' + (selected ? "selected " : "") + (correct ? "correct " : "") + (incorrect ? "incorrect " : "") + (eliminated ? "eliminated " : "") + '" aria-pressed="' + (selected ? "true" : "false") + '" data-letter="' + escapeValue(option.letter) + '">' + (option.html || ("<strong>" + escapeValue(option.letter) + ")</strong> " + escapeValue(option.text))) + "</button>";
    }).join("");
    var feedbackClass = "feedback";
    var feedbackText = "Selecione uma alternativa e clique em Responder para confirmar.";
    if (selectedAnswer && correctAnswer && confirmed) {
      feedbackClass += selectedAnswer === correctAnswer ? " correct" : " incorrect";
      feedbackText = selectedAnswer === correctAnswer
        ? "✓ Você acertou! A resposta correta é " + correctAnswer + "."
        : "✕ Você errou. Você marcou " + selectedAnswer + "; a resposta correta é " + correctAnswer + ".";
    } else if (selectedAnswer && confirmed) {
      feedbackClass += " unavailable";
      feedbackText = "Resposta marcada, mas o gabarito desta questão não foi extraído.";
    } else if (selectedAnswer) {
      feedbackText = "Alternativa " + selectedAnswer + " selecionada. Clique em Responder para confirmar.";
    }
    document.getElementById("question").innerHTML = '<div class="meta">' + meta + '</div><div class="statement">' + body + "</div><div>" + alternatives + '</div><div class="answer-row"><button id="respond"' + (selectedAnswer && !confirmed ? "" : " disabled") + '>Responder</button><div id="feedback" class="' + feedbackClass + '">' + escapeValue(feedbackText) + '</div></div><div class="hint">Clique para selecionar uma alternativa e depois em Responder para confirmar. Dê duplo clique para esmaecer (descartar) ou restaurar uma alternativa.</div>';
    document.getElementById("status").textContent = "Questão " + (index + 1) + " de " + visible.length;
    Array.from(document.querySelectorAll(".option")).forEach(function (button) {
      var clickTimer = null;
      button.addEventListener("click", function () {
        if (clickTimer) clearTimeout(clickTimer);
        clickTimer = setTimeout(function () {
          attempt.answers[question.id] = button.dataset.letter;
          if (attempt.confirmed && attempt.confirmed[question.id] !== button.dataset.letter) delete attempt.confirmed[question.id];
          write();
          render();
        }, 220);
      });
      button.addEventListener("dblclick", function (event) { event.preventDefault(); if (clickTimer) clearTimeout(clickTimer); attempt.eliminated[question.id] = attempt.eliminated[question.id] || {}; if (attempt.eliminated[question.id][button.dataset.letter]) delete attempt.eliminated[question.id][button.dataset.letter]; else attempt.eliminated[question.id][button.dataset.letter] = true; write(); render(); });
    });
    var respond = document.getElementById("respond");
    if (respond) respond.addEventListener("click", function () {
      attempt.confirmed = attempt.confirmed || {};
      attempt.confirmed[question.id] = true;
      write();
      render();
    });
  }
  function resetIndex() { index = 0; render(); }
  function fillFilters() {
    Array.from(new Set(data.questions.map(function (question) { return question.subject; }).filter(Boolean))).sort().forEach(function (value) { document.getElementById("subject").insertAdjacentHTML("beforeend", "<option>" + escapeValue(value) + "</option>"); });
    Array.from(new Set(data.questions.map(function (question) { return question.bank; }).filter(Boolean))).sort().forEach(function (value) { document.getElementById("bank").insertAdjacentHTML("beforeend", "<option>" + escapeValue(value) + "</option>"); });
    Array.from(new Set(data.questions.map(function (question) { return question.year; }).filter(Boolean))).sort(function (left, right) { return right - left; }).forEach(function (value) { document.getElementById("year").insertAdjacentHTML("beforeend", "<option>" + escapeValue(value) + "</option>"); });
    Array.from(new Set(data.questions.map(function (question) { return question.vacancy; }).filter(Boolean))).sort().forEach(function (value) { document.getElementById("vacancy").insertAdjacentHTML("beforeend", "<option>" + escapeValue(value) + "</option>"); });
  }
  function ensureVacancyControl() {
    var existing = document.getElementById("vacancy");
    if (existing) return existing;
    var year = document.getElementById("year");
    var controls = year && year.parentElement && year.parentElement.parentElement;
    if (!controls) return null;
    var label = document.createElement("label");
    label.textContent = "Vaga ";
    var select = document.createElement("select");
    select.id = "vacancy";
    select.innerHTML = '<option value="">Todas</option>';
    label.appendChild(select);
    controls.appendChild(label);
    return select;
  }
  state = read();
  ensureVacancyControl();
  document.getElementById("prev").onclick = function () { index = Math.max(0, index - 1); render(); };
  document.getElementById("next").onclick = function () { index = Math.min(visibleQuestions().length - 1, index + 1); render(); };
  document.getElementById("go").onclick = function () { var number = Number(document.getElementById("jump").value); if (number > 0) { index = Math.min(visibleQuestions().length - 1, number - 1); render(); } };
  document.getElementById("subject").onchange = resetIndex;
  document.getElementById("bank").onchange = resetIndex;
  document.getElementById("year").onchange = resetIndex;
  document.getElementById("vacancy").onchange = resetIndex;
  document.getElementById("newAttempt").onclick = function () { state.attempts.push({ id: "tentativa-" + (state.attempts.length + 1), createdAt: new Date().toISOString(), answers: {}, eliminated: {} }); state.activeAttempt = state.attempts.length - 1; write(); render(); };
  document.getElementById("saveHtml").onclick = function () { write(); var blob = new Blob([document.documentElement.outerHTML], { type: "text/html;charset=utf-8" }); var url = URL.createObjectURL(blob); var anchor = document.createElement("a"); anchor.href = url; anchor.download = downloadName; anchor.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000); };
  document.getElementById("downloadTxt").onclick = function () { var currentFilters = exportFilters(); var questions = filterExportQuestions(data.questions, currentFilters).filter(function (question) { return (!document.getElementById("year").value || String(question.year || "") === document.getElementById("year").value) && (!document.getElementById("vacancy").value || question.vacancy === document.getElementById("vacancy").value); }); baixarBlob((data.title || data.code || "caderno") + "-filtrado.txt", new Blob([buildTxtExport(questions, data)], { type: "text/plain;charset=utf-8" })); document.getElementById("status").textContent = questions.length + " questão(ões) filtrada(s) exportada(s) em TXT"; };
  fillFilters();
  render();
})();`;
        return [
            '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>', escapeHtml(entry.title || 'Caderno'),
            '</title><style>body{margin:0;background:#f3f4f6;color:#182230;font:16px system-ui,-apple-system,Segoe UI,sans-serif}.top{position:sticky;top:0;z-index:2;background:#102a43;color:#fff;padding:14px 20px;box-shadow:0 2px 8px #0003}.top h1{font-size:18px;margin:0 0 7px}.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.controls button,.controls input,.controls select{border:1px solid #aab8c8;border-radius:7px;padding:7px 9px;font:inherit}.controls button{background:#fff;color:#102a43;cursor:pointer;font-weight:700}.summary{font-size:13px;opacity:.9}.main{max-width:900px;margin:24px auto;padding:0 16px}.card{background:#fff;border-radius:12px;box-shadow:0 3px 14px #0b1f3317;padding:22px}.meta{display:flex;gap:6px;flex-wrap:wrap;color:#52606d;font-size:14px;margin-bottom:14px}.tag{background:#e6f6ff;color:#075985;padding:4px 7px;border-radius:999px}.statement{line-height:1.6}.option{display:block;width:100%;text-align:left;margin:10px 0;padding:12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer;font:inherit;transition:background .2s ease,border-color .2s ease,opacity .3s ease,filter .3s ease}.option:hover{border-color:#2563eb}.option.selected{border:2px solid #2563eb;background:#eff6ff}.option.eliminated{opacity:.3;filter:grayscale(.8);background:#f1f5f9}.answer-row{display:flex;align-items:center;gap:12px;margin-top:14px}.answer-row #feedback{margin:0;flex:1}#respond{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:11px 18px;font:700 14px system-ui;cursor:pointer;white-space:nowrap}#respond:hover:not(:disabled){background:#1d4ed8}#respond:disabled{background:#9ca3af;cursor:not-allowed}.hint{margin-top:12px;color:#64748b;font-size:13px}.status{margin-left:auto;font-size:13px}.empty{padding:30px;text-align:center;color:#64748b}</style></head><body><header class="top"><h1 id="title"></h1><div class="controls"><button id="prev">← Anterior</button><button id="next">Próxima →</button><label>Ir para <input id="jump" type="number" min="1" style="width:78px"></label><button id="go">Ir</button><label>Matéria <select id="subject"><option value="">Todas</option></select></label><label>Banca <select id="bank"><option value="">Todas</option></select></label><label>Ano <select id="year"><option value="">Todos</option></select></label><button id="newAttempt">Nova tentativa</button><button id="saveHtml">Baixar HTML com histórico</button><button id="downloadTxt">Baixar TXT filtrado</button><span class="status" id="status"></span></div><div class="summary" id="summary"></div></header><main class="main"><article class="card" id="question"></article></main><script id="tec-caderno-data" type="application/json">', jsJson(data), '</script><script id="tec-caderno-state" type="application/json">', jsJson(initial), '</script><script>', runtime, '</script></body></html>'
        ].join('');
    }

    /* ---- XLSX (réplica fiel do projeto, com imagens embutidas) ---- */
    function xmlEscape(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
        });
    }
    function columnName(index) {
        var value = index + 1, output = '';
        while (value > 0) { var r = (value - 1) % 26; output = String.fromCharCode(65 + r) + output; value = Math.floor((value - 1) / 26); }
        return output;
    }
    function crc32(bytes) {
        var table = crc32.table || (crc32.table = Array.from({ length: 256 }, function (_, i) {
            var v = i;
            for (var b = 0; b < 8; b += 1) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
            return v >>> 0;
        }));
        var crc = 0 ^ -1;
        for (var i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
        return (crc ^ -1) >>> 0;
    }
    function writeU16(view, offset, value) {
        view[offset] = value & 255;
        view[offset + 1] = (value >>> 8) & 255;
    }
    function writeU32(view, offset, value) {
        view[offset] = value & 255;
        view[offset + 1] = (value >>> 8) & 255;
        view[offset + 2] = (value >>> 16) & 255;
        view[offset + 3] = (value >>> 24) & 255;
    }
    function zipStore(files) {
        // ZIP sem compressão (método 0, "stored") — mesma estrutura do original:
        // cabeçalho local (30 bytes) + nome + conteúdo; diretório central (46
        // bytes) + nome; EOCD (22 bytes). Aloca um único Uint8Array do tamanho
        // exato e escreve por posição — sem Array.from(...).flat(), sem
        // concatenação O(n²) de arrays de números.
        var encoder = new TextEncoder();
        var names = [], contents = [], crcs = [], offsets = [];
        var localSize = 0, directorySize = 0;
        for (var i = 0; i < files.length; i += 1) {
            var file = files[i];
            var name = encoder.encode(file.name);
            var content = typeof file.content === 'string' ? encoder.encode(file.content) : new Uint8Array(file.content);
            var crc = crc32(content);
            names.push(name);
            contents.push(content);
            crcs.push(crc);
            offsets.push(localSize);
            localSize += 30 + name.length + content.length;
            directorySize += 46 + name.length;
        }
        var output = new Uint8Array(localSize + directorySize + 22);
        var write = 0;
        for (i = 0; i < files.length; i += 1) {
            name = names[i]; content = contents[i]; crc = crcs[i];
            writeU32(output, write, 0x04034B50); write += 4;   // assinatura do cabeçalho local
            writeU16(output, write, 20); write += 2;           // versão necessária
            writeU16(output, write, 0); write += 2;            // flags
            writeU16(output, write, 0); write += 2;            // método (stored)
            writeU16(output, write, 0); write += 2;            // hora de modificação
            writeU16(output, write, 0); write += 2;            // data de modificação
            writeU32(output, write, crc); write += 4;          // crc32
            writeU32(output, write, content.length); write += 4; // tamanho comprimido
            writeU32(output, write, content.length); write += 4; // tamanho original
            writeU16(output, write, name.length); write += 2;  // tamanho do nome
            writeU16(output, write, 0); write += 2;            // tamanho do extra
            output.set(name, write); write += name.length;
            output.set(content, write); write += content.length;
        }
        for (i = 0; i < files.length; i += 1) {
            name = names[i]; crc = crcs[i];
            writeU32(output, write, 0x02014B50); write += 4;   // assinatura do diretório central
            writeU16(output, write, 20); write += 2;           // versão criadora
            writeU16(output, write, 20); write += 2;           // versão necessária
            writeU16(output, write, 0); write += 2;            // flags
            writeU16(output, write, 0); write += 2;            // método
            writeU16(output, write, 0); write += 2;            // hora
            writeU16(output, write, 0); write += 2;            // data
            writeU32(output, write, crc); write += 4;          // crc32
            writeU32(output, write, contents[i].length); write += 4; // comprimido
            writeU32(output, write, contents[i].length); write += 4; // original
            writeU16(output, write, name.length); write += 2;  // tamanho do nome
            writeU16(output, write, 0); write += 2;            // extra
            writeU16(output, write, 0); write += 2;            // comentário
            writeU16(output, write, 0); write += 2;            // disco inicial
            writeU16(output, write, 0); write += 2;            // atributos internos
            writeU32(output, write, 0); write += 4;            // atributos externos
            writeU32(output, write, offsets[i]); write += 4;   // offset do cabeçalho local
            output.set(name, write); write += name.length;
        }
        writeU32(output, write, 0x06054B50); write += 4;       // assinatura EOCD
        writeU16(output, write, 0); write += 2;                // disco atual
        writeU16(output, write, 0); write += 2;                // disco do diretório
        writeU16(output, write, files.length); write += 2;     // entradas neste disco
        writeU16(output, write, files.length); write += 2;     // total de entradas
        writeU32(output, write, directorySize); write += 4;    // tamanho do diretório central
        writeU32(output, write, localSize); write += 4;        // offset do diretório central
        writeU16(output, write, 0); write += 2;                // tamanho do comentário
        return output;
    }
    function imageSourcesFromHtml(value) {
        var sources = [], pattern = /<img\b[^>]*\b(?:src|data-src)\s*=\s*(["'])(.*?)\1/gi, m;
        while ((m = pattern.exec(String(value == null ? '' : value)))) {
            var s = String(m[2] || '').trim();
            if (s && sources.indexOf(s) < 0) sources.push(s);
        }
        return sources;
    }
    function questionImageSources(question) {
        var sources = imageSourcesFromHtml(question && question.statementHtml);
        (question && question.options || []).forEach(function (option) {
            imageSourcesFromHtml(option && option.html).forEach(function (s) { if (sources.indexOf(s) < 0) sources.push(s); });
        });
        return sources;
    }
    var MAX_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024;
    function decodeBase64(value) {
        try {
            var binary = atob(String(value || '').replace(/\s/g, ''));
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            return bytes;
        } catch (_) { return null; }
    }
    function imageFormat(bytes, mime) {
        var type = String(mime || '').split(';', 1)[0].toLowerCase();
        if (bytes && bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return { extension: 'png', mime: 'image/png' };
        if (bytes && bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return { extension: 'jpg', mime: 'image/jpeg' };
        if (bytes && bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { extension: 'gif', mime: 'image/gif' };
        if (type === 'image/jpg') type = 'image/jpeg';
        if (type === 'image/png') return { extension: 'png', mime: type };
        if (type === 'image/jpeg') return { extension: 'jpg', mime: type };
        if (type === 'image/gif') return { extension: 'gif', mime: type };
        return null;
    }
    var IMAGE_LOAD_CONCURRENCY = 3;
    var imageCache = new Map();
    function clearImageCache() { imageCache.clear(); }
    async function fetchImageAsset(raw) {
        var bytes = null, mime = '';
        var dataMatch = raw.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
        if (dataMatch) {
            mime = dataMatch[1];
            bytes = dataMatch[2] ? decodeBase64(dataMatch[3]) : null;
        } else if (/^https?:/i.test(raw) && typeof fetch === 'function') {
            try {
                var response = await fetch(raw, { credentials: 'include' });
                if (!response || !response.ok) return null;
                mime = response.headers.get('content-type') || '';
                bytes = new Uint8Array(await response.arrayBuffer());
            } catch (_) { return null; }
        }
        if (!bytes || !bytes.length || bytes.length > MAX_EMBEDDED_IMAGE_BYTES) return null;
        var format = imageFormat(bytes, mime);
        return format ? { source: raw, bytes: bytes, extension: format.extension, mime: format.mime } : null;
    }
    function readImageAsset(source) {
        // Cache por URL: cada fonte é resolvida no máximo uma vez por sessão
        // (a promessa em si fica em cache, inclusive falhas/URLs quebradas,
        // evitando refetch). Mantém a API original: retorna Promise<asset|null>.
        var raw = String(source || '').trim();
        if (!raw) return null;
        if (imageCache.has(raw)) return imageCache.get(raw);
        var promise = fetchImageAsset(raw);
        imageCache.set(raw, promise);
        return promise;
    }
    function mapWithConcurrency(items, limit, worker) {
        // Executa worker(item, index) com no máximo `limit` promessas em voo;
        // resolve com os resultados na ordem de entrada. O limite é mantido
        // pelo contador `running` dentro de pump(); erro derruba a cadeia.
        return new Promise(function (resolve, reject) {
            var results = new Array(items.length);
            var next = 0, running = 0, settled = false;
            function fail(error) { if (!settled) { settled = true; reject(error); } }
            function finish() { if (!settled) { settled = true; resolve(results); } }
            function pump() {
                while (!settled && running < limit && next < items.length) {
                    (function (index) {
                        next += 1;
                        running += 1;
                        Promise.resolve().then(function () {
                            return worker(items[index], index);
                        }).then(function (result) {
                            results[index] = result;
                        }, fail).then(function () {
                            running -= 1;
                            if (!settled) {
                                if (next < items.length) pump();
                                else if (running === 0) finish();
                            }
                        });
                    })(next);
                }
                if (!settled && next >= items.length && running === 0) finish();
            }
            pump();
        });
    }
    async function loadImageAssets(questionImages, options) {
        // Concorrência limitada (padrão IMAGE_LOAD_CONCURRENCY = 3; override
        // via options.limit) + cache por URL. mediaIndex segue a ordem da
        // primeira ocorrência de cada fonte — a mesma do carregamento
        // sequencial anterior, então a planilha e os desenhos não mudam.
        var limit = options && typeof options.limit === 'number' ? options.limit : IMAGE_LOAD_CONCURRENCY;
        var sources = [];
        (questionImages || []).forEach(function (list) {
            (list || []).forEach(function (source) {
                if (sources.indexOf(source) < 0) sources.push(source);
            });
        });
        var loaded = await mapWithConcurrency(sources, limit, readImageAsset);
        var assets = new Map(), embedded = [];
        sources.forEach(function (source, index) {
            var asset = loaded[index];
            if (asset) {
                asset.mediaIndex = embedded.length + 1;
                embedded.push(asset);
                assets.set(source, asset);
            }
        });
        return { assets: assets, embedded: embedded };
    }
    function drawingXml(drawingImages) {
        var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
        drawingImages.forEach(function (image, index) {
            xml += '<xdr:oneCellAnchor><xdr:from><xdr:col>' + image.column + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + image.row + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="5000000" cy="2500000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (index + 1) + '" name="Imagem ' + (index + 1) + '"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId' + (index + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
        });
        return xml + '</xdr:wsDr>';
    }
    function drawingRelationshipsXml(drawingImages) {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + drawingImages.map(function (image, index) {
            return '<Relationship Id="rId' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + image.asset.mediaIndex + '.' + image.asset.extension + '"/>';
        }).join('') + '</Relationships>';
    }
    async function buildXlsxBlob(entry, options) {
        var config = options || {};
        var questionImages = (entry.questions || []).map(questionImageSources);
        var loadedImages = await loadImageAssets(questionImages);
        var imageCount = questionImages.reduce(function (m, s) { return Math.max(m, s.length); }, 0);
        var headers = ['Número', 'Caderno', 'Código', 'Banca', 'Ano', 'Vaga', 'Órgão', 'Cargo', 'Matéria', 'Assunto', 'Questão ID', 'URL', 'Enunciado', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 'Alternativa E', 'Gabarito'];
        for (var i = 0; i < imageCount; i += 1) headers.push('Imagem ' + (i + 1));
        var rows = [headers];
        (entry.questions || []).forEach(function (question, index) {
            var alternatives = {};
            (question.options || []).forEach(function (o) { alternatives[o.letter] = o.text; });
            var tituloLinha = (config.porQuestao && question.cadernoTitulo) ? question.cadernoTitulo : entry.title;
            var codigoLinha = (config.porQuestao && question.cadernoId) ? question.cadernoId : entry.code;
            var row = [question.number || index + 1, tituloLinha, codigoLinha, question.bank, question.year, question.vacancy, question.organization, question.role, question.subject, question.topic, question.id, question.url, question.statement, alternatives.A, alternatives.B, alternatives.C, alternatives.D, alternatives.E, question.answer || question.gabarito];
            (questionImages[index] || []).forEach(function (source) {
                row.push(loadedImages.assets.has(source) ? '[imagem incorporada]' : source);
            });
            while (row.length < headers.length) row.push('');
            rows.push(row);
        });
        var worksheet = rows.map(function (row, rowIndex) {
            var cells = row.map(function (value, columnIndex) {
                var reference = columnName(columnIndex) + (rowIndex + 1);
                return '<c r="' + reference + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>';
            }).join('');
            return '<row r="' + (rowIndex + 1) + '">' + cells + '</row>';
        }).join('');
        var lastCell = columnName(rows[0].length - 1) + rows.length;
        var drawingImages = [];
        questionImages.forEach(function (sources, questionIndex) {
            sources.forEach(function (source, imageIndex) {
                var asset = loadedImages.assets.get(source);
                if (asset) drawingImages.push({ asset: asset, column: 19 + imageIndex * 2, row: questionIndex + 1 });
            });
        });
        var hasImages = drawingImages.length > 0;
        var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>';
        if (hasImages) {
            var contentTypeByExtension = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' };
            Array.from(new Set(loadedImages.embedded.map(function (im) { return im.extension; }))).forEach(function (ext) {
                contentTypes += '<Default Extension="' + ext + '" ContentType="' + contentTypeByExtension[ext] + '"/>';
            });
            contentTypes += '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
        }
        contentTypes += '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
        var worksheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' + (hasImages ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' : '') + '><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>' + worksheet + '</sheetData><autoFilter ref="A1:' + lastCell + '"/>' + (hasImages ? '<drawing r="rId1"/>' : '') + '</worksheet>';
        var files = [
            { name: '[Content_Types].xml', content: contentTypes },
            { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
            { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Questões" sheetId="1" r:id="rId1"/></sheets></workbook>' },
            { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
            { name: 'xl/worksheets/sheet1.xml', content: worksheetXml }
        ];
        if (hasImages) {
            files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>' });
            files.push({ name: 'xl/drawings/drawing1.xml', content: drawingXml(drawingImages) });
            files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', content: drawingRelationshipsXml(drawingImages) });
            loadedImages.embedded.forEach(function (im) { files.push({ name: 'xl/media/image' + im.mediaIndex + '.' + im.extension, content: im.bytes }); });
        }
        return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    function baixarHtmlCaderno(caderno) {
        var entry = entradaBiblioteca(caderno);
        var nome = safeFilename(entry.title || entry.code) + '-interativo.html';
        baixarBlob(nome, new Blob([buildInteractiveHtml(entry)], { type: 'text/html;charset=utf-8' }));
        log('HTML baixado: ' + nome);
    }

    async function baixarExcelCaderno(caderno) {
        var entry = entradaBiblioteca(caderno);
        var nome = safeFilename(entry.title || entry.code) + '.xlsx';
        UI.setStatus('Gerando Excel de "' + entry.title + '"...');
        var blob = await buildXlsxBlob(entry);
        baixarBlob(nome, blob);
        UI.setStatus('Excel baixado: ' + nome);
        log('Excel baixado: ' + nome);
    }

    function baixarJsonCaderno(caderno) {
        var nome = safeFilename(caderno.titulo || caderno.id) + '.json';
        baixarBlob(nome, new Blob([JSON.stringify(entradaBiblioteca(caderno), null, 2)], { type: 'application/json;charset=utf-8' }));
        log('JSON baixado: ' + nome);
    }

    /* ---- Categorias: agrupamento e exportação em pacote (ZIP) ---- */
    function categoriaDe(caderno) {
        return caderno && caderno.categoria ? caderno.categoria : 'Plano';
    }

    function cadernosPorCategoria() {
        var mapa = {};
        Object.keys(estado.biblioteca).forEach(function (id) {
            var cad = estado.biblioteca[id];
            var cat = categoriaDe(cad);
            (mapa[cat] = mapa[cat] || []).push(cad);
        });
        return mapa;
    }

    async function exportarCategoria(cat) {
        var lista = cadernosPorCategoria()[cat] || [];
        if (!lista.length) { UI.setStatus('Categoria "' + cat + '" sem cadernos.'); return; }
        UI.setStatus('Gerando pacote da categoria "' + cat + '"...');
        var questoes = [];
        lista.forEach(function (cad) {
            (cad.questoes || []).forEach(function (q) {
                questoes.push(Object.assign({}, q, { cadernoTitulo: cad.titulo, cadernoId: cad.id }));
            });
        });
        var entry = { id: 'categoria-' + cat, code: cat, title: cat, group: cat, questions: questoes };
        var base = safeFilename(cat);
        var files = [];
        files.push({ name: base + '.html', content: buildInteractiveHtml(entry) });
        files.push({ name: base + '.json', content: JSON.stringify(entry, null, 2) });
        var xlsx = await buildXlsxBlob(entry, { porQuestao: true });
        files.push({ name: base + '.xlsx', content: new Uint8Array(await xlsx.arrayBuffer()) });
        // HTMLs individuais de cada caderno da categoria
        lista.forEach(function (cad, i) {
            var e2 = entradaBiblioteca(cad);
            files.push({ name: String(i + 1).padStart(2, '0') + ' - ' + safeFilename(cad.titulo) + '.html', content: buildInteractiveHtml(e2) });
        });
        var zip = zipStore(files);
        baixarBlob(base + '.zip', new Blob([zip], { type: 'application/zip' }));
        UI.setStatus('Pacote "' + cat + '" baixado (' + questoes.length + ' questões em ' + files.length + ' arquivos).');
        log('Categoria "' + cat + '" exportada: ' + files.length + ' arquivos, ' + questoes.length + ' questões.');
    }

    var __TecFabricaExport = {
        normalizeExportFilters: normalizeExportFilters,
        filterExportQuestions: filterExportQuestions,
        formatQuestionAsTxt: formatQuestionAsTxt,
        buildTxtExport: buildTxtExport,
        buildInteractiveHtml: buildInteractiveHtml,
        buildXlsxBlob: buildXlsxBlob,
        zipStore: zipStore,
        crc32: crc32,
        mapWithConcurrency: mapWithConcurrency,
        readImageAsset: readImageAsset,
        fetchImageAsset: fetchImageAsset,
        loadImageAssets: loadImageAssets,
        clearImageCache: clearImageCache,
        imageFormat: imageFormat,
        decodeBase64: decodeBase64,
        imageSourcesFromHtml: imageSourcesFromHtml,
        questionImageSources: questionImageSources,
        columnName: columnName,
        xmlEscape: xmlEscape,
        escapeHtml: escapeHtml,
        jsJson: jsJson,
        safeFilename: safeFilename,
        baixarBlob: baixarBlob,
        baixarHtmlCaderno: baixarHtmlCaderno,
        baixarExcelCaderno: baixarExcelCaderno,
        baixarJsonCaderno: baixarJsonCaderno,
        entradaBiblioteca: entradaBiblioteca,
        exportarCategoria: exportarCategoria,
        cadernosPorCategoria: cadernosPorCategoria
    };
    // Exposição testável: no navegador (bundle) via window; em Node via
    // module.exports (require direto do fragmento). Dentro do bundle o
    // `window` existe e `module` não — o guard não altera o comportamento.
    if (typeof window !== 'undefined') {
        window.__TecFabricaExport = __TecFabricaExport;
    } else if (typeof module !== 'undefined' && module.exports) {
        module.exports = __TecFabricaExport;
    }

