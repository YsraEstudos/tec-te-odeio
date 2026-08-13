    /* =====================================================================
     * UI — painel "Fábrica de Cadernos" (dark, consistente com o projeto)
     * =================================================================== */
    var UI = {
        appendLog: function (msg) { },
        setStatus: function (msg) { },
        renderBiblioteca: function () { },
        renderProgresso: function () { },
        carregarPlano: function (texto) { },
        config: function () { return {}; }
    };

    var painelEl = null;
    var abaAtiva = 'plano';

    var UI_CSS = [
        '#tec-fabrica{position:fixed;top:70px;right:10px;z-index:999999;width:min(400px,calc(100vw - 20px));max-height:min(88vh,720px);display:flex;flex-direction:column;',
        'background:#0b1120;color:#e5e7eb;border:1px solid #1e293b;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.55);',
        'font:13px/1.5 system-ui,sans-serif;font-family:"Fira Sans","Segoe UI",sans-serif;user-select:none;overflow:hidden}',
        '#tec-fabrica *{box-sizing:border-box}',
        '#tec-fabrica .tf-header{display:flex;align-items:center;gap:8px;padding:11px 14px;background:#111827;border-bottom:1px solid #1f2937}',
        '#tec-fabrica .tf-logo{width:9px;height:9px;border-radius:50%;background:#22c55e;flex:none}',
        '#tec-fabrica .tf-logo.rodando{background:#f59e0b;animation:tf-pulse 1.2s infinite}',
        '#tec-fabrica .tf-logo.erro{background:#ef4444}',
        '#tec-fabrica .tf-logo.completo{background:#3b82f6}',
        '@keyframes tf-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
        '#tec-fabrica .tf-titulo{font-weight:700;font-size:13px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#tec-fabrica .tf-status-txt{font-size:11px;color:#94a3b8;white-space:nowrap}',
        '#tec-fabrica .tf-collapse{background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;padding:0 2px}',
        '#tec-fabrica .tf-collapse:hover{color:#e2e8f0}',
        '#tec-fabrica .tf-abas{display:flex;gap:2px;padding:6px 8px 0;background:#0f172a;border-bottom:1px solid #1f2937}',
        '#tec-fabrica .tf-aba{flex:1;text-align:center;padding:6px 4px;border:none;background:none;color:#94a3b8;cursor:pointer;font-size:11.5px;border-radius:7px 7px 0 0;border-bottom:2px solid transparent}',
        '#tec-fabrica .tf-aba:hover{color:#e2e8f0}',
        '#tec-fabrica .tf-aba.ativa{color:#60a5fa;border-bottom-color:#3b82f6;background:#111827}',
        '#tec-fabrica .tf-corpo{flex:1;overflow-y:auto;overflow-x:hidden;padding:12px}',
        '#tec-fabrica .tf-secao-titulo{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:10px 0 6px}',
        '#tec-fabrica .tf-secao-titulo:first-child{margin-top:0}',
        '#tec-fabrica textarea{width:100%;min-height:110px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px;font:12px/1.45 ui-monospace,Consolas,monospace;resize:vertical}',
        '#tec-fabrica textarea:focus{outline:none;border-color:#3b82f6}',
        '#tec-fabrica input[type=text],#tec-fabrica input[type=number]{background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:7px;padding:6px 8px;font:12px system-ui;width:100%}',
        '#tec-fabrica input:focus{outline:none;border-color:#3b82f6}',
        '#tec-fabrica .tf-btn{background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 12px;font:700 12px system-ui;cursor:pointer}',
        '#tec-fabrica .tf-btn:hover{background:#1d4ed8}',
        '#tec-fabrica .tf-btn.sec{background:#1f2937;color:#e2e8f0}',
        '#tec-fabrica .tf-btn.sec:hover{background:#374151}',
        '#tec-fabrica .tf-btn.perigo{background:#dc2626}',
        '#tec-fabrica .tf-btn.perigo:hover{background:#b91c1c}',
        '#tec-fabrica .tf-btn:disabled{opacity:.5;cursor:not-allowed}',
        '#tec-fabrica .tf-linha{display:flex;gap:8px;align-items:center;margin:6px 0}',
        '#tec-fabrica .tf-linha label{font-size:11.5px;color:#cbd5e1;flex:none}',
        '#tec-fabrica .tf-linha input[type=checkbox]{accent-color:#3b82f6}',
        '#tec-fabrica .tf-resumo{background:#111827;border:1px solid #1f2937;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#cbd5e1;margin:8px 0}',
        '#tec-fabrica .tf-resumo b{color:#e2e8f0}',
        '#tec-fabrica .tf-bar{height:8px;background:#1f2937;border-radius:99px;overflow:hidden;margin:4px 0 2px}',
        '#tec-fabrica .tf-bar > div{height:100%;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:99px;transition:width .3s ease}',
        '#tec-fabrica .tf-bar-label{font-size:10.5px;color:#94a3b8;display:flex;justify-content:space-between}',
        '#tec-fabrica .tf-status-msg{background:#111827;border:1px solid #1f2937;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#e2e8f0;margin:8px 0}',
        '#tec-fabrica .tf-status-msg.erro{border-color:#7f1d1d;background:#1c1017;color:#fca5a5}',
        '#tec-fabrica .tf-caderno{background:#111827;border:1px solid #1f2937;border-radius:9px;padding:9px 11px;margin-bottom:8px}',
        '#tec-fabrica .tf-cat{margin-bottom:14px}',
        '#tec-fabrica .tf-cat-titulo{font-weight:700;font-size:12.5px;color:#f8fafc;padding:7px 10px;background:#172554;border:1px solid #1e3a8a;border-radius:8px;margin-bottom:6px}',
        '#tec-fabrica .tf-cat-meta{font-weight:400;font-size:10.5px;color:#93c5fd;margin-left:6px}',
        '#tec-fabrica .tf-caderno .tf-c-titulo{font-weight:600;font-size:12px;color:#f1f5f9;margin-bottom:2px}',
        '#tec-fabrica .tf-caderno .tf-c-meta{font-size:10.5px;color:#94a3b8;margin-bottom:6px}',
        '#tec-fabrica .tf-caderno .tf-c-botoes{display:flex;gap:5px;flex-wrap:wrap}',
        '#tec-fabrica .tf-caderno .tf-btn{font-size:10.5px;padding:4px 8px;border-radius:6px}',
        '#tec-fabrica .tf-log{font:10.5px/1.5 ui-monospace,Consolas,monospace;color:#94a3b8;background:#0f172a;border:1px solid #1f2937;border-radius:8px;padding:8px;height:210px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}',
        '#tec-fabrica .tf-log .ok{color:#4ade80}',
        '#tec-fabrica .tf-log .warn{color:#fbbf24}',
        '#tec-fabrica .tf-log .err{color:#f87171}',
        '#tec-fabrica ::-webkit-scrollbar{width:8px}',
        '#tec-fabrica ::-webkit-scrollbar-thumb{background:#334155;border-radius:99px}',
        '#tec-fabrica .tf-vazio{color:#64748b;font-size:11.5px;text-align:center;padding:14px 0}',
        '#tec-fabrica .tf-plano-arvore { display:flex; flex-direction:column; gap:6px; margin-top:10px; overflow-x:hidden; }',
        '#tec-fabrica .tf-tree-node { border:1px solid #1e293b; border-radius:9px; background:#0f172a; overflow:hidden; }',
        '#tec-fabrica .tf-tree-node > summary { display:flex; align-items:center; gap:7px; min-height:38px; padding:8px 9px; color:#e2e8f0; cursor:pointer; list-style:none; user-select:none; word-break:break-word; }',
        '#tec-fabrica .tf-tree-node > summary::-webkit-details-marker { display:none; }',
        '#tec-fabrica .tf-tree-node > summary::before { content:""; width:7px; height:7px; flex:none; border-right:2px solid #60a5fa; border-bottom:2px solid #60a5fa; transform:rotate(-45deg); transition:transform 160ms ease; }',
        '#tec-fabrica .tf-tree-node[open] > summary::before { transform:rotate(45deg); }',
        '#tec-fabrica .tf-tree-node > summary:focus-visible { outline:2px solid #60a5fa; outline-offset:-2px; }',
        '#tec-fabrica .tf-tree-node[open] > summary { background:#172554; }',
        '#tec-fabrica .tf-tree-children { padding:0 7px 7px 16px; animation:tf-tree-in 220ms ease-out both; }',
        '#tec-fabrica .tf-tree-node > .tf-tree-node { margin:0 7px 7px 16px; }',
        '#tec-fabrica .tf-tree-label { flex:1; min-width:0; word-break:break-word; }',
        '#tec-fabrica .tf-tree-count, #tec-fabrica .tf-tree-meta { margin-left:auto; color:#93c5fd; font-size:10.5px; font-weight:400; text-align:right; word-break:break-word; }',
        '#tec-fabrica .tf-tree-leaf { padding:7px 9px 7px 25px; color:#cbd5e1; font-size:11.5px; line-height:1.4; border-top:1px solid #1e293b; word-break:break-word; }',
        '#tec-fabrica .tf-tree-leaf::before { content:""; display:inline-block; width:5px; height:5px; margin:0 7px 2px 0; border-radius:50%; background:#60a5fa; }',
        '@keyframes tf-tree-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }',
        '@media (prefers-reduced-motion: reduce) { #tec-fabrica *, #tec-fabrica *::before, #tec-fabrica *::after { animation-duration:.01ms !important; transition-duration:.01ms !important; } }'
    ].join('');

    function criarUI() {
        var style = document.createElement('style');
        style.textContent = UI_CSS;
        document.head.appendChild(style);

        painelEl = document.createElement('div');
        painelEl.id = 'tec-fabrica';
        painelEl.innerHTML =
            '<div class="tf-header">' +
            '  <span class="tf-logo" id="tf-logo"></span>' +
            '  <span class="tf-titulo">Fábrica de Cadernos v' + SCRIPT_VERSION + '</span>' +
            '  <span class="tf-status-txt" id="tf-status-txt">parado</span>' +
            '  <button class="tf-collapse" id="tf-collapse" title="Recolher">—</button>' +
            '</div>' +
            '<div class="tf-abas">' +
            '  <button class="tf-aba" data-aba="plano">Plano</button>' +
            '  <button class="tf-aba" data-aba="config">Config</button>' +
            '  <button class="tf-aba" data-aba="exec">Execução</button>' +
            '  <button class="tf-aba" data-aba="biblio">Biblioteca</button>' +
            '  <button class="tf-aba" data-aba="log">Log</button>' +
            '</div>' +
            '<div class="tf-corpo" id="tf-corpo"></div>';
        document.body.appendChild(painelEl);

        painelEl.querySelectorAll('.tf-aba').forEach(function (b) {
            b.addEventListener('click', function () { mostrarAba(b.getAttribute('data-aba')); });
        });
        painelEl.querySelector('#tf-collapse').addEventListener('click', function () {
            var corpo = painelEl.querySelector('#tf-corpo');
            corpo.style.display = corpo.style.display === 'none' ? '' : 'none';
            painelEl.querySelector('#tf-collapse').textContent = corpo.style.display === 'none' ? '+' : '—';
        });

        mostrarAba('plano');
    }

    function mostrarAba(aba) {
        abaAtiva = aba;
        painelEl.querySelectorAll('.tf-aba').forEach(function (b) {
            b.classList.toggle('ativa', b.getAttribute('data-aba') === aba);
        });
        var corpo = painelEl.querySelector('#tf-corpo');
        if (aba === 'plano') corpo.innerHTML = htmlPlano();
        else if (aba === 'config') corpo.innerHTML = htmlConfig();
        else if (aba === 'exec') corpo.innerHTML = htmlExecucao();
        else if (aba === 'biblio') corpo.innerHTML = htmlBiblioteca();
        else if (aba === 'log') corpo.innerHTML = htmlLog();
        ligarEventos(corpo);
    }

    /* ---- aba Plano ---- */
    function htmlPlano() {
        var p = estado.plano;
        var texto = PLANO_UI_MODEL.textoParaEdicao(estado);
        var arvore = PLANO_UI_MODEL.renderArvore(p);
        if (!p) arvore = '<div class="tf-vazio">Carregue um plano para visualizar a árvore.</div>';
        var resumo = p ? '<div class="tf-resumo"><b>' + p.matters.length + '</b> matérias · ' + p.banks.length + ' bancas · ' + p.years.length + ' anos · ' +
            (p.removeCancelled ? 'sem anuladas' : '') + (p.removeOutdated ? (p.removeCancelled ? ' e ' : '') + 'sem desatualizadas' : '') + '</div>' : '';
        return '<label class="tf-secao-titulo" for="tf-plano-texto">Plano de matérias (JSON)</label>' +
            '<textarea id="tf-plano-texto" placeholder=\'Cole aqui o conteúdo do mapeamento_de_materias.json\n\nEx: {"materias": [{"titulo": "Classes de palavras", "materias_tecconcursos": [{"codigo": 12519, "materia": "Língua Portuguesa (Português) > Morfologia > Classes de Palavras"}]}]}\'>' + escapeHtml(texto) + '</textarea>' +
            '<div class="tf-linha" style="justify-content:flex-end">' +
            '  <button class="tf-btn" id="tf-carregar">Carregar plano</button>' +
            '</div>' + resumo +
            '<div class="tf-plano-arvore">' + arvore + '</div>' +
            '<div id="tf-plano-aviso"></div>';
    }

    function htmlConfig() {
        var c = estado.config || {};
        return '<div class="tf-secao-titulo">Pasta de destino</div>' +
            '<div class="tf-linha"><input type="text" id="tf-pasta" placeholder="ID da pasta (ex: 6423024) ou abra a página de filtros dela" value="' + (c.folderId || pastaIdDaUrl()) + '"></div>' +
            '<div class="tf-secao-titulo">Lote e ritmo</div>' +
            '<div class="tf-linha"><label style="width:130px">Matérias por lote</label><input type="number" id="tf-lote" min="1" value="' + (c.batchSize || CONFIG.batchSize) + '"></div>' +
            '<div class="tf-linha"><label style="width:130px">Pausa entre ações (s)</label><input type="text" id="tf-delay" value="' + (c.delayMin || CONFIG.delayMin) / 1000 + '-' + (c.delayMax || CONFIG.delayMax) / 1000 + '" placeholder="3-6"></div>' +
            '<div class="tf-secao-titulo">Opções</div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-coletar" ' + ((c.coletarAposCriar !== false) ? 'checked' : '') + '><label>Copiar questões após criar cada caderno</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-auto" ' + (c.autoContinuarLote ? 'checked' : '') + '><label>Continuar lotes automaticamente</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-anuladas" ' + ((c.removeCancelled !== false) ? 'checked' : '') + '><label>Remover questões anuladas</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-desatualizadas" ' + ((c.removeOutdated !== false) ? 'checked' : '') + '><label>Remover questões desatualizadas</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-clique-gabarito" ' + ((c.usarCliqueGabarito !== false) ? 'checked' : '') + '><label>Clique para obter gabarito (necessário em questões novas)</label></div>' +
            '<div class="tf-secao-titulo">Impressão (saldo diário do site)</div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-usar-impressao" ' + ((c.usarImpressao !== false) ? 'checked' : '') + '><label>Usar impressão antes do clique</label></div>' +
            '<div class="tf-linha"><label style="width:130px">Teto por dia (questões)</label><input type="number" id="tf-impressao-limite" min="1" value="' + (c.impressaoLimiteDia || CONFIG.impressaoLimiteDia) + '"></div>' +
            '<div class="tf-linha"><label style="width:130px">Usadas hoje</label><span id="tf-impressao-usadas" style="color:#94a3b8;font-size:11.5px">' + (estado.impressao ? estado.impressao.usadas || 0 : 0) + '</span></div>' +
            '<div class="tf-secao-titulo">Bancas (uma por linha)</div>' +
            '<textarea id="tf-bancas" style="min-height:80px">' + (c.banks || CONFIG.banks).join('\n') + '</textarea>' +
            '<div class="tf-secao-titulo">Anos (separados por vírgula)</div>' +
            '<input type="text" id="tf-anos" value="' + (c.years || CONFIG.years).join(', ') + '">' +
            '<div class="tf-linha" style="justify-content:flex-end;margin-top:10px">' +
            '  <button class="tf-btn" id="tf-salvar-config">Salvar configuração</button>' +
            '</div><div id="tf-config-aviso"></div>';
    }

    function htmlExecucao() {
        var p = estado.plano;
        var c = estado.config;
        if (!p) return '<div class="tf-vazio">Carregue o plano na aba Plano.</div>';
        var total = p.matters.length;
        var idx = Math.min(estado.planIndex, total);
        var pct = total ? Math.round(idx / total * 100) : 0;
        var loteFim = estado.loteFim || (c ? Math.min(c.batchSize, total) : total);
        var lotePct = (loteFim - estado.loteInicio) > 0 ? Math.round((idx - estado.loteInicio) / (loteFim - estado.loteInicio) * 100) : 100;
        var materiaAtual = idx < total ? p.matters[idx].title : '—';
        var cad = estado.cadernoAtual;
        var cadPct = 0, cadLabel = '';
        if (cad && cad.total) {
            cadPct = Math.round((cad.coletadas || 0) / cad.total * 100);
            cadLabel = cad.titulo + ' — ' + (cad.coletadas || 0) + '/' + cad.total + ' questões';
        }
        var faseTxt = { 'filtros': 'aplicando filtros', 'criando': 'criando caderno', 'coletando': 'copiando questões', 'nenhuma': '—' }[estado.fase] || estado.fase;
        var msgErro = estado.erro ? '<div class="tf-status-msg erro">' + escapeHtml(estado.erro) + '</div>' : '';
        var msg = estado.mensagem ? '<div class="tf-status-msg">' + escapeHtml(estado.mensagem) + '</div>' : '';
        var rodando = estado.status === 'rodando';
        return '<div class="tf-status-msg" id="tf-msg">' + escapeHtml(faseTxt) + (estado.cadernoAtual ? ' · ' + escapeHtml(estado.cadernoAtual.titulo) : '') + '</div>' + msg + msgErro +
            '<div class="tf-secao-titulo">Progresso do plano</div>' +
            '<div class="tf-bar"><div style="width:' + pct + '%"></div></div>' +
            '<div class="tf-bar-label"><span>' + idx + ' de ' + total + ' matérias</span><span>' + pct + '%</span></div>' +
            '<div class="tf-secao-titulo">Lote atual (matérias ' + (estado.loteInicio + 1) + '–' + loteFim + ')</div>' +
            '<div class="tf-bar"><div style="width:' + Math.max(0, lotePct) + '%"></div></div>' +
            '<div class="tf-bar-label"><span>Atual: ' + escapeHtml(materiaAtual) + '</span><span>' + Math.max(0, lotePct) + '%</span></div>' +
            (cad ? '<div class="tf-secao-titulo">Caderno em andamento</div>' +
                '<div class="tf-bar"><div style="width:' + cadPct + '%"></div></div>' +
                '<div class="tf-bar-label"><span>' + escapeHtml(cadLabel) + '</span><span>' + cadPct + '%</span></div>' : '') +
            '<div class="tf-linha" style="justify-content:center;gap:8px;margin-top:14px">' +
            (rodando
                ? '<button class="tf-btn perigo" id="tf-parar">⏸ Pausar</button>'
                : '<button class="tf-btn" id="tf-iniciar">▶ Iniciar / Continuar</button>') +
            '</div>' +
            '<div id="tf-exec-aviso"></div>';
    }

    function htmlBiblioteca() {
        var cats = cadernosPorCategoria();
        var nomes = Object.keys(cats).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
        if (!nomes.length) return '<div class="tf-vazio">Nenhum caderno criado ainda. Rode o plano ou clique em Copiar dentro de um caderno.</div>';
        return nomes.map(function (cat) {
            var lista = cats[cat];
            var totalQ = lista.reduce(function (s, c) { return s + (c.questoes ? c.questoes.length : 0); }, 0);
            var completos = lista.filter(function (c) { return c.completo; }).length;
            var cards = lista.map(function (b) {
                var n = b.questoes ? b.questoes.length : 0;
                var pct = b.total ? Math.round(n / b.total * 100) : 0;
                return '<div class="tf-caderno">' +
                    '<div class="tf-c-titulo">' + escapeHtml(b.titulo) + '</div>' +
                    '<div class="tf-c-meta">Caderno #' + b.id + ' · ' + n + '/' + (b.total || '?') + ' questões · ' + (b.completo ? 'completo' : (n ? 'em andamento' : 'criado')) + '</div>' +
                    '<div class="tf-bar"><div style="width:' + pct + '%"></div></div>' +
                    '<div class="tf-c-botoes" style="margin-top:6px">' +
                    '  <button class="tf-btn sec" data-acao="copiar" data-id="' + b.id + '">📋 Copiar questões</button>' +
                    '  <button class="tf-btn sec" data-acao="html" data-id="' + b.id + '"' + (n ? '' : ' disabled') + '>HTML</button>' +
                    '  <button class="tf-btn sec" data-acao="excel" data-id="' + b.id + '"' + (n ? '' : ' disabled') + '>Excel</button>' +
                    '  <button class="tf-btn sec" data-acao="json" data-id="' + b.id + '"' + (n ? '' : ' disabled') + '>JSON</button>' +
                    '</div></div>';
            }).join('');
            return '<div class="tf-cat">' +
                '<div class="tf-cat-titulo">' + escapeHtml(cat) +
                ' <span class="tf-cat-meta">' + lista.length + ' cadernos · ' + completos + ' completos · ' + totalQ + ' questões</span></div>' +
                '<div class="tf-linha" style="margin:4px 0 8px">' +
                '  <button class="tf-btn" data-acao="categoria" data-cat="' + escapeHtml(cat) + '"' + (totalQ ? '' : ' disabled') + '>📦 Baixar categoria (ZIP)</button>' +
                '</div>' + cards + '</div>';
        }).join('');
    }

    function htmlLog() {
        return '<div class="tf-log" id="tf-log-box">' + ultimasLinhasLog.join('\n') + '</div>';
    }

    var ultimasLinhasLog = [];
    function anexarLog(msg) {
        var t = new Date().toLocaleTimeString('pt-BR') + ' ' + msg;
        ultimasLinhasLog.push(escapeHtml(t));
        if (ultimasLinhasLog.length > 200) ultimasLinhasLog.shift();
        var box = document.getElementById('tf-log-box');
        if (box) {
            box.innerHTML = ultimasLinhasLog.join('\n');
            box.scrollTop = box.scrollHeight;
        }
    }

    function ligarEventos(corpo) {
        var carregar = corpo.querySelector('#tf-carregar');
        if (carregar) carregar.addEventListener('click', function () {
            var texto = corpo.querySelector('#tf-plano-texto').value;
            var aviso = corpo.querySelector('#tf-plano-aviso');
            try {
                var plano = PLANO_UI_MODEL.carregarPlano(texto, normalizarPlano, estado);
                if (!estado.config) {
                    estado.config = {
                        folderId: pastaIdDaUrl() || '',
                        batchSize: CONFIG.batchSize,
                        delayMin: CONFIG.delayMin,
                        delayMax: CONFIG.delayMax,
                        coletarAposCriar: CONFIG.coletarAposCriar,
                        autoContinuarLote: CONFIG.autoContinuarLote,
                        removeCancelled: CONFIG.removeCancelled,
                        removeOutdated: CONFIG.removeOutdated,
                        banks: CONFIG.banks.slice(),
                        years: CONFIG.years.slice()
                    };
                }
                salvarEstado(true);
                mostrarAba('plano');
                var avisoAtual = painelEl.querySelector('#tf-plano-aviso');
                avisoAtual.innerHTML = '<div class="tf-resumo" style="border-color:#166534;background:#052e16;color:#bbf7d0">Plano carregado: <b>' + plano.matters.length + '</b> matérias</div>';
                log('Plano carregado: ' + plano.matters.length + ' matérias, ' + plano.banks.length + ' bancas, ' + plano.years.length + ' anos.');
            } catch (e) {
                aviso.innerHTML = '<div class="tf-status-msg erro"><b>Erro ao carregar o plano:</b> ' + escapeHtml(e.message) + '</div>';
            }
        });

        var salvar = corpo.querySelector('#tf-salvar-config');
        if (salvar) salvar.addEventListener('click', function () {
            var aviso = corpo.querySelector('#tf-config-aviso');
            try {
                var cfg = estado.config || {};
                cfg.folderId = clean(corpo.querySelector('#tf-pasta').value);
                cfg.batchSize = Math.max(1, parseInt(corpo.querySelector('#tf-lote').value, 10) || CONFIG.batchSize);
                var delayTxt = corpo.querySelector('#tf-delay').value.split('-');
                cfg.delayMin = Math.max(500, parseInt(delayTxt[0], 10) * 1000 || CONFIG.delayMin);
                cfg.delayMax = Math.max(cfg.delayMin, parseInt(delayTxt[1], 10) * 1000 || CONFIG.delayMax);
                cfg.coletarAposCriar = corpo.querySelector('#tf-coletar').checked;
                cfg.autoContinuarLote = corpo.querySelector('#tf-auto').checked;
                cfg.removeCancelled = corpo.querySelector('#tf-anuladas').checked;
                cfg.removeOutdated = corpo.querySelector('#tf-desatualizadas').checked;
                cfg.usarCliqueGabarito = corpo.querySelector('#tf-clique-gabarito').checked;
                cfg.usarImpressao = corpo.querySelector('#tf-usar-impressao').checked;
                cfg.impressaoLimiteDia = Math.max(1, parseInt(corpo.querySelector('#tf-impressao-limite').value, 10) || CONFIG.impressaoLimiteDia);
                cfg.banks = corpo.querySelector('#tf-bancas').value.split('\n').map(clean).filter(Boolean);
                cfg.years = corpo.querySelector('#tf-anos').value.split(',').map(function (y) { return parseInt(y, 10); }).filter(function (y) { return y >= 1900 && y <= 2100; });
                if (cfg.banks.length < 1) throw new Error('Informe ao menos uma banca.');
                if (cfg.years.length < 1) throw new Error('Informe ao menos um ano.');
                CONFIG.delayMin = cfg.delayMin;
                CONFIG.delayMax = cfg.delayMax;
                estado.config = cfg;
                salvarEstado();
                aviso.innerHTML = '<div class="tf-resumo" style="border-color:#166534;background:#052e16;color:#bbf7d0">Configuração salva</div>';
                log('Configuração salva: pasta ' + (cfg.folderId || '(vazio)') + ', lote ' + cfg.batchSize + ', ' + cfg.banks.length + ' bancas, ' + cfg.years.length + ' anos.');
            } catch (e) {
                aviso.innerHTML = '<div class="tf-status-msg erro">' + escapeHtml(e.message) + '</div>';
            }
        });

        var iniciar = corpo.querySelector('#tf-iniciar');
        if (iniciar) iniciar.addEventListener('click', function () { continuar(); });
        var btnParar = corpo.querySelector('#tf-parar');
        if (btnParar) btnParar.addEventListener('click', parar);

        corpo.querySelectorAll('[data-acao]').forEach(function (b) {
            b.addEventListener('click', function () {
                var acao = b.getAttribute('data-acao');
                if (acao === 'categoria') {
                    var cat = b.getAttribute('data-cat');
                    exportarCategoria(cat);
                    return;
                }
                var id = b.getAttribute('data-id');
                var caderno = estado.biblioteca[id];
                if (!caderno) return;
                if (acao === 'copiar') copiarCadernoSobDemanda(caderno);
                else if (acao === 'html') baixarHtmlCaderno(caderno);
                else if (acao === 'excel') baixarExcelCaderno(caderno);
                else if (acao === 'json') baixarJsonCaderno(caderno);
            });
        });
    }

    /* Copiar sob demanda (botão da biblioteca): navega até o caderno e coleta.
       A navegação encerra a execução; o auto-resume retoma pela fase 'coletando'. */
    async function retomarColetaSobDemanda(caderno) {
        if (estado.status !== 'rodando') return;
        if (paginaAtual() !== 'caderno' || cadernoIdDaUrl() !== caderno.id) {
            estado.fase = 'coletando';
            estado.cadernoAtual = caderno;
            estado.mensagem = 'Abrindo caderno ' + caderno.id + '...';
            salvarEstado();
            UI.setStatus(estado.mensagem);
            irPara(location.origin + '/questoes/cadernos/' + caderno.id); // navega → boot retoma
            return;
        }
        estado.cadernoAtual = caderno;
        estado.fase = 'coletando';
        salvarEstado();
        UI.renderProgresso();
        try {
            await coletarCaderno(caderno);
            estado.cadernoAtual = null;
            estado.fase = 'nenhuma';
            estado.status = 'parado';
            salvarEstado();
            UI.renderBiblioteca();
            UI.renderProgresso();
            UI.setStatus('Caderno "' + caderno.titulo + '" copiado (' + caderno.questoes.length + ' questões).');
        } catch (e) {
            estado.status = 'erro';
            estado.erro = String(e && e.message || e);
            estado.fase = 'nenhuma';
            salvarEstado();
            log('ERRO ao copiar: ' + estado.erro);
            UI.renderProgresso();
        }
    }

    async function copiarCadernoSobDemanda(caderno) {
        if (estado.status === 'rodando') { UI.setStatus('Já existe uma execução rodando.'); return; }
        estado.status = 'rodando';
        estado.modo = 'sob-demanda';
        estado.retomada = false;
        estado.erro = null;
        salvarEstado();
        retomarColetaSobDemanda(caderno);
    }

    /* ---- implementação dos hooks da UI ---- */
    UI.appendLog = function (msg) { anexarLog(msg); };
    UI.setStatus = function (msg) {
        estado.mensagem = msg;
        salvarEstado();
        var el = document.getElementById('tf-msg');
        if (el) el.textContent = msg;
    };
    UI.renderProgresso = function () {
        if (!painelEl) return;
        var statusTxt = { 'parado': 'parado', 'rodando': 'rodando', 'pausado': 'pausado', 'completo': 'concluído', 'erro': 'erro' }[estado.status] || estado.status;
        var st = painelEl.querySelector('#tf-status-txt');
        if (st) st.textContent = statusTxt;
        var logo = painelEl.querySelector('#tf-logo');
        if (logo) {
            logo.className = 'tf-logo' + (estado.status === 'rodando' ? ' rodando' : (estado.status === 'erro' ? ' erro' : (estado.status === 'completo' ? ' completo' : '')));
        }
        if (abaAtiva === 'exec') mostrarAba('exec');
    };
    UI.renderBiblioteca = function () {
        if (!painelEl) return;
        if (abaAtiva === 'biblio') mostrarAba('biblio');
    };

