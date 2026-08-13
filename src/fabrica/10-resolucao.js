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
            var opts = questao.options;
            if (!opts.length) { GabaritoInterceptor.estatisticas.semGabarito += 1; resolve(null); return; }
            // 1. Gabarito interceptado da resposta que o site já enviou (zero requests extras)
            var doCache = GabaritoInterceptor.obterPorQuestaoId(questao.id);
            if (doCache) { GabaritoInterceptor.estatisticas.viaCache += 1; resolve(doCache); return; }
            // 2. Questão já resolvida antes: a resolução já está visível e os radios desabilitados
            var resVisivel = document.querySelector('.questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou');
            if (resVisivel) {
                var gv = lerGabaritoDoTexto(resVisivel.innerText || '');
                if (gv) { GabaritoInterceptor.estatisticas.viaResolucaoVisivel += 1; resolve(gv); return; }
            }
            // 3. Clique para resolver (fallback — opcional, desligável na Config)
            if (estado.config && estado.config.usarCliqueGabarito === false) { GabaritoInterceptor.estatisticas.semGabarito += 1; resolve(null); return; }
            var art = document.querySelector('article.questao-enunciado');
            if (!art) { resolve(null); return; }
            var labels = Array.from(art.querySelectorAll('.questao-enunciado-alternativa'));
            // marca a primeira alternativa disponível
            var campo = labels[0] ? labels[0].querySelector('input[type=radio]') : null;
            if (!campo) { resolve(null); return; }
            campo.click();
            workerSleep(600).then(function () {
                var resolver = Array.from(document.querySelectorAll('button')).find(function (b) {
                    return /RESOLVER QUEST[AÃ]O/i.test(b.innerText || '') && !b.disabled;
                });
                if (!resolver) { resolve(null); return; }
                resolver.click();
                workerTick(CONFIG.pollInterval, function () {
                    var res = document.querySelector('.questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou, .questao-enunciado-mensagem-resolucao');
                    return res && /correta|acert|errou|Gabarito/i.test(res.innerText || '');
                }, CONFIG.loadTimeout, function (ok) {
                    if (!ok) { resolve(null); return; }
                    var m = document.querySelector('.questao-enunciado-mensagem-resolucao, .questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou');
                    var t = m ? (m.innerText || m.textContent) : '';
                    var gab = lerGabaritoDoTexto(t);
                    if (gab) GabaritoInterceptor.estatisticas.viaClique += 1;
                    else GabaritoInterceptor.estatisticas.semGabarito += 1;
                    resolve(gab);
                });
            });
        });
    }

