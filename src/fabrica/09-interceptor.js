    /* =====================================================================
     * INTERCEPTAÇÃO DO GABARITO (zero requisições extras)
     * ---------------------------------------------------------------------
     * O Angular do site carrega cada questão via XHR para
     * /api/cadernos/{id}/questoes/{index} — a resposta já contém o campo
     * oficial numeroAlternativaCorreta (1=A, 2=B...). Interceptamos essa
     * resposta e guardamos o gabarito em cache. O campo "status" NÃO é
     * confiável (verificado ao vivo: status=3 ≠ gabarito real) e é ignorado.
     * =================================================================== */
    function extrairGabaritoDoPayload(q) {
        var campos = ['numeroAlternativaCorreta', 'alternativaCorreta', 'gabaritoDefinitivo', 'gabaritoPreliminar', 'gabarito'];
        for (var i = 0; i < campos.length; i += 1) {
            var v = q[campos[i]];
            if (v === null || v === undefined || v === false || v === '') continue;
            var s = String(v).trim().toUpperCase();
            if (/^[A-E]$/.test(s)) return s;
            if (/^[1-5]$/.test(s)) return String.fromCharCode(64 + Number(s));
        }
        return null;
    }

    function camuflarFuncaoNativa(fnSubstituta, fnOriginal, nomeNativo) {
        try {
            var nome = nomeNativo || (fnOriginal && fnOriginal.name) || '';
            Object.defineProperty(fnSubstituta, 'name', { value: nome, configurable: true });
            Object.defineProperty(fnSubstituta, 'length', { value: (fnOriginal && fnOriginal.length) || 0, configurable: true });
            fnSubstituta.toString = function () {
                return 'function ' + nome + '() { [native code] }';
            };
        } catch (e) {}
        return fnSubstituta;
    }

    var GabaritoInterceptor = {
        cache: {},          // por idQuestao → letra
        cachePorIndex: {},  // por "cadernoId:index" → letra
        instalado: false,
        ultimoMetodo: null,
        estatisticas: { viaCache: 0, viaResolucaoVisivel: 0, viaClique: 0, semGabarito: 0 },
        processarRespostaJson: function (url, data) {
            try {
                var m = String(url || '').match(/\/api\/cadernos\/(\d+)\/questoes\/(\d+)/);
                if (!m || !data) return;
                var q = data.questao;
                if (q && q.idQuestao != null) {
                    var letra = extrairGabaritoDoPayload(q);
                    log('Resposta de questão observada na rede.', {
                        tipo: 'observacao', fase: 'coletando',
                        contexto: { cadernoId: m[1], indice: Number(m[2]), questaoId: String(q.idQuestao) }
                    });
                    if (letra) {
                        this.cache[String(q.idQuestao)] = letra;
                        this.cachePorIndex[m[1] + ':' + m[2]] = letra;
                        log('Gabarito capturado pela interceptação.', {
                            tipo: 'resultado', nivel: 'ok', fase: 'resolvendo',
                            contexto: { cadernoId: m[1], indice: Number(m[2]), questaoId: String(q.idQuestao), gabarito: letra, metodo: 'interceptacao' }
                        });
                    } else {
                        log('Resposta da questão não trouxe gabarito utilizável.', {
                            tipo: 'resultado', nivel: 'warn', fase: 'resolvendo',
                            contexto: { cadernoId: m[1], indice: Number(m[2]), questaoId: String(q.idQuestao), gabarito: null, metodo: 'interceptacao' }
                        });
                    }
                }
            } catch (e) {
                log('Resposta observada não pôde ser interpretada como questão.', {
                    tipo: 'evento', nivel: 'warn', fase: 'resolvendo',
                    contexto: { metodo: 'interceptacao', resultado: 'ignorada' }
                });
            }
        },
        instalar: function () {
            if (this.instalado) return;
            this.instalado = true;
            var interceptor = this;

            // 1. Interceptação camuflada de XMLHttpRequest
            if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
                var origOpen = XMLHttpRequest.prototype.open;
                var origSend = XMLHttpRequest.prototype.send;

                var novoOpen = function (method, url) {
                    this.__tecFabricaUrl = String(url || '');
                    return origOpen.apply(this, arguments);
                };
                camuflarFuncaoNativa(novoOpen, origOpen, 'open');
                XMLHttpRequest.prototype.open = novoOpen;

                var novoSend = function () {
                    var xhr = this;
                    this.addEventListener('load', function () {
                        try {
                            if (xhr.status === 200 && xhr.responseText) {
                                var data = JSON.parse(xhr.responseText);
                                interceptor.processarRespostaJson(xhr.__tecFabricaUrl, data);
                            }
                        } catch (e) {}
                    });
                    return origSend.apply(this, arguments);
                };
                camuflarFuncaoNativa(novoSend, origSend, 'send');
                XMLHttpRequest.prototype.send = novoSend;
            }

            // 2. Interceptação passiva de window.fetch caso utilizado
            if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
                var origFetch = window.fetch;
                var novoFetch = function () {
                    var args = arguments;
                    var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                    var promessa = origFetch.apply(this, args);
                    if (typeof promessa.then === 'function') {
                        promessa.then(function (res) {
                            try {
                                if (res && res.ok && typeof res.clone === 'function') {
                                    var clone = res.clone();
                                    clone.json().then(function (data) {
                                        interceptor.processarRespostaJson(url, data);
                                    }).catch(function () {});
                                }
                            } catch (e) {}
                        }).catch(function () {});
                    }
                    return promessa;
                };
                camuflarFuncaoNativa(novoFetch, origFetch, 'fetch');
                window.fetch = novoFetch;
            }
        },
        obterPorQuestaoId: function (id) { return this.cache[String(id)] || null; },
        obterPorIndex: function (cadernoId, index) { return this.cachePorIndex[String(cadernoId) + ':' + String(index)] || null; }
    };

