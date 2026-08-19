    /* =====================================================================
     * ENGINE — COLETA (copia cada questão com gabarito)
     * =================================================================== */
    function aguardarQuestaoPronta(timeoutMs) {
        return new Promise(function (resolve) {
            workerTick(CONFIG.pollInterval, function () {
                if (estado.status !== 'rodando') return true;
                var art = document.querySelector('article.questao-enunciado');
                var h1 = document.querySelector('h1');
                var idm = h1 ? (h1.textContent || '').match(/#(\d+)/) : null;
                var pos = lerPosicao();
                if (art && idm && idm[1] && pos && pos.posicao && questaoConteudoPronta()) {
                    return true;
                }
                return false;
            }, timeoutMs || (CONFIG.loadTimeout + 15000), function (ok) {
                resolve(ok);
            });
        });
    }

    async function coletarCaderno(caderno) {
        // caderno = {id, titulo, total, questoes: [...]}
        cicloExecucaoId += 1;
        var meuCiclo = cicloExecucaoId;
        var colecao = caderno.questoes || [];
        indexarEstado(estado);
        var porId = questaoIdsPorCaderno.get(String(caderno.id)) || new Set();
        log('Coleta do caderno iniciada ou retomada.', {
            tipo: 'observacao', fase: 'coletando',
            contexto: { cadernoId: caderno.id, titulo: caderno.titulo, salvas: colecao.length, total: caderno.total || null }
        });

        UI.setStatus('Aguardando carregamento da questão...');
        var prontaInicial = await aguardarQuestaoPronta(CONFIG.loadTimeout + 15000);
        if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
        if (!prontaInicial) {
            log('A questão inicial do caderno não carregou no tempo limite.', {
                tipo: 'erro', nivel: 'erro', fase: 'coletando',
                contexto: { cadernoId: caderno.id }
            });
            throw new Error('A página do caderno não carregou a questão a tempo.');
        }

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
            if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
            log('Resultado da retomada da coleta.', {
                tipo: 'resultado', nivel: retomadaOk ? 'ok' : 'erro', fase: 'coletando',
                contexto: { cadernoId: caderno.id, numero: maxColetada, carregada: retomadaOk }
            });
            if (!retomadaOk) throw new Error('A questão salva não carregou a tempo.');
            await workerSleep(800);
            if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
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
            if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
            log('Resultado do retorno para a primeira questão.', {
                tipo: 'resultado', nivel: q1Ok ? 'ok' : 'erro', fase: 'coletando',
                contexto: { cadernoId: caderno.id, numero: 1, carregada: q1Ok }
            });
            if (!q1Ok) throw new Error('A primeira questão não carregou a tempo.');
            await workerSleep(800);
            if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
        }

        while (true) {
            if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
            var inicioQuestao = Date.now();
            var idQuestaoAtual = lerQuestaoIdAtual();
            var posicaoAtual = lerPosicao();
            var existente = idQuestaoAtual ? (questoesPorId.get(String(idQuestaoAtual)) || null) : null;
            var questao = existente && posicaoAtual && posicaoAtual.posicao ? {
                id: String(idQuestaoAtual),
                number: posicaoAtual.posicao
            } : extrairQuestaoAtual();
            if (!questao || !questao.id || !questao.number) {
                log('Extração inicial sem questão; aguardando o DOM e tentando novamente.', {
                    tipo: 'tentativa', nivel: 'warn', fase: 'coletando',
                    contexto: { cadernoId: caderno.id }
                });
                var carregouNoLoop = await aguardarQuestaoPronta(CONFIG.loadTimeout + 10000);
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
                if (carregouNoLoop) {
                    questao = extrairQuestaoAtual();
                }
                if (!questao || !questao.id || !questao.number) {
                    log('Falha definitiva ao extrair a questão atual.', {
                        tipo: 'erro', nivel: 'erro', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, salvas: colecao.length }
                    });
                    throw new Error('Não consegui extrair a questão atual.');
                }
            }

            var modoStealth = estado.config && (estado.config.modoOperacao === 'stealth-offline' || estado.config.modoColeta === 'stealth-offline');
            existente = existente || questoesPorId.get(String(questao.id)) || null;

            if (existente) {
                UI.setStatus('Questão #' + questao.id + ' já coletada; avançando...');
                log('Questão já existe na biblioteca; coleta duplicada ignorada.', {
                    tipo: 'decisao', nivel: 'ok', fase: 'coletando',
                    contexto: {
                        cadernoId: caderno.id,
                        questaoId: questao.id,
                        numero: questao.number,
                        nesteCaderno: porId.has(String(questao.id)),
                        salvas: colecao.length
                    }
                });
} else if (modoStealth) {
                // ================= MODO STEALTH OFFLINE (ZERO RESOLUÇÃO / ZERO COTA) =================
                // Decisão rápida: quando o payload interceptado (ou o scope
                // Angular) JÁ CONFIRMOU que a questão não tem gabarito, ela é
                // coletada em ~0,5s sem leitura, scroll ou clique. Questões com
                // gabarito mantêm o ritmo de leitura humano (cadência mista).
                var cfgRapido = configuracaoRapidaAtual();
                var decisaoRapida = false;
                if (cfgRapido.rapidoSemGabaritoAtivo !== false &&
                    typeof GabaritoInterceptor !== 'undefined' && GabaritoInterceptor.payloadsVistos > 0) {
                    var consulta = GabaritoInterceptor.consultarGabaritoQuestao(questao.id, artigoQuestaoAtual());
                    if (consulta.estado === 'desconhecido') {
                        await aguardarPayloadQuestao(questao.id, cfgRapido.rapidoCacheEsperaMs || 2000);
                        if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
                        consulta = GabaritoInterceptor.consultarGabaritoQuestao(questao.id, artigoQuestaoAtual());
                    }
                    if (consulta.estado === 'sem-gabarito') {
                        decisaoRapida = true;
                    } else if (consulta.estado === 'com-gabarito') {
                        log('Questão com gabarito interceptado; mantendo ritmo de leitura.', {
                            tipo: 'decisao', fase: 'coletando',
                            contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number, letra: consulta.letra, metodo: 'rapido-ignorado' }
                        });
                    }
                }
                if (decisaoRapida) {
                    var rapido = await coletarQuestaoRapida(questao, caderno, colecao, porId, meuCiclo);
                    if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
                    if (rapido && rapido.fim) break;
                    continue;
                }
                var doCacheStealth = mapearGabaritoParaOpcoes(GabaritoInterceptor.obterPorQuestaoId(questao.id), questao.options || []);
                var resVisivelStealth = document.querySelector('.questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou');
                var gvStealth = resVisivelStealth ? mapearGabaritoParaOpcoes(lerGabaritoDoTexto(resVisivelStealth.innerText || ''), questao.options || []) : null;
                var gabaritoStealth = doCacheStealth || gvStealth || '';
                var answerSourceStealth = doCacheStealth ? 'interceptacao-passiva' : (gvStealth ? 'resolucao-visivel' : 'offline-passivo');

                questao.answer = gabaritoStealth;
                questao.answerSource = answerSourceStealth;
                colecao.push(questao);
                porId.add(String(questao.id));
                questoesPorId.set(String(questao.id), questao);

                caderno.questoes = colecao;
                caderno.coletadas = colecao.length;
                salvarEstado(true);
                UI.renderBiblioteca();
                UI.renderProgresso();

                // 1. Cronometria cognitiva: tempo de leitura por contagem de palavras (WPM)
                var tempoLeitura = (typeof StealthEngine !== 'undefined')
                    ? StealthEngine.calcularTempoLeituraMs(questao, estado.config)
                    : 12000;
                var statsBloco = (typeof StealthEngine !== 'undefined')
                    ? StealthEngine.obterEstatisticasBloco()
                    : { restantesAteDescanso: 30 };

                UI.setStatus('🛡️ Modo Furtivo: Lendo questão ' + questao.number + '/' + (caderno.total || '?') +
                    ' (~' + Math.round(tempoLeitura / 1000) + 's) · Descanso em ' + statsBloco.restantesAteDescanso + ' q');

                log('Questão coletada em modo stealth offline.', {
                    tipo: 'resultado', nivel: 'ok', fase: 'coletando',
                    contexto: {
                        cadernoId: caderno.id,
                        questaoId: questao.id,
                        numero: questao.number,
                        gabarito: gabaritoStealth || '(sem gabarito - offline)',
                        tempoLeituraEstimadoMs: tempoLeitura,
                        salvas: colecao.length
                    }
                });

                // 2. Rolagem orgânica com inércia pelo enunciado
                var artEl = document.querySelector('article.questao-enunciado');
                if (artEl && typeof StealthEngine !== 'undefined') {
                    var rectArt = artEl.getBoundingClientRect();
                    var destinoScroll = (window.scrollY || 0) + rectArt.top + Math.min(rectArt.height * 0.6, 600);
                    await StealthEngine.scrollOrganico(destinoScroll, Math.min(2000, Math.round(tempoLeitura * 0.3)));
                    if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
                }

                // 3. Tempo restante de leitura com reflexão
                var tempoRestanteLeitura = Math.max(1000, tempoLeitura - 2200);
                await workerSleep(tempoRestanteLeitura);
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;

                // 4. Micro-hesitação esporádica (35% de chance)
                if (Math.random() < 0.35 && typeof StealthEngine !== 'undefined') {
                    var microPausa = Math.round(StealthEngine.boxMullerRandom(1400, 350));
                    await workerSleep(Math.max(500, microPausa));
                    if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
                }

                // 5. Registro de questão no bloco de descanso
                if (typeof StealthEngine !== 'undefined') {
                    StealthEngine.registrarQuestaoColetada();
                }

                // 6. Verificação de Coffee Break / Pausa Biológica Periódica
                if (typeof StealthEngine !== 'undefined' && StealthEngine.precisaDescansoBiologico(estado.config)) {
                    var tempoDescanso = StealthEngine.calcularTempoDescansoMs(estado.config);
                    var duracaoSeg = Math.round(tempoDescanso / 1000);
                    log('Pausa biológica de descanso (Coffee Break) iniciada: ' + duracaoSeg + 's.', {
                        tipo: 'observacao', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, duracaoSeg: duracaoSeg, questoesColetadas: colecao.length }
                    });
                    var fimDescanso = Date.now() + tempoDescanso;
                    while (Date.now() < fimDescanso && estado.status === 'rodando') {
                        if (meuCiclo !== cicloExecucaoId) return;
                        var segFaltantes = Math.max(1, Math.round((fimDescanso - Date.now()) / 1000));
                        UI.setStatus('☕ Descanso biológico (Coffee Break): ' + segFaltantes + 's restantes...');
                        await workerSleep(1000);
                    }
                    if (typeof StealthEngine.resetarBlocoDescanso === 'function') {
                        StealthEngine.resetarBlocoDescanso(estado.config);
                    }
                    if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
                }
            } else {
                // ================= MODO PADRÃO COM GABARITO / RESOLUÇÃO =================
                UI.setStatus('Coletando questão ' + questao.number + '/' + (caderno.total || '?') + '...');
                log('Tentando obter o gabarito da questão.', {
                    tipo: 'tentativa', fase: 'resolvendo',
                    contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number, opcoes: questao.options.length }
                });
                var gabarito = await resolverParaGabarito(questao);
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;

                if (!gabarito) {
                    var motivoFalha = GabaritoInterceptor.ultimoMetodo || (modalRecaptchaAberto() ? 'recaptcha-pendente' : 'sem-gabarito');
                    log('Coleta pausada: gabarito não obtido para a questão.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number, motivo: motivoFalha }
                    });
                    parar();
                    UI.setStatus('Pausado na questão ' + (questao.number || '') + ': gabarito não obtido (' + motivoFalha + '). Verifique e clique em Continuar.');
                    return;
                }

                var answerSource = GabaritoInterceptor.ultimoMetodo || 'resolucao';
                questao.answer = gabarito;
                questao.answerSource = answerSource;
                colecao.push(questao);
                porId.add(String(questao.id));
                questoesPorId.set(String(questao.id), questao);
                caderno.questoes = colecao;
                caderno.coletadas = colecao.length;
                salvarEstado(true);
                UI.renderBiblioteca();
                UI.renderProgresso();
                log('Resultado da questão salvo.', {
                    tipo: 'resultado', nivel: 'ok', fase: 'coletando',
                    contexto: {
                        cadernoId: caderno.id,
                        questaoId: questao.id,
                        numero: questao.number,
                        gabarito: gabarito,
                        answerSource: answerSource,
                        salvas: colecao.length,
                        duracaoMs: Date.now() - inicioQuestao
                    }
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

            if (!modoStealth) {
                await pausaAleatoria();
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
            }

            var idAnterior = questao.id;
            var assinaturaAnterior = assinaturaQuestao();

            // Navegação humanizada com eventos de ponteiro no modo stealth
            var btnSeguinte = document.querySelector("button[ng-click*='questaoSeguinte']");
            if (modoStealth && btnSeguinte && typeof StealthEngine !== 'undefined') {
                await StealthEngine.clicarHumanizado(btnSeguinte);
            } else {
                if (!navegarQuestao(pos.posicao + 1)) throw new Error('Não consegui navegar para a próxima questão.');
            }

            var mudou = await new Promise(function (resolve) { aguardarQuestaoMudar(idAnterior, assinaturaAnterior, resolve); });
            if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
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
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
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

        // Passadas de retry: apenas para o modo com gabarito ativo
        var passadas = 0;
        var modoStealthAtivo = estado.config && (estado.config.modoOperacao === 'stealth-offline' || estado.config.modoColeta === 'stealth-offline');
        while (!modoStealthAtivo && passadas < 2 && estado.status === 'rodando') {
            if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
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
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
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
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
                if (!retryCarregado) {
                    log('Retry não carregou a questão pendente a tempo.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: colecao[i].id, numero: colecao[i].number, passada: passadas, carregada: false }
                    });
                    continue;
                }
                await workerSleep(500);
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
                var qRetry = extrairQuestaoAtual();
                if (!qRetry) {
                    log('Retry não conseguiu extrair a questão pendente.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: colecao[i].id, numero: colecao[i].number, passada: passadas }
                    });
                    continue;
                }
                var gRetry = await resolverParaGabarito(qRetry);
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
                if (!gRetry) {
                    var motivoRetry = GabaritoInterceptor.ultimoMetodo || (modalRecaptchaAberto() ? 'recaptcha-pendente' : 'sem-gabarito');
                    log('Retry não obteve gabarito para a questão.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                        contexto: { cadernoId: caderno.id, questaoId: colecao[i].id, numero: colecao[i].number, motivo: motivoRetry, passada: passadas }
                    });
                    if (motivoRetry === 'recaptcha-pendente' || modalRecaptchaAberto()) {
                        parar();
                        UI.setStatus('Pausado: resolva o reCAPTCHA na página e clique em Continuar.');
                        return;
                    }
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
                }
                await pausaAleatoria();
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return;
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

    /* =====================================================================
     * MODO RÁPIDO — questões confirmadamente SEM gabarito em ~0,5s
     * (leitura passiva de caches/scope; navegação pipelined; jitter +
     * rajadas para não gerar cadência mecânica; pausa em aba oculta).
     * =================================================================== */
    function artigoQuestaoAtual() {
        try {
            if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
            return document.querySelector('article.questao-enunciado');
        } catch (e) { return null; }
    }

    function configuracaoRapidaAtual() {
        var padroes = (typeof CONFIG === 'object' && CONFIG) || {};
        var persistida = (typeof estado === 'object' && estado && estado.config &&
            typeof estado.config === 'object') ? estado.config : {};
        return Object.assign({}, padroes, persistida);
    }

    function aguardarPayloadQuestao(questaoId, tempoLimiteMs) {
        return new Promise(function (resolve) {
            var chave = String(questaoId);
            var inicio = Date.now();
            var limite = tempoLimiteMs || 2000;
            workerTick(80, function () {
                if (estado.status !== 'rodando') return true;
                if (Date.now() - inicio >= limite) return true;
                try {
                    if (typeof GabaritoInterceptor === 'undefined') return true;
                    if (GabaritoInterceptor.cache[chave]) return true;
                    if (GabaritoInterceptor.cacheSemGabarito[chave]) return true;
                } catch (e) { return true; }
                return false;
            }, limite + 500, function (ok) {
                resolve(ok);
            });
        });
    }

    function aguardarAbaVisivel() {
        return new Promise(function (resolve) {
            try {
                if (typeof document === 'undefined' || document.hidden !== true) { resolve(true); return; }
            } catch (e) { resolve(true); return; }
            workerTick(500, function () {
                try {
                    if (document.hidden !== true) return true;
                } catch (e) { return true; }
                return false;
            }, 0, function (ok) { resolve(ok); });
        });
    }

    // Jitter gaussiano (Box-Muller) entre min e max: cadência irregular,
    // sem padrão uniforme identificável no fluxo de navegação.
    function jitterRapido(cfg) {
        var min = Math.max(50, Number(cfg.rapidoDelayMin) || 300);
        var max = Math.max(min + 1, Number(cfg.rapidoDelayMax) || 800);
        var media = (min + max) / 2;
        var desvio = Math.max(25, (max - min) / 4);
        var base = 0;
        if (typeof StealthEngine !== 'undefined' && typeof StealthEngine.boxMullerRandom === 'function') {
            base = StealthEngine.boxMullerRandom(media, desvio);
        } else {
            base = media + ((Math.random() + Math.random() + Math.random() - 1.5) / 1.5) * desvio;
        }
        return Math.min(max, Math.max(min, Math.round(base)));
    }

    async function coletarQuestaoRapida(questao, caderno, colecao, porId, meuCiclo) {
        var cfg = configuracaoRapidaAtual();
        if (porId.has(String(questao.id))) {
            log('Questão já existe na biblioteca; coleta rápida ignorada.', {
                tipo: 'decisao', nivel: 'ok', fase: 'coletando',
                contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number, salvas: colecao.length }
            });
            return { fim: false };
        }

        if (cfg.rapidoPausaAbaOculta !== false) {
            await aguardarAbaVisivel();
            if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return { fim: true };
        }

        questao.answer = '';
        questao.answerSource = 'sem-gabarito';
        colecao.push(questao);
        porId.add(String(questao.id));
        questoesPorId.set(String(questao.id), questao);
        caderno.questoes = colecao;
        caderno.coletadas = colecao.length;
        salvarEstado(true);
        UI.renderBiblioteca();
        UI.renderProgresso();
        if (typeof GabaritoInterceptor !== 'undefined' && GabaritoInterceptor.estatisticas) {
            GabaritoInterceptor.estatisticas.viaRapido += 1;
        }
        log('Questão sem gabarito coletada em modo rápido.', {
            tipo: 'resultado', nivel: 'ok', fase: 'coletando',
            contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number, gabarito: '(sem gabarito)', metodo: 'rapido', salvas: colecao.length }
        });

        // Pausa biológica curta do modo rápido (bloco próprio, não contamina
        // o ritmo de leitura das questões com gabarito).
        if (cfg.rapidoCoffeeBreakAtivo !== false && typeof StealthEngine !== 'undefined' &&
            typeof StealthEngine.precisaDescansoBiologico === 'function') {
            var cfgDescanso = {
                stealthCoffeeBreakAtivo: true,
                stealthIntervaloCoffeeBreakMin: cfg.rapidoCoffeeBreakIntervaloMin || 30,
                stealthIntervaloCoffeeBreakMax: cfg.rapidoCoffeeBreakIntervaloMax || 60,
                stealthCoffeeBreakDuracaoMedia: cfg.rapidoCoffeeBreakDuracaoMedia || 9000
            };
            if (StealthEngine.precisaDescansoBiologico(cfgDescanso)) {
                var duracao = StealthEngine.calcularTempoDescansoMs(cfgDescanso);
                log('Pausa biológica do modo rápido iniciada (~' + Math.round(duracao / 1000) + 's).', {
                    tipo: 'observacao', fase: 'coletando',
                    contexto: { cadernoId: caderno.id, duracaoSeg: Math.round(duracao / 1000), questoesColetadas: colecao.length, modo: 'rapido' }
                });
                var fimDescanso = Date.now() + duracao;
                while (Date.now() < fimDescanso && estado.status === 'rodando') {
                    if (meuCiclo !== cicloExecucaoId) return { fim: true };
                    UI.setStatus('⚡ Descanso rápido: ' + Math.max(1, Math.round((fimDescanso - Date.now()) / 1000)) + 's restantes...');
                    await workerSleep(1000);
                }
                if (typeof StealthEngine.resetarBlocoDescanso === 'function') {
                    StealthEngine.resetarBlocoDescanso(cfgDescanso);
                }
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return { fim: true };
            }
        }
        if (typeof StealthEngine !== 'undefined' && typeof StealthEngine.registrarQuestaoColetada === 'function') {
            StealthEngine.registrarQuestaoColetada();
        }

        // Pipelining: a navegação para a próxima questão já começa aqui; o
        // jitter seguinte acontece em paralelo ao carregamento do XHR do site.
        var idAnterior = lerQuestaoIdAtual();
        var assinaturaAnterior = assinaturaQuestao();
        var numeroAlvo = questao.number + 1;
        var posAlvo = lerPosicao();
        if (posAlvo && posAlvo.posicao && posAlvo.total && numeroAlvo > posAlvo.total) {
            return { fim: true };
        }
        if (!navegarQuestao(numeroAlvo)) {
            log('Modo rápido: navegação para a próxima questão falhou.', {
                tipo: 'erro', nivel: 'erro', fase: 'coletando',
                contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number, proximo: numeroAlvo }
            });
            return { fim: true };
        }
        UI.setStatus('⚡ Coletando rápida ' + numeroAlvo + '/' + (posAlvo ? posAlvo.total : '?') + ' (sem gabarito)...');
        var pausaJitter = jitterRapido(cfg);
        await workerSleep(pausaJitter);
        if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return { fim: true };

        // Espera a próxima questão com poll rápido; uma tentativa extra caso
        // o primeiro carregamento estoure o prazo.
        var carregada = await new Promise(function (resolve) {
            aguardarQuestaoMudar(idAnterior, assinaturaAnterior, resolve, {
                interval: cfg.rapidoPollInterval || 120,
                timeout: 8000
            });
        });
        if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return { fim: true };
        if (!carregada && !porId.has(String(numeroAlvo))) {
            var posAntes = lerPosicao();
            var sentinel = (posAntes && posAntes.posicao === numeroAlvo) ? '' : (lerQuestaoIdAtual() || '');
            var assinaturaRetry = assinaturaQuestao();
            if (navegarQuestao(numeroAlvo)) {
                carregada = await new Promise(function (resolve) {
                    aguardarQuestaoMudar(sentinel, assinaturaRetry, resolve, {
                        interval: cfg.rapidoPollInterval || 120,
                        timeout: 8000
                    });
                });
                if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return { fim: true };
            }
        }
        if (!carregada) {
            log('Modo rápido: próxima questão não carregou a tempo; deixando para a passada de retry.', {
                tipo: 'resultado', nivel: 'warn', fase: 'coletando',
                contexto: { cadernoId: caderno.id, questaoId: questao.id, numero: questao.number, proximo: numeroAlvo }
            });
        }

        // Micro-rolagem ocasional (10%) mantém o gesto humano sem custo de tempo.
        if (Math.random() < 0.1 && typeof StealthEngine !== 'undefined' &&
            typeof StealthEngine.scrollOrganico === 'function') {
            try {
                var artEl = artigoQuestaoAtual();
                if (artEl && typeof artEl.getBoundingClientRect === 'function' && typeof window !== 'undefined') {
                    var rectArt = artEl.getBoundingClientRect();
                    var destino = (window.scrollY || 0) + rectArt.top + Math.min(rectArt.height * 0.4, 400);
                    await StealthEngine.scrollOrganico(destino, 400);
                    if (meuCiclo !== cicloExecucaoId || estado.status !== 'rodando') return { fim: true };
                }
            } catch (e) {}
        }
        return { fim: false };
    }
