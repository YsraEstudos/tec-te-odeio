    /* =====================================================================
     * ENGINE — COLETA (copia cada questão com gabarito)
     * =================================================================== */
    async function coletarCaderno(caderno) {
        // caderno = {id, titulo, total, questoes: [...]}
        var colecao = caderno.questoes || [];
        indexarEstado(estado);
        var porId = questaoIdsPorCaderno.get(String(caderno.id)) || new Set();
        log('Coleta do caderno iniciada ou retomada.', {
            tipo: 'observacao', fase: 'coletando',
            contexto: { cadernoId: caderno.id, titulo: caderno.titulo, salvas: colecao.length, total: caderno.total || null }
        });

        // Começa de onde a coleta parou (retomada) ou da questão 1
        var maxColetada = 0;
        colecao.forEach(function (q) { if (Number(q.number) > maxColetada) maxColetada = Number(q.number); });
        var posInicial = lerPosicao();
        if (maxColetada > 0 && (!posInicial || posInicial.posicao !== maxColetada)) {
            UI.setStatus('Retomando da questão ' + maxColetada + '...');
            log('Decisão: retomando a coleta a partir da última questão salva.', {
                tipo: 'decisao', fase: 'coletando',
                contexto: { cadernoId: caderno.id, numero: maxColetada, salvas: colecao.length }
            });
            var sentinelRetomada = lerQuestaoIdAtual() || '';
            var assinaturaRetomada = assinaturaQuestao();
            if (!navegarQuestao(maxColetada)) throw new Error('Não consegui retomar a questão salva.');
            var retomadaOk = await new Promise(function (resolve) { aguardarQuestaoMudar(sentinelRetomada, assinaturaRetomada, resolve); });
            log('Resultado da retomada da coleta.', {
                tipo: 'resultado', nivel: retomadaOk ? 'ok' : 'erro', fase: 'coletando',
                contexto: { cadernoId: caderno.id, numero: maxColetada, carregada: retomadaOk }
            });
            if (!retomadaOk) throw new Error('A questão salva não carregou a tempo.');
            await workerSleep(800);
        } else if (maxColetada === 0 && posInicial && posInicial.posicao > 1) {
            UI.setStatus('Indo para a questão 1...');
            log('Decisão: nenhuma questão salva; voltando para a primeira questão.', {
                tipo: 'decisao', fase: 'coletando',
                contexto: { cadernoId: caderno.id, numeroAtual: posInicial.posicao }
            });
            var sentinelQ1 = lerQuestaoIdAtual() || '';
            var assinaturaQ1 = assinaturaQuestao();
            if (!navegarQuestao(1)) throw new Error('Não consegui voltar para a primeira questão.');
            var q1Ok = await new Promise(function (resolve) { aguardarQuestaoMudar(sentinelQ1, assinaturaQ1, resolve); });
            log('Resultado do retorno para a primeira questão.', {
                tipo: 'resultado', nivel: q1Ok ? 'ok' : 'erro', fase: 'coletando',
                contexto: { cadernoId: caderno.id, numero: 1, carregada: q1Ok }
            });
            if (!q1Ok) throw new Error('A primeira questão não carregou a tempo.');
            await workerSleep(800);
        }

        while (true) {
            if (estado.status !== 'rodando') return;
            var inicioQuestao = Date.now();
            var questao = extrairQuestaoAtual();
            if (!questao || !questao.id) {
                log('Extração inicial sem questão; aguardando o DOM e tentando novamente.', {
                    tipo: 'tentativa', nivel: 'warn', fase: 'coletando',
                    contexto: { cadernoId: caderno.id }
                });
                await workerSleep(1200);
                questao = extrairQuestaoAtual();
                if (!questao || !questao.id) {
                    log('Falha definitiva ao extrair a questão atual.', {
                        tipo: 'erro', nivel: 'erro', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, salvas: colecao.length }
                    });
                    throw new Error('Não consegui extrair a questão atual.');
                }
            }
            var existente = porId.has(String(questao.id)) ? questoesPorId.get(String(questao.id)) : null;
            if (!existente || !existente.answer) {
                UI.setStatus('Coletando questão ' + questao.number + '/' + (caderno.total || '?') + '...');
                log('Tentando obter o gabarito da questão.', {
                    tipo: 'tentativa', fase: 'resolvendo',
                    contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number, opcoes: questao.options.length }
                });
                var gabarito = await resolverParaGabarito(questao);
                if (estado.status !== 'rodando') return;

                if (!gabarito && modalRecaptchaAberto()) {
                    log('Coleta pausada: reCAPTCHA detectado e pendente de validação.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number }
                    });
                    parar();
                    UI.setStatus('Pausado: resolva o reCAPTCHA na página e clique em Continuar.');
                    return;
                }

                var answerSource = gabarito ? (GabaritoInterceptor.ultimoMetodo || 'resolucao') : (existente && existente.answerSource || 'nao-obtido');
                if (existente) {
                    // atualiza apenas o que faltava (gabarito retentado)
                    existente.answer = gabarito || existente.answer || '';
                    existente.answerSource = answerSource;
                    if (!existente.statementHtml) existente.statementHtml = questao.statementHtml;
                    if (!existente.statement) existente.statement = questao.statement;
                    if (!existente.options.length) existente.options = questao.options;
                } else {
                    questao.answer = gabarito || '';
                    questao.answerSource = answerSource;
                    colecao.push(questao);
                    porId.add(String(questao.id));
                    questoesPorId.set(String(questao.id), questao);
                }
                caderno.questoes = colecao;
                caderno.coletadas = colecao.length;
                salvarEstado(true);
                UI.renderBiblioteca();
                UI.renderProgresso();
                log('Resultado da questão salvo.', {
                    tipo: 'resultado', nivel: gabarito ? 'ok' : 'warn', fase: 'coletando',
                    contexto: {
                        cadernoId: caderno.id,
                        questaoId: questao.id,
                        numero: questao.number,
                        gabarito: gabarito || null,
                        answerSource: answerSource,
                        salvas: colecao.length,
                        duracaoMs: Date.now() - inicioQuestao
                    }
                });
            } else {
                log('Questão já salva; pulando nova resolução.', {
                    tipo: 'decisao', nivel: 'ok', fase: 'coletando',
                    contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number, answerSource: existente.answerSource || 'desconhecido', salvas: colecao.length }
                });
            }
            var pos = lerPosicao();
            if (!pos) {
                caderno.completo = false;
                caderno.questoes = colecao;
                salvarEstado();
                log('Coleta interrompida: não foi possível confirmar a posição atual; o caderno não será marcado como completo.', {
                    tipo: 'erro', nivel: 'erro', fase: 'coletando',
                    contexto: {
                        cadernoId: caderno.id,
                        questaoId: questao.id,
                        numero: questao.number,
                        salvas: colecao.length,
                        totalConhecido: caderno.total || null
                    }
                });
                throw new Error('Não consegui confirmar a posição atual da questão.');
            }
            var total = pos.total || caderno.total;
            caderno.total = total;
            if (pos.posicao >= total) break;
            await pausaAleatoria();
            if (estado.status !== 'rodando') return;
            var idAnterior = questao.id;
            var assinaturaAnterior = assinaturaQuestao();
            if (!navegarQuestao(pos.posicao + 1)) throw new Error('Não consegui navegar para a próxima questão.');
            var mudou = await new Promise(function (resolve) { aguardarQuestaoMudar(idAnterior, assinaturaAnterior, resolve); });
            log('Resultado da navegação para a próxima questão.', {
                tipo: 'resultado', nivel: mudou ? 'ok' : 'warn', fase: 'coletando',
                contexto: { cadernoId: caderno.id, de: pos.posicao, para: pos.posicao + 1, carregada: mudou }
            });
            if (!mudou && estado.status === 'rodando') {
                // timeout transitório: tenta navegar de novo uma vez
                log('Navegação lenta; executando uma segunda tentativa.', {
                    tipo: 'tentativa', nivel: 'warn', fase: 'coletando',
                    contexto: { cadernoId: caderno.id, para: pos.posicao + 1 }
                });
                assinaturaAnterior = assinaturaQuestao();
                if (!navegarQuestao(pos.posicao + 1)) throw new Error('Não consegui navegar para a próxima questão.');
                mudou = await new Promise(function (resolve) { aguardarQuestaoMudar(idAnterior, assinaturaAnterior, resolve); });
                log('Resultado da segunda tentativa de navegação.', {
                    tipo: 'resultado', nivel: mudou ? 'ok' : 'erro', fase: 'coletando',
                    contexto: { cadernoId: caderno.id, para: pos.posicao + 1, carregada: mudou, tentativa: 2 }
                });
            }
            if (!mudou) {
                log('Questão seguinte não carregou dentro do limite.', {
                    tipo: 'erro', nivel: 'erro', fase: 'coletando',
                    contexto: { cadernoId: caderno.id, para: pos.posicao + 1 }
                });
                throw new Error('A questão ' + (pos.posicao + 1) + ' não carregou a tempo.');
            }
        }
        // Passadas de retry: questões que ficaram sem gabarito (ex: acertou ao marcar A)
        var passadas = 0;
        while (passadas < 2 && estado.status === 'rodando') {
            var pendentes = colecao.filter(function (q) { return !q.answer; });
            if (!pendentes.length) break;
            passadas += 1;
            log('Retry iniciado para questões sem gabarito.', {
                tipo: 'tentativa', nivel: 'warn', fase: 'resolvendo',
                contexto: { cadernoId: caderno.id, passada: passadas, pendentes: pendentes.length }
            });
            UI.setStatus('Retry de gabarito: ' + pendentes.length + ' questão(ões)...');
            var idsPendentes = {};
            pendentes.forEach(function (q) { idsPendentes[q.id] = true; });
            for (var i = 0; i < colecao.length; i += 1) {
                if (estado.status !== 'rodando') return;
                if (!idsPendentes[colecao[i].id]) continue;
                var posAntes = lerPosicao();
                var sentinelRetry = (posAntes && posAntes.posicao === colecao[i].number) ? '' : (lerQuestaoIdAtual() || '');
                var assinaturaRetry = assinaturaQuestao();
                if (!navegarQuestao(colecao[i].number)) {
                    log('Retry não conseguiu abrir a questão pendente.', {
                        tipo: 'erro', nivel: 'erro', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: colecao[i].id, numero: colecao[i].number, passada: passadas }
                    });
                    continue;
                }
                var retryCarregado = await new Promise(function (resolve) { aguardarQuestaoMudar(sentinelRetry, assinaturaRetry, resolve); });
                if (!retryCarregado) {
                    log('Retry não carregou a questão pendente a tempo.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: colecao[i].id, numero: colecao[i].number, passada: passadas, carregada: false }
                    });
                    continue;
                }
                await workerSleep(500);
                var qRetry = extrairQuestaoAtual();
                if (!qRetry) {
                    log('Retry não conseguiu extrair a questão pendente.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: colecao[i].id, numero: colecao[i].number, passada: passadas }
                    });
                    continue;
                }
                var gRetry = await resolverParaGabarito(qRetry);
                if (estado.status !== 'rodando') return;
                if (!gRetry && modalRecaptchaAberto()) {
                    log('Retry pausado: reCAPTCHA detectado e pendente de validação.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: colecao[i].id, numero: colecao[i].number, passada: passadas }
                    });
                    parar();
                    UI.setStatus('Pausado: resolva o reCAPTCHA na página e clique em Continuar.');
                    return;
                }
                if (gRetry) {
                    colecao[i].answer = gRetry;
                    colecao[i].answerSource = GabaritoInterceptor.ultimoMetodo || 'resolucao';
                    caderno.questoes = colecao;
                    salvarEstado();
                    log('Gabarito obtido no retry e salvo.', {
                        tipo: 'resultado', nivel: 'ok', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: colecao[i].id, numero: colecao[i].number, gabarito: gRetry, answerSource: colecao[i].answerSource, passada: passadas, salvas: colecao.length }
                    });
                } else {
                    log('Retry terminou sem gabarito para a questão.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: colecao[i].id, numero: colecao[i].number, gabarito: null, passada: passadas }
                    });
                }
                await pausaAleatoria();
            }
        }
        caderno.totalConfirmado = true;
        caderno.completo = true;
        salvarEstado();
        UI.renderBiblioteca();
        UI.renderProgresso();
        log('Coleta completa do caderno.', {
            tipo: 'resultado', nivel: 'ok', fase: 'coletando',
            contexto: { cadernoId: caderno.id, titulo: caderno.titulo, salvas: caderno.questoes.length, total: caderno.total, pendentes: caderno.questoes.filter(function (q) { return !q.answer; }).length }
        });
    }
