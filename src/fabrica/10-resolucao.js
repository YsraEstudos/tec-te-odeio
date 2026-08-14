    /* =====================================================================
     * GABARITO VIA RESOLUÇÃO (clique como um humano faria)
     * =================================================================== */
    function lerGabaritoDoTexto(texto) {
        // formato de erro: "a correta é: A" / "Gabarito: A"
        var g = texto.match(/a correta [ée]:\s*([A-E])/i) || texto.match(/Gabarito:\s*([A-E])/i) || texto.match(/correta [ée]:\s*([A-E])/i);
        if (g) return g[1].toUpperCase();
        // formato de acerto: "você selecionou: A, alternativa correta"
        g = texto.match(/selecionou:\s*([A-E])[.,]?\s+alternativa correta/i);
        if (g) return g[1].toUpperCase();
        return null;
    }

    function resolverParaGabarito(questao) {
        return new Promise(function (resolve) {
            var opts = questao.options || [];
            var contextoBase = { questaoId: questao.id || null, numero: questao.number || null, opcoes: opts.length };
            GabaritoInterceptor.ultimoMetodo = null;
            log('Iniciando busca do gabarito.', {
                tipo: 'observacao', fase: 'resolvendo', contexto: contextoBase
            });
            if (!opts.length) {
                GabaritoInterceptor.estatisticas.semGabarito += 1;
                GabaritoInterceptor.ultimoMetodo = 'sem-opcoes';
                log('Resolução interrompida: a questão não tem alternativas.', {
                    tipo: 'resultado', nivel: 'warn', fase: 'resolvendo',
                    contexto: Object.assign({}, contextoBase, { metodo: 'sem-opcoes', gabarito: null })
                });
                resolve(null);
                return;
            }
            // 1. Gabarito interceptado da resposta que o site já enviou (zero requests extras)
            var doCache = GabaritoInterceptor.obterPorQuestaoId(questao.id);
            if (doCache) {
                GabaritoInterceptor.estatisticas.viaCache += 1;
                GabaritoInterceptor.ultimoMetodo = 'interceptacao';
                log('Decisão: usando gabarito já capturado na rede.', {
                    tipo: 'decisao', nivel: 'ok', fase: 'resolvendo',
                    contexto: Object.assign({}, contextoBase, { metodo: 'interceptacao' })
                });
                log('Gabarito resolvido pelo cache de interceptação.', {
                    tipo: 'resultado', nivel: 'ok', fase: 'resolvendo',
                    contexto: Object.assign({}, contextoBase, { metodo: 'interceptacao', gabarito: doCache })
                });
                resolve(doCache);
                return;
            }
            // 2. Questão já resolvida antes: a resolução já está visível e os radios desabilitados
            var resVisivel = document.querySelector('.questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou');
            if (resVisivel) {
                var gv = lerGabaritoDoTexto(resVisivel.innerText || '');
                if (gv) {
                    GabaritoInterceptor.estatisticas.viaResolucaoVisivel += 1;
                    GabaritoInterceptor.ultimoMetodo = 'resolucao-visivel';
                    log('Decisão: usando resolução já visível na página.', {
                        tipo: 'decisao', nivel: 'ok', fase: 'resolvendo',
                        contexto: Object.assign({}, contextoBase, { metodo: 'resolucao-visivel' })
                    });
                    log('Gabarito encontrado na resolução visível.', {
                        tipo: 'resultado', nivel: 'ok', fase: 'resolvendo',
                        contexto: Object.assign({}, contextoBase, { metodo: 'resolucao-visivel', gabarito: gv })
                    });
                    resolve(gv);
                    return;
                }
            }
            // 3. Clique para resolver (fallback — opcional, desligável na Config)
            if (estado.config && estado.config.usarCliqueGabarito === false) {
                GabaritoInterceptor.estatisticas.semGabarito += 1;
                GabaritoInterceptor.ultimoMetodo = 'clique-desativado';
                log('Decisão: clique de resolução está desativado na configuração.', {
                    tipo: 'decisao', nivel: 'warn', fase: 'resolvendo',
                    contexto: Object.assign({}, contextoBase, { metodo: 'clique-desativado', gabarito: null })
                });
                resolve(null);
                return;
            }
            var art = document.querySelector('article.questao-enunciado');
            if (!art) {
                GabaritoInterceptor.estatisticas.semGabarito += 1;
                GabaritoInterceptor.ultimoMetodo = 'sem-artigo';
                log('Não há artigo de questão para iniciar a resolução.', {
                    tipo: 'resultado', nivel: 'warn', fase: 'resolvendo',
                    contexto: Object.assign({}, contextoBase, { metodo: 'sem-artigo', gabarito: null })
                });
                resolve(null);
                return;
            }
            var labels = Array.from(art.querySelectorAll('.questao-enunciado-alternativa'));
            // marca a primeira alternativa disponível
            var campo = labels[0] ? labels[0].querySelector('input[type=radio]') : null;
            if (!campo) {
                GabaritoInterceptor.estatisticas.semGabarito += 1;
                GabaritoInterceptor.ultimoMetodo = 'sem-controle';
                log('Não encontrei controle para iniciar o clique de resolução.', {
                    tipo: 'resultado', nivel: 'warn', fase: 'resolvendo',
                    contexto: Object.assign({}, contextoBase, { metodo: 'sem-controle', gabarito: null })
                });
                resolve(null);
                return;
            }
            log('Tentando descobrir o gabarito pelo clique da página.', {
                tipo: 'tentativa', fase: 'resolvendo',
                contexto: Object.assign({}, contextoBase, { metodo: 'clique' })
            });
            campo.click();
            workerSleep(600).then(function () {
                var resolver = Array.from(document.querySelectorAll('button')).find(function (b) {
                    return /RESOLVER QUEST[AÃ]O/i.test(b.innerText || '') && !b.disabled;
                });
                if (!resolver) {
                    GabaritoInterceptor.estatisticas.semGabarito += 1;
                    GabaritoInterceptor.ultimoMetodo = 'clique-sem-botao';
                    log('Clique feito, mas o botão de resolução não ficou disponível.', {
                        tipo: 'resultado', nivel: 'warn', fase: 'resolvendo',
                        contexto: Object.assign({}, contextoBase, { metodo: 'clique-sem-botao', gabarito: null })
                    });
                    resolve(null);
                    return;
                }
                log('Botão de resolução encontrado; executando clique.', {
                    tipo: 'tentativa', fase: 'resolvendo',
                    contexto: Object.assign({}, contextoBase, { metodo: 'clique' })
                });
                resolver.click();
                var avisouCaptcha = false;
                workerTick(CONFIG.pollInterval, function () {
                    if (modalRecaptchaAberto()) {
                        if (!avisouCaptcha) {
                            avisouCaptcha = true;
                            log('Modal de verificação de robô (reCAPTCHA) detectado. Aguardando validação...', {
                                tipo: 'observacao', nivel: 'warn', fase: 'resolvendo',
                                contexto: Object.assign({}, contextoBase, { motivo: 'recaptcha-detectado' })
                            });
                            UI.setStatus('Aguardando reCAPTCHA...');
                        }
                        return false;
                    }
                    var res = document.querySelector('.questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou, .questao-enunciado-mensagem-resolucao');
                    return res && /correta|acert|errou|Gabarito/i.test(res.innerText || '');
                }, CONFIG.loadTimeout + 30000, function (ok) {
                    if (!ok) {
                        GabaritoInterceptor.estatisticas.semGabarito += 1;
                        GabaritoInterceptor.ultimoMetodo = 'clique-timeout';
                        log('A resolução não apareceu dentro do tempo limite.', {
                            tipo: 'resultado', nivel: 'warn', fase: 'resolvendo',
                            contexto: Object.assign({}, contextoBase, { metodo: 'clique-timeout', gabarito: null })
                        });
                        resolve(null);
                        return;
                    }
                    var m = document.querySelector('.questao-enunciado-mensagem-resolucao, .questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou');
                    var t = m ? (m.innerText || m.textContent) : '';
                    var gab = lerGabaritoDoTexto(t);
                    if (gab) {
                        GabaritoInterceptor.estatisticas.viaClique += 1;
                        GabaritoInterceptor.ultimoMetodo = 'clique';
                        log('Gabarito obtido após resolver a questão.', {
                            tipo: 'resultado', nivel: 'ok', fase: 'resolvendo',
                            contexto: Object.assign({}, contextoBase, { metodo: 'clique', gabarito: gab })
                        });
                    } else {
                        GabaritoInterceptor.estatisticas.semGabarito += 1;
                        GabaritoInterceptor.ultimoMetodo = 'clique-sem-gabarito';
                        log('A resolução apareceu, mas não continha uma alternativa identificável.', {
                            tipo: 'resultado', nivel: 'warn', fase: 'resolvendo',
                            contexto: Object.assign({}, contextoBase, { metodo: 'clique-sem-gabarito', gabarito: null })
                        });
                    }
                    resolve(gab);
                });
            });
        });
    }

