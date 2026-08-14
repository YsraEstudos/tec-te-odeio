    /* =====================================================================
     * MOTOR STEALTH & COMPORTAMENTO BIOLÓGICO HUMANO
     * ---------------------------------------------------------------------
     * Emulação cognitiva e física de estudante humano:
     * 1. Distribuição Log-Normal de tempo de leitura baseada em WPM e contagem
     *    de palavras (enunciado + alternativas);
     * 2. Cinemática de rolagem orgânica com easing Bézier cúbico e inércia;
     * 3. Disparo de cadeia completa de eventos de ponteiro com micro-jitter;
     * 4. Ciclo biológico de hesitação e pausas de descanso (Coffee Break).
     * =================================================================== */
    var StealthEngine = (function () {
        var posicaoCursor = { x: 120, y: 150 };
        var questoesNoBloco = 0;
        var metaProximoDescanso = sortearMetaDescanso();

        function sortearMetaDescanso(min, max) {
            var piso = typeof min === 'number' ? min : 25;
            var teto = typeof max === 'number' ? max : 40;
            return piso + Math.floor(Math.random() * (teto - piso + 1));
        }

        function boxMullerRandom(media, desvioPadrao) {
            var m = typeof media === 'number' ? media : 0;
            var dp = typeof desvioPadrao === 'number' ? desvioPadrao : 1;
            var u1 = 0;
            var u2 = 0;
            while (u1 === 0) u1 = Math.random();
            while (u2 === 0) u2 = Math.random();
            var z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
            return z0 * dp + m;
        }

        function sampleLognormal(mediaDesejada, cv) {
            var target = Math.max(100, typeof mediaDesejada === 'number' ? mediaDesejada : 1000);
            var coefVar = typeof cv === 'number' ? cv : 0.22;
            var variance = Math.pow(target * coefVar, 2);
            var sigma2 = Math.log(1 + (variance / Math.pow(target, 2)));
            var sigma = Math.sqrt(sigma2);
            var mu = Math.log(target) - (0.5 * sigma2);
            var z = boxMullerRandom(0, 1);
            var amostra = Math.exp(mu + (sigma * z));
            return Math.max(target * 0.4, Math.min(amostra, target * 2.8));
        }

        function contarPalavras(texto) {
            if (!texto) return 0;
            var limpo = String(texto).replace(/<[^>]*>/g, ' ').replace(/[^\w\sáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]/g, ' ').trim();
            if (!limpo) return 0;
            return limpo.split(/\s+/).filter(Boolean).length;
        }

        function calcularTempoLeituraMs(questao, options) {
            var opts = options || {};
            var wpm = typeof opts.wpm === 'number' && opts.wpm > 50 ? opts.wpm : 220;
            var textoEnunciado = questao ? (questao.statement || questao.statementHtml || questao.enunciado || '') : '';
            var textoAlternativas = '';
            if (questao && Array.isArray(questao.options)) {
                questao.options.forEach(function (opt) {
                    if (opt) textoAlternativas += ' ' + (opt.text || opt.texto || '');
                });
            } else if (questao && Array.isArray(questao.alternativas)) {
                questao.alternativas.forEach(function (alt) {
                    if (alt) textoAlternativas += ' ' + (alt.texto || alt.text || '');
                });
            }

            var totalPalavras = contarPalavras(textoEnunciado) + contarPalavras(textoAlternativas);
            if (totalPalavras < 15) totalPalavras = 15;

            // Tempo base em ms proporcional a WPM (palavras por minuto)
            var tempoLeituraBaseMs = (totalPalavras / wpm) * 60 * 1000;

            // Fatores de complexidade visual / cognição
            var multiplicadorComplexidade = 1.0;
            if (/<table/i.test(textoEnunciado)) multiplicadorComplexidade += 0.25;
            if (/<code|<pre/i.test(textoEnunciado)) multiplicadorComplexidade += 0.35;
            var contagemImagens = (textoEnunciado.match(/<img/gi) || []).length;
            var tempoImagensMs = contagemImagens * 3000;

            var tempoCognitivoMedio = (tempoLeituraBaseMs * multiplicadorComplexidade) + tempoImagensMs + 1800;

            // Variância Log-Normal realista
            var tempoFinalMs = Math.round(sampleLognormal(tempoCognitivoMedio, 0.20));

            // Limites fisiológicos mínimos e máximos por questão
            var pisoMinimo = opts.perfil === 'leitura-dinamica' ? 4500 : 8000;
            var tetoMaximo = opts.perfil === 'leitura-dinamica' ? 45000 : 90000;
            return Math.max(pisoMinimo, Math.min(tempoFinalMs, tetoMaximo));
        }

        function cubicBezierEasing(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        function scrollOrganico(destinoY, duracaoTotalMs) {
            return new Promise(function (resolve) {
                if (typeof window === 'undefined' || typeof document === 'undefined') {
                    resolve();
                    return;
                }
                var startY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
                var distance = (destinoY || 0) - startY;
                if (Math.abs(distance) < 20) {
                    resolve();
                    return;
                }

                var duracao = Math.max(400, typeof duracaoTotalMs === 'number' ? duracaoTotalMs : 1200);
                var t0 = Date.now();

                function frame() {
                    var elapsed = Date.now() - t0;
                    var progress = Math.min(1, elapsed / duracao);
                    var ease = cubicBezierEasing(progress);
                    var jitter = progress < 1 ? (Math.random() - 0.5) * 1.5 : 0;
                    var currentY = Math.round(startY + (distance * ease) + jitter);

                    try {
                        window.scrollTo(0, currentY);
                        window.dispatchEvent(new Event('scroll', { bubbles: true }));
                    } catch (e) {}

                    if (progress < 1) {
                        if (typeof requestAnimationFrame === 'function') {
                            requestAnimationFrame(frame);
                        } else {
                            setTimeout(frame, 16);
                        }
                    } else {
                        try { window.scrollTo(0, destinoY); } catch (e2) {}
                        resolve();
                    }
                }

                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(frame);
                } else {
                    setTimeout(frame, 16);
                }
            });
        }

        function gerarCaminhoBezier(p0, p3, numPontos) {
            var passos = numPontos || 20;
            var dx = p3.x - p0.x;
            var dy = p3.y - p0.y;
            var dist = Math.hypot(dx, dy) || 1;
            var normX = -dy / dist;
            var normY = dx / dist;
            var desvio = (Math.random() - 0.5) * dist * 0.25;

            var p1 = {
                x: p0.x + dx * (0.25 + Math.random() * 0.2) + normX * desvio,
                y: p0.y + dy * (0.25 + Math.random() * 0.2) + normY * desvio
            };
            var p2 = {
                x: p0.x + dx * (0.65 + Math.random() * 0.2) + normX * (desvio * 0.6),
                y: p0.y + dy * (0.65 + Math.random() * 0.2) + normY * (desvio * 0.6)
            };

            var pontos = [];
            for (var i = 0; i <= passos; i += 1) {
                var t = i / passos;
                var u = 1 - t;
                var tt = t * t;
                var uu = u * u;
                var uuu = uu * u;
                var ttt = tt * t;

                var x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
                var y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
                var jitter = (Math.random() - 0.5) * 1.2;
                pontos.push({ x: Math.round(x + jitter), y: Math.round(y + jitter) });
            }
            return pontos;
        }

        async function moverCursorPara(el) {
            if (!el || typeof el.getBoundingClientRect !== 'function') return;
            var rect = el.getBoundingClientRect();
            var scrollX = window.scrollX || window.pageXOffset || 0;
            var scrollY = window.scrollY || window.pageYOffset || 0;
            var targetX = rect.left + scrollX + (rect.width * (0.3 + Math.random() * 0.4));
            var targetY = rect.top + scrollY + (rect.height * (0.3 + Math.random() * 0.4));

            var caminho = gerarCaminhoBezier(posicaoCursor, { x: targetX, y: targetY }, 12);
            for (var i = 0; i < caminho.length; i += 1) {
                posicaoCursor = caminho[i];
                try {
                    var evt = new MouseEvent('mousemove', {
                        bubbles: true,
                        cancelable: true,
                        clientX: posicaoCursor.x - scrollX,
                        clientY: posicaoCursor.y - scrollY,
                        view: window
                    });
                    el.dispatchEvent(evt);
                } catch (e) {}
                await workerSleep(12 + Math.floor(Math.random() * 8));
            }
        }

        async function clicarHumanizado(el) {
            if (!el) return false;
            await moverCursorPara(el);

            var rect = (typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect() : { left: 0, top: 0, width: 20, height: 20 };
            var cx = Math.round(rect.left + rect.width / 2);
            var cy = Math.round(rect.top + rect.height / 2);

            var eventProps = {
                bubbles: true,
                cancelable: true,
                view: (typeof window !== 'undefined' ? window : null),
                clientX: cx,
                clientY: cy
            };

            function despachar(tipo, Construtor) {
                try {
                    var Ctor = (typeof Construtor === 'function') ? Construtor : (typeof MouseEvent === 'function' ? MouseEvent : Event);
                    el.dispatchEvent(new Ctor(tipo, eventProps));
                } catch (e) {}
            }

            var PointerCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
            despachar('pointerover', PointerCtor);
            despachar('pointerenter', PointerCtor);
            despachar('pointerdown', PointerCtor);
            despachar('mousedown', MouseEvent);

            if (typeof el.focus === 'function') {
                try { el.focus(); } catch (e) {}
            }

            // Tempo mecânico de pressão do botão do mouse (60ms a 130ms)
            var tempoPressao = Math.round(boxMullerRandom(90, 18));
            await workerSleep(Math.max(50, Math.min(tempoPressao, 200)));

            despachar('pointerup', PointerCtor);
            despachar('mouseup', MouseEvent);
            despachar('click', MouseEvent);

            if (typeof el.click === 'function') {
                try { el.click(); } catch (e) {}
            }
            return true;
        }

        function registrarQuestaoColetada() {
            questoesNoBloco += 1;
        }

        function precisaDescansoBiologico(config) {
            if (!config || config.stealthCoffeeBreakAtivo === false) return false;
            return questoesNoBloco >= metaProximoDescanso;
        }

        function obterEstatisticasBloco() {
            return {
                questoesNoBloco: questoesNoBloco,
                metaProximoDescanso: metaProximoDescanso,
                restantesAteDescanso: Math.max(0, metaProximoDescanso - questoesNoBloco)
            };
        }

        function resetarBlocoDescanso(config) {
            questoesNoBloco = 0;
            var min = config && config.stealthIntervaloCoffeeBreakMin;
            var max = config && config.stealthIntervaloCoffeeBreakMax;
            metaProximoDescanso = sortearMetaDescanso(min, max);
        }

        function calcularTempoDescansoMs(config) {
            var media = (config && config.stealthCoffeeBreakDuracaoMedia) || 60000;
            var amostra = boxMullerRandom(media, media * 0.25);
            return Math.max(30000, Math.min(Math.round(amostra), 150000));
        }

        return {
            boxMullerRandom: boxMullerRandom,
            sampleLognormal: sampleLognormal,
            contarPalavras: contarPalavras,
            calcularTempoLeituraMs: calcularTempoLeituraMs,
            scrollOrganico: scrollOrganico,
            gerarCaminhoBezier: gerarCaminhoBezier,
            moverCursorPara: moverCursorPara,
            clicarHumanizado: clicarHumanizado,
            registrarQuestaoColetada: registrarQuestaoColetada,
            precisaDescansoBiologico: precisaDescansoBiologico,
            obterEstatisticasBloco: obterEstatisticasBloco,
            resetarBlocoDescanso: resetarBlocoDescanso,
            calcularTempoDescansoMs: calcularTempoDescansoMs
        };
    })();
