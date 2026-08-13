    /* =====================================================================
     * ENGINE — COLETA (copia cada questão com gabarito)
     * =================================================================== */
    async function coletarCaderno(caderno) {
        // caderno = {id, titulo, total, questoes: [...]}
        var colecao = caderno.questoes || [];
        indexarEstado(estado);
        var porId = questaoIdsPorCaderno.get(String(caderno.id)) || new Set();

        // Começa de onde a coleta parou (retomada) ou da questão 1
        var maxColetada = 0;
        colecao.forEach(function (q) { if (Number(q.number) > maxColetada) maxColetada = Number(q.number); });
        var posInicial = lerPosicao();
        if (maxColetada > 0 && (!posInicial || posInicial.posicao !== maxColetada)) {
            UI.setStatus('Retomando da questão ' + maxColetada + '...');
            var sentinelRetomada = lerQuestaoIdAtual() || '';
            var assinaturaRetomada = assinaturaQuestao();
            navegarQuestao(maxColetada);
            await new Promise(function (resolve) { aguardarQuestaoMudar(sentinelRetomada, assinaturaRetomada, resolve); });
            await workerSleep(800);
        } else if (maxColetada === 0 && posInicial && posInicial.posicao > 1) {
            UI.setStatus('Indo para a questão 1...');
            var sentinelQ1 = lerQuestaoIdAtual() || '';
            var assinaturaQ1 = assinaturaQuestao();
            navegarQuestao(1);
            await new Promise(function (resolve) { aguardarQuestaoMudar(sentinelQ1, assinaturaQ1, resolve); });
            await workerSleep(800);
        }

        while (true) {
            if (estado.status !== 'rodando') return;
            var questao = extrairQuestaoAtual();
            if (!questao || !questao.id) {
                await workerSleep(1200);
                questao = extrairQuestaoAtual();
                if (!questao || !questao.id) throw new Error('Não consegui extrair a questão atual.');
            }
            var existente = porId.has(String(questao.id)) ? questoesPorId.get(String(questao.id)) : null;
            if (!existente || !existente.answer) {
                UI.setStatus('Coletando questão ' + questao.number + '/' + (caderno.total || '?') + '...');
                var gabarito = await resolverParaGabarito(questao);
                if (existente) {
                    // atualiza apenas o que faltava (gabarito retentado)
                    existente.answer = gabarito || existente.answer || '';
                    existente.answerSource = gabarito ? 'resolucao' : (existente.answerSource || 'nao-obtido');
                    if (!existente.statementHtml) existente.statementHtml = questao.statementHtml;
                    if (!existente.statement) existente.statement = questao.statement;
                    if (!existente.options.length) existente.options = questao.options;
                } else {
                    questao.answer = gabarito || '';
                    questao.answerSource = gabarito ? 'resolucao' : 'nao-obtido';
                    colecao.push(questao);
                    porId.add(String(questao.id));
                    questoesPorId.set(String(questao.id), questao);
                }
                caderno.questoes = colecao;
                caderno.coletadas = colecao.length;
                salvarEstado(true);
                UI.renderBiblioteca();
                UI.renderProgresso();
                log('#' + questao.id + ' (pos ' + questao.number + ') coletada. Gabarito: ' + (gabarito || 'NÃO OBTIDO'));
            }
            var pos = lerPosicao();
            var total = caderno.total || (pos ? pos.total : colecao.length);
            caderno.total = total;
            if (!pos || pos.posicao >= total) break;
            await pausaAleatoria();
            if (estado.status !== 'rodando') return;
            var idAnterior = questao.id;
            var assinaturaAnterior = assinaturaQuestao();
            if (!navegarQuestao(pos.posicao + 1)) throw new Error('Não consegui navegar para a próxima questão.');
            var mudou = await new Promise(function (resolve) { aguardarQuestaoMudar(idAnterior, assinaturaAnterior, resolve); });
            if (!mudou && estado.status === 'rodando') {
                // timeout transitório: tenta navegar de novo uma vez
                log('Navegação lenta para a questão ' + (pos.posicao + 1) + ' — tentando de novo.');
                assinaturaAnterior = assinaturaQuestao();
                if (!navegarQuestao(pos.posicao + 1)) throw new Error('Não consegui navegar para a próxima questão.');
                mudou = await new Promise(function (resolve) { aguardarQuestaoMudar(idAnterior, assinaturaAnterior, resolve); });
            }
            if (!mudou) throw new Error('A questão ' + (pos.posicao + 1) + ' não carregou a tempo.');
        }
        // Passadas de retry: questões que ficaram sem gabarito (ex: acertou ao marcar A)
        var passadas = 0;
        while (passadas < 2 && estado.status === 'rodando') {
            var pendentes = colecao.filter(function (q) { return !q.answer; });
            if (!pendentes.length) break;
            passadas += 1;
            log('Retry ' + passadas + ': ' + pendentes.length + ' questões sem gabarito.');
            UI.setStatus('Retry de gabarito: ' + pendentes.length + ' questão(ões)...');
            var idsPendentes = {};
            pendentes.forEach(function (q) { idsPendentes[q.id] = true; });
            for (var i = 0; i < colecao.length; i += 1) {
                if (estado.status !== 'rodando') return;
                if (!idsPendentes[colecao[i].id]) continue;
                var posAntes = lerPosicao();
                var sentinelRetry = (posAntes && posAntes.posicao === colecao[i].number) ? '' : (lerQuestaoIdAtual() || '');
                var assinaturaRetry = assinaturaQuestao();
                navegarQuestao(colecao[i].number);
                await new Promise(function (resolve) { aguardarQuestaoMudar(sentinelRetry, assinaturaRetry, resolve); });
                await workerSleep(500);
                var qRetry = extrairQuestaoAtual();
                if (!qRetry) continue;
                var gRetry = await resolverParaGabarito(qRetry);
                if (gRetry) {
                    colecao[i].answer = gRetry;
                    colecao[i].answerSource = 'resolucao';
                    caderno.questoes = colecao;
                    salvarEstado();
                    log('Gabarito obtido no retry para #' + colecao[i].id + ': ' + gRetry);
                }
                await pausaAleatoria();
            }
        }
        caderno.completo = true;
        salvarEstado();
        UI.renderBiblioteca();
        UI.renderProgresso();
        log('Caderno "' + caderno.titulo + '" completo (' + caderno.questoes.length + ' questões).');
    }
