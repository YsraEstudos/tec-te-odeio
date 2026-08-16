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
        '#tec-fabrica .tf-quick{background:#1f2937;border:1px solid #334155;color:#e2e8f0;border-radius:7px;cursor:pointer;font-size:12px;line-height:1;padding:5px 7px;min-width:28px}',
        '#tec-fabrica .tf-quick:hover{background:#374151;border-color:#475569}',
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
        '#tec-fabrica .tf-log-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:7px}',
        '#tec-fabrica .tf-log-count{flex:1;min-width:150px;color:#94a3b8;font-size:10.5px}',
        '#tec-fabrica .tf-log-event{border:1px solid #1e293b;border-left:3px solid #64748b;border-radius:7px;background:#111827;padding:6px 7px;margin-bottom:5px;white-space:normal}',
        '#tec-fabrica .tf-log-event.ok{border-left-color:#22c55e}',
        '#tec-fabrica .tf-log-event.info{border-left-color:#60a5fa}',
        '#tec-fabrica .tf-log-event.warn{border-left-color:#f59e0b}',
        '#tec-fabrica .tf-log-event.erro{border-left-color:#ef4444}',
        '#tec-fabrica .tf-log-meta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;color:#64748b;font-size:9.5px;line-height:1.3}',
        '#tec-fabrica .tf-log-badge{border-radius:4px;padding:1px 4px;background:#1e293b;color:#cbd5e1;font-weight:700}',
        '#tec-fabrica .tf-log-event.ok .tf-log-badge{color:#86efac;background:#14532d}',
        '#tec-fabrica .tf-log-event.warn .tf-log-badge{color:#fde68a;background:#78350f}',
        '#tec-fabrica .tf-log-event.erro .tf-log-badge{color:#fecaca;background:#7f1d1d}',
        '#tec-fabrica .tf-log-message{display:block;color:#e2e8f0;font:10.5px/1.45 ui-monospace,Consolas,monospace;word-break:break-word;margin-top:3px}',
        '#tec-fabrica .tf-log-context{display:block;color:#93c5fd;font:9.5px/1.35 ui-monospace,Consolas,monospace;word-break:break-word;margin-top:3px;white-space:pre-wrap}',
        '#tec-fabrica .tf-log{font:10.5px/1.5 ui-monospace,Consolas,monospace;color:#94a3b8;background:#0f172a;border:1px solid #1f2937;border-radius:8px;padding:8px;height:330px;overflow-y:auto;white-space:normal;word-break:break-word}',
        '#tec-fabrica ::-webkit-scrollbar{width:8px}',
        '#tec-fabrica ::-webkit-scrollbar-thumb{background:#334155;border-radius:99px}',
        '#tec-fabrica .tf-vazio{color:#64748b;font-size:11.5px;text-align:center;padding:14px 0}',
        '#tec-fabrica .tf-plano-arvore { display:flex; flex-direction:column; gap:6px; margin-top:10px; overflow-x:hidden; }',
        '#tec-fabrica .tf-tree-node { border:1px solid #1e293b; border-radius:9px; background:#0f172a; overflow:hidden; }',
        '#tec-fabrica .tf-tree-node > summary { display:flex; align-items:center; gap:7px; min-height:38px; padding:8px 9px; color:#e2e8f0; cursor:pointer; list-style:none; user-select:none; word-break:break-word; }',
        '#tec-fabrica .tf-tree-node > summary::-webkit-details-marker { display:none; }',
        '#tec-fabrica .tf-tree-chevron { width:10px; height:10px; flex:none; color:#60a5fa; transition:transform 160ms ease; }',
        '#tec-fabrica .tf-tree-node[open] > summary .tf-tree-chevron { transform:rotate(90deg); }',
        '#tec-fabrica .tf-tree-node > summary:focus-visible { outline:2px solid #60a5fa; outline-offset:-2px; }',
        '#tec-fabrica .tf-tree-node[open] > summary { background:#172554; }',
        '#tec-fabrica .tf-tree-children { padding:0 7px 7px 16px; animation:tf-tree-in 220ms ease-out both; }',
        '#tec-fabrica .tf-tree-node > .tf-tree-node { margin:0 7px 7px 16px; }',
        '#tec-fabrica .tf-tree-label { flex:1; min-width:0; word-break:break-word; }',
        '#tec-fabrica .tf-tree-count, #tec-fabrica .tf-tree-meta { margin-left:auto; color:#93c5fd; font-size:10.5px; font-weight:400; text-align:right; word-break:break-word; }',
        '#tec-fabrica .tf-tree-leaf { padding:7px 9px 7px 25px; color:#cbd5e1; font-size:11.5px; line-height:1.4; border-top:1px solid #1e293b; word-break:break-word; }',
        '#tec-fabrica .tf-tree-leaf::before { content:""; display:inline-block; width:5px; height:5px; margin:0 7px 2px 0; border-radius:50%; background:#60a5fa; }',
        '#tec-fabrica .tf-tree-badge{font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:99px;white-space:nowrap;flex:none}',
        '#tec-fabrica .tf-tree-badge-atual{background:#1e3a8a;color:#93c5fd;border:1px solid #3b82f6}',
        '#tec-fabrica .tf-tree-badge-concluida{background:#052e16;color:#86efac;border:1px solid #16a34a}',
        '#tec-fabrica .tf-tree-badge-andamento{background:#78350f;color:#fde68a;border:1px solid #d97706}',
        '#tec-fabrica .tf-tree-badge-processada{background:#1e293b;color:#94a3b8;border:1px solid #334155}',
        '#tec-fabrica .tf-tree-badge-pendente{background:#1e293b;color:#64748b;border:1px solid #1e293b}',
        '#tec-fabrica .tf-tree-acao{background:#1f2937;border:1px solid #334155;color:#e2e8f0;border-radius:6px;cursor:pointer;font-size:10px;line-height:1;padding:3px 5px;flex:none}',
        '#tec-fabrica .tf-tree-acao:hover{background:#374151;border-color:#60a5fa}',
        '@keyframes tf-tree-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }',
        '@media (prefers-reduced-motion: reduce) { #tec-fabrica *, #tec-fabrica *::before, #tec-fabrica *::after { animation:none !important; animation-duration:.01ms !important; transition-duration:.01ms !important; } }'
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
            '  <button class="tf-quick" id="tf-quick-toggle" type="button" title="Pausar ou continuar">⏯</button>' +
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
        painelEl.querySelector('#tf-quick-toggle').addEventListener('click', function () {
            estado.status === 'rodando' ? parar() : continuar();
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
    function statusMaterias(estado) {
        var mapa = {};
        var plano = estado.plano;
        if (!plano || !Array.isArray(plano.matters)) return mapa;
        var ativo = estado.status === 'rodando' || estado.status === 'pausado';
        plano.matters.forEach(function (m, i) {
            var caderno = acharCadernoPorTitulo(m.title);
            var tipo, rotulo;
            if (i === estado.planIndex) { tipo = 'atual'; rotulo = ativo ? 'em execução' : 'próxima'; }
            else if (caderno && caderno.completo === true) { tipo = 'concluida'; rotulo = 'concluída'; }
            else if (caderno && Array.isArray(caderno.questoes) && caderno.questoes.length) { tipo = 'andamento'; rotulo = 'em andamento'; }
            else if (i < estado.planIndex) { tipo = 'processada'; rotulo = 'processada'; }
            else { tipo = 'pendente'; rotulo = 'pendente'; }
            mapa[i] = { tipo: tipo, rotulo: rotulo, temCaderno: !!caderno };
        });
        return mapa;
    }

    function htmlPlano() {
        var p = estado.plano;
        var texto = PLANO_UI_MODEL.textoParaEdicao(estado);
        var arvore = PLANO_UI_MODEL.renderArvore(p, statusMaterias(estado));
        var materias = p && Array.isArray(p.matters) ? p.matters : [];
        var categorias = p ? PLANO_UI_MODEL.agruparPorCategoria(p) : [];
        var assuntos = materias.reduce(function (total, materia) {
            var codigos = Array.isArray(materia.subjectIds) ? materia.subjectIds.length : 0;
            var caminhos = Array.isArray(materia.subjectPaths) ? materia.subjectPaths.length : 0;
            return total + Math.max(codigos, caminhos);
        }, 0);
        function quantidade(quantidade, singular, plural) {
            return quantidade + ' ' + (quantidade === 1 ? singular : plural);
        }
        if (!p) arvore = '<div class="tf-vazio">Carregue um plano para visualizar a árvore.</div>';
        var resumo = p ? '<div class="tf-resumo tf-plano-resumo"><b>' + escapeHtml(p.name || 'Plano sem nome') + '</b> · ' +
            quantidade(materias.length, 'matéria', 'matérias') + ' · ' + quantidade(categorias.length, 'categoria', 'categorias') + ' · ' + quantidade(assuntos, 'assunto', 'assuntos') + '</div>' : '';
        return resumo + '<label class="tf-secao-titulo" for="tf-plano-texto">Plano de matérias (JSON)</label>' +
            '<textarea id="tf-plano-texto" placeholder=\'Cole aqui o conteúdo do mapeamento_de_materias.json\n\nEx: {"materias": [{"titulo": "Classes de palavras", "materias_tecconcursos": [{"codigo": 12519, "materia": "Língua Portuguesa (Português) > Morfologia > Classes de Palavras"}]}]}\'>' + escapeHtml(texto) + '</textarea>' +
            '<div class="tf-linha" style="justify-content:flex-end">' +
            '  <button class="tf-btn" id="tf-carregar">Carregar plano</button>' +
            '</div>' +
            '<div class="tf-plano-arvore" id="tf-plano-arvore">' + arvore + '</div>' +
            '<div id="tf-plano-aviso"></div>';
    }

    function htmlConfig() {
        var c = estado.config || {};
        var modoAtual = c.modoColeta || c.modoOperacao || 'stealth-offline';
        var perfilAtual = c.perfilStealth || 'ultra-furtivo';
        var modoCriacaoAtual = c.modoCriacao || 'padrao';
        return '<div class="tf-secao-titulo">Pasta de destino</div>' +
            '<div class="tf-linha"><input type="text" id="tf-pasta" placeholder="ID da pasta (ex: 6423024) ou abra a página de filtros dela" value="' + (c.folderId || pastaIdDaUrl()) + '"></div>' +
            '<div class="tf-secao-titulo">Lote e ritmo</div>' +
            '<div class="tf-linha"><label style="width:130px">Matérias por lote</label><input type="number" id="tf-lote" min="1" value="' + (c.batchSize || CONFIG.batchSize) + '"></div>' +
            '<div class="tf-linha"><label style="width:130px">Pausa entre ações (s)</label><input type="text" id="tf-delay" value="' + (c.delayMin || CONFIG.delayMin) / 1000 + '-' + (c.delayMax || CONFIG.delayMax) / 1000 + '" placeholder="3-6"></div>' +
            '<div class="tf-secao-titulo">Fluxo de execução</div>' +
            '<div class="tf-linha"><select id="tf-modo-criacao">' +
            '<option value="padrao"' + (modoCriacaoAtual === 'padrao' ? ' selected' : '') + '>Padrão — cria e coleta matéria por matéria</option>' +
            '<option value="criar-tudo"' + (modoCriacaoAtual === 'criar-tudo' ? ' selected' : '') + '>Criar todos os cadernos primeiro, depois coletar as questões</option>' +
            '</select></div>' +
            '<div class="tf-resumo">No modo "Criar tudo primeiro", a execução passa duas vezes pelo plano: na 1ª passada cria todos os cadernos (sem coletar); na 2ª passada coleta as questões de todos os cadernos.</div>' +
            '<div class="tf-secao-titulo">Modo de Operação e Coleta</div>' +
            '<div class="tf-linha"><select id="tf-modo-coleta">' +
            '<option value="stealth-offline"' + (modoAtual === 'stealth-offline' ? ' selected' : '') + '>🛡️ Coleta Furtiva Offline (Sem Resolução / Gabarito Passivo)</option>' +
            '<option value="com-gabarito"' + (modoAtual === 'com-gabarito' ? ' selected' : '') + '>✍️ Padrão com Gabarito (Resolve na página / Cota 1.200)</option>' +
            '<option value="sem-gabarito-manual"' + (modoAtual === 'sem-gabarito-manual' ? ' selected' : '') + '>🖐️ Manual/offline — sem gabarito</option>' +
            '</select></div>' +
            '<div class="tf-linha"><label style="width:130px">Perfil de Leitura</label><select id="tf-perfil-stealth">' +
            '<option value="ultra-furtivo"' + (perfilAtual === 'ultra-furtivo' ? ' selected' : '') + '>Ultra Furtivo (220 WPM · Rolagem + Descanso)</option>' +
            '<option value="leitura-dinamica"' + (perfilAtual === 'leitura-dinamica' ? ' selected' : '') + '>Leitura Dinâmica (350 WPM · Rápido Seguro)</option>' +
            '</select></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-coffee-break" ' + (c.stealthCoffeeBreakAtivo !== false ? 'checked' : '') + '><label>Pausas biológicas periódicas (Coffee Break)</label></div>' +
            '<div class="tf-resumo">O Modo Furtivo Offline simula a velocidade real de leitura humana (WPM) e rolagem suave, sem enviar resoluções nem consumir cota diária.</div>' +
            '<div class="tf-secao-titulo">Opções avançadas</div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-coletar" ' + ((c.coletarAposCriar !== false) ? 'checked' : '') + '><label>Copiar questões após criar cada caderno</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-auto" ' + (c.autoContinuarLote ? 'checked' : '') + '><label>Continuar lotes automaticamente</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-anuladas" ' + ((c.removeCancelled !== false) ? 'checked' : '') + '><label>Remover questões anuladas</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-desatualizadas" ' + ((c.removeOutdated !== false) ? 'checked' : '') + '><label>Remover questões desatualizadas</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-clique-gabarito" ' + ((c.usarCliqueGabarito !== false) ? 'checked' : '') + '><label>Clique para obter gabarito (apenas no modo Com Gabarito)</label></div>' +
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
        var diario = resumoResolucoesDiarias(estado);
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
        var modoLabel = (c && (c.modoOperacao === 'stealth-offline' || c.modoColeta === 'stealth-offline')) ? '🛡️ Modo Furtivo Offline' : ((c && c.modoColeta === 'sem-gabarito-manual') ? '🖐️ Manual Offline' : '✍️ Com Resolução');
        var passadaLabel = (c && c.modoCriacao === 'criar-tudo')
            ? (estado.passada === 'coleta' ? '🔄 Passada 2/2 · coletando questões' : '🛠️ Passada 1/2 · criando cadernos')
            : '';
        return '<div class="tf-status-msg" id="tf-msg">' + escapeHtml(faseTxt) + (estado.cadernoAtual ? ' · ' + escapeHtml(estado.cadernoAtual.titulo) : '') + ' · <small>' + modoLabel + (passadaLabel ? ' · ' + passadaLabel : '') + '</small></div>' + msg + msgErro +
            '<div class="tf-status-msg" id="tf-limite-diario">Resoluções hoje: ' + diario.usadas + '/' + diario.limite + ' · Restam ' + diario.restantes + '</div>' +
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
        var salvarAtual = estado.config && estado.config.modoColeta === 'sem-gabarito-manual' && paginaAtual() === 'caderno' && document.querySelector('article.questao-enunciado')
            ? '<div class="tf-resumo"><b>Manual/offline — sem gabarito</b><br>Salva somente a questão atualmente visível; não executa cliques automáticos nem navegação.<br><button class="tf-btn sec" data-acao="salvar-sem-gabarito">Salvar questão sem gabarito</button></div>'
            : '';
        if (!nomes.length) return salvarAtual + '<div class="tf-vazio">Nenhum caderno criado ainda. Rode o plano ou clique em Copiar dentro de um caderno.</div>';
        return salvarAtual + nomes.map(function (cat) {
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
                    '  <button class="tf-btn sec" data-acao="txt" data-id="' + b.id + '"' + (n ? '' : ' disabled') + '>TXT</button>' +
                    '  <button class="tf-btn sec" data-acao="pdf" data-id="' + b.id + '"' + (n ? '' : ' disabled') + '>PDF / Imprimir</button>' +
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
        var logs = Array.isArray(estado.logs) ? estado.logs : [];
        var visiveis = Math.min(logs.length, 300);
        return '<div class="tf-log-toolbar">' +
            '<span class="tf-log-count">Eventos persistidos: <b>' + logs.length + '</b> · mostrando ' + visiveis + '</span>' +
            '<button class="tf-btn sec" id="tf-log-copiar" type="button">Copiar</button>' +
            '<button class="tf-btn sec" id="tf-log-limpar" type="button">Limpar</button>' +
            '</div>' +
            '<div class="tf-log" id="tf-log-box">' + renderEventosLog(logs) + '</div>';
    }

    function renderEventoLog(evento) {
        var e = evento || {};
        var nivel = /^(ok|info|warn|erro)$/.test(String(e.nivel || '')) ? String(e.nivel) : 'info';
        var tipo = escapeHtml(e.tipo || 'evento');
        var fase = escapeHtml(e.fase || 'nenhuma');
        var quando = escapeHtml(e.at || '');
        var mensagem = escapeHtml(e.mensagem || '');
        var contexto = '';
        if (e.contexto !== undefined && e.contexto !== null) {
            try { contexto = '<span class="tf-log-context">' + escapeHtml(JSON.stringify(e.contexto)) + '</span>'; }
            catch (err) { contexto = '<span class="tf-log-context">[contexto indisponível]</span>'; }
        }
        return '<article class="tf-log-event ' + nivel + '">' +
            '<div class="tf-log-meta"><span class="tf-log-badge">' + escapeHtml(nivel.toUpperCase()) + '</span>' +
            '<span>' + tipo + '</span><span>fase: ' + fase + '</span><span>' + quando + '</span></div>' +
            '<span class="tf-log-message">' + mensagem + '</span>' + contexto + '</article>';
    }

    function renderEventosLog(logs) {
        var lista = Array.isArray(logs) ? logs.slice(-300) : [];
        return lista.map(renderEventoLog).join('') || '<div class="tf-vazio">Nenhum evento registrado.</div>';
    }

    function textoCompletoLog() {
        var logs = Array.isArray(estado.logs) ? estado.logs : [];
        return logs.map(function (evento) {
            return typeof formatarEventoLog === 'function' ? formatarEventoLog(evento) : JSON.stringify(evento);
        }).join('\n');
    }

    function anexarLog(evento) {
        var box = document.getElementById('tf-log-box');
        if (box) {
            box.innerHTML = renderEventosLog(Array.isArray(estado.logs) ? estado.logs : [evento]);
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
                        modoCriacao: CONFIG.modoCriacao,
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
                var modoVal = corpo.querySelector('#tf-modo-coleta').value;
                cfg.modoColeta = (modoVal === 'sem-gabarito-manual' || modoVal === 'stealth-offline') ? modoVal : 'com-gabarito';
                cfg.modoOperacao = cfg.modoColeta;
                var modoCriacaoEl = corpo.querySelector('#tf-modo-criacao');
                if (modoCriacaoEl) {
                    cfg.modoCriacao = (modoCriacaoEl.value === 'criar-tudo') ? 'criar-tudo' : 'padrao';
                }
                var perfilEl = corpo.querySelector('#tf-perfil-stealth');
                if (perfilEl) {
                    cfg.perfilStealth = perfilEl.value;
                    cfg.stealthWpm = cfg.perfilStealth === 'leitura-dinamica' ? 350 : 220;
                }
                var cbEl = corpo.querySelector('#tf-coffee-break');
                if (cbEl) cfg.stealthCoffeeBreakAtivo = cbEl.checked;
                cfg.banks = corpo.querySelector('#tf-bancas').value.split('\n').map(clean).filter(Boolean);
                cfg.years = corpo.querySelector('#tf-anos').value.split(',').map(function (y) { return parseInt(y, 10); }).filter(function (y) { return y >= 1900 && y <= 2100; });
                if (cfg.banks.length < 1) throw new Error('Informe ao menos uma banca.');
                if (cfg.years.length < 1) throw new Error('Informe ao menos um ano.');
                CONFIG.delayMin = cfg.delayMin;
                CONFIG.delayMax = cfg.delayMax;
                estado.config = cfg;
                salvarEstado();
                aviso.innerHTML = '<div class="tf-resumo" style="border-color:#166534;background:#052e16;color:#bbf7d0">Configuração salva</div>';
                log('Configuração salva: pasta ' + (cfg.folderId || '(vazio)') + ', modo ' + cfg.modoColeta + ' (' + (cfg.perfilStealth || 'ultra-furtivo') + '), fluxo ' + (cfg.modoCriacao || 'padrao') + ', lote ' + cfg.batchSize + ', ' + cfg.banks.length + ' bancas.');
            } catch (e) {
                aviso.innerHTML = '<div class="tf-status-msg erro">' + escapeHtml(e.message) + '</div>';
            }
        });

        var iniciar = corpo.querySelector('#tf-iniciar');
        if (iniciar) iniciar.addEventListener('click', function () { continuar(); });
        var btnParar = corpo.querySelector('#tf-parar');
        if (btnParar) btnParar.addEventListener('click', parar);

        var copiarLog = corpo.querySelector('#tf-log-copiar');
        if (copiarLog) copiarLog.addEventListener('click', function () {
            var texto = textoCompletoLog();
            var fallback = function () {
                if (typeof document === 'undefined' || !document.execCommand) return;
                var auxiliar = document.createElement('textarea');
                auxiliar.value = texto;
                auxiliar.setAttribute('readonly', '');
                auxiliar.style.position = 'fixed';
                auxiliar.style.opacity = '0';
                document.body.appendChild(auxiliar);
                auxiliar.select();
                try { document.execCommand('copy'); copiarLog.textContent = 'Copiado'; }
                finally { auxiliar.remove(); }
                setTimeout(function () { copiarLog.textContent = 'Copiar'; }, 1200);
            };
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(texto).then(function () {
                    copiarLog.textContent = 'Copiado';
                    setTimeout(function () { copiarLog.textContent = 'Copiar'; }, 1200);
                }).catch(fallback);
                return;
            }
            fallback();
        });

        var limparLog = corpo.querySelector('#tf-log-limpar');
        if (limparLog) limparLog.addEventListener('click', function () {
            estado.logs = [];
            salvarEstado(true);
            mostrarAba('log');
        });

        corpo.querySelectorAll('[data-acao="executar-materia"], [data-acao="refazer-materia"]').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var indice = parseInt(b.getAttribute('data-indice'), 10);
                if (b.getAttribute('data-acao') === 'refazer-materia') refazerMateria(indice);
                else executarMateria(indice);
            });
        });

        corpo.querySelectorAll('[data-acao]').forEach(function (b) {
            b.addEventListener('click', function () {
                var acao = b.getAttribute('data-acao');
                if (acao === 'salvar-sem-gabarito') {
                    var cadernoAtual = estado.biblioteca[cadernoIdDaUrl()];
                    if (!cadernoAtual) {
                        UI.setStatus('Caderno atual não encontrado na biblioteca.');
                        return;
                    }
                    try {
                        salvarQuestaoAtualSemGabarito(cadernoAtual);
                        UI.renderBiblioteca();
                        UI.renderProgresso();
                        UI.setStatus('Questão salva sem gabarito.');
                    } catch (e) {
                        UI.setStatus(String(e && e.message || e));
                    }
                    return;
                }
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
                else if (acao === 'txt') baixarTxtCaderno(caderno);
                else if (acao === 'pdf') baixarPdfCaderno(caderno);
                else if (acao === 'excel') baixarExcelCaderno(caderno);
                else if (acao === 'json') baixarJsonCaderno(caderno);
            });
        });
    }

    function salvarQuestaoAtualSemGabarito(caderno) {
        var questao = extrairQuestaoAtual();
        if (!questao || !questao.id || !questao.number) throw new Error('Não consegui extrair a questão atualmente visível.');
        var questaoSemGabarito = Object.assign({}, questao, { answer: '', answerSource: 'nao-aplicavel' });
        var questoes = Array.isArray(caderno.questoes) ? caderno.questoes : [];
        var indice = questoes.findIndex(function (item) { return String(item && item.id) === String(questaoSemGabarito.id); });
        if (indice >= 0) questoes[indice] = questaoSemGabarito;
        else questoes.push(questaoSemGabarito);
        caderno.questoes = questoes;
        caderno.coletadas = questoes.length;
        estado.biblioteca[caderno.id] = caderno;
        salvarEstado(true);
        return { saved: true, questionId: questaoSemGabarito.id, number: questaoSemGabarito.number };
    }

    /* Copiar sob demanda (botão da biblioteca): navega até o caderno e coleta.
       A navegação encerra a execução; o auto-resume retoma pela fase 'coletando'. */
    async function retomarColetaSobDemanda(caderno) {
        if (estado.status !== 'rodando') return;
        if (paginaAtual() !== 'caderno' || cadernoIdDaUrl() !== caderno.id) {
            estado.fase = 'coletando';
            estado.cadernoAtual = caderno;
            estado.mensagem = 'Abrindo caderno ' + caderno.id + '...';
            salvarEstado(true);
            UI.setStatus(estado.mensagem);
            irPara(location.origin + '/questoes/cadernos/' + caderno.id); // navega → boot retoma
            return;
        }
        estado.cadernoAtual = caderno;
        estado.fase = 'coletando';
        salvarEstado(true);
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
        salvarEstado(true);
        retomarColetaSobDemanda(caderno);
    }

    /* ---- executar/refazer matéria a partir da árvore do plano ---- */
    function executarMateria(indice) {
        var plano = estado.plano;
        if (!plano || !Array.isArray(plano.matters) || !plano.matters[indice]) return;
        if (estado.status === 'rodando') parar();
        estado.planIndex = indice;
        estado.fase = 'nenhuma';
        estado.cadernoAtual = null;
        estado.erro = null;
        salvarEstado(true);
        UI.renderBiblioteca();
        UI.renderProgresso();
        continuar();
        atualizarArvorePlano();
    }

    function refazerMateria(indice) {
        var plano = estado.plano;
        if (!plano || !Array.isArray(plano.matters) || !plano.matters[indice]) return;
        var caderno = acharCadernoPorTitulo(plano.matters[indice].title);
        if (caderno) {
            caderno.questoes = [];
            caderno.coletadas = 0;
            caderno.completo = false;
            caderno.totalConfirmado = false;
            caderno.total = 0;
        }
        executarMateria(indice);
    }

    function atualizarArvorePlano() {
        var arvoreEl = document.getElementById('tf-plano-arvore');
        if (arvoreEl && estado.plano) arvoreEl.innerHTML = PLANO_UI_MODEL.renderArvore(estado.plano, statusMaterias(estado));
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
        var quick = painelEl.querySelector('#tf-quick-toggle');
        if (quick) {
            var rodando = estado.status === 'rodando';
            quick.textContent = rodando ? '⏸' : '▶';
            quick.title = rodando ? 'Pausar execução' : 'Continuar execução';
            quick.setAttribute('aria-label', quick.title);
        }
        if (abaAtiva === 'exec') mostrarAba('exec');
    };
    UI.renderBiblioteca = function () {
        if (!painelEl) return;
        if (abaAtiva === 'biblio') mostrarAba('biblio');
    };

    if (typeof window !== 'undefined') {
        window.__TecFabricaLogUI = {
            renderEvento: renderEventoLog,
            renderEventos: renderEventosLog,
            textoCompleto: textoCompletoLog
        };
    }

