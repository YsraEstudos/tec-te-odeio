    /* =====================================================================
     * INTERCEPTAÇÃO DO GABARITO (zero requisições extras)
     * ---------------------------------------------------------------------
     * O Angular do site carrega cada questão via XHR para
     * /api/cadernos/{id}/questoes/{index} — a resposta já contém o campo
     * oficial numeroAlternativaCorreta (1=A, 2=B...). Interceptamos essa
     * resposta e guardamos o gabarito em cache. O campo "status" NÃO é
     * confiável (verificado ao vivo: status=3 ≠ gabarito real) e é ignorado.
     * =================================================================== */
    var CAMPOS_GABARITO = ['numeroAlternativaCorreta', 'alternativaCorreta', 'gabaritoDefinitivo', 'gabaritoPreliminar', 'gabarito'];

    function payloadDeclaraCampoGabarito(q) {
        if (!q || typeof q !== 'object') return false;
        for (var i = 0; i < CAMPOS_GABARITO.length; i += 1) {
            if (Object.prototype.hasOwnProperty.call(q, CAMPOS_GABARITO[i])) return true;
        }
        return false;
    }

    function payloadConfirmaAusenciaGabarito(q) {
        var encontrou = false;
        for (var i = 0; i < CAMPOS_GABARITO.length; i += 1) {
            if (!Object.prototype.hasOwnProperty.call(q, CAMPOS_GABARITO[i])) continue;
            encontrou = true;
            var valor = q[CAMPOS_GABARITO[i]];
            if (valor !== null && valor !== undefined && valor !== false && valor !== '' && valor !== 0 && valor !== '0') {
                return false;
            }
        }
        return encontrou;
    }

    function extrairGabaritoDoPayload(q) {
        for (var i = 0; i < CAMPOS_GABARITO.length; i += 1) {
            var v = q[CAMPOS_GABARITO[i]];
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
            Object.defineProperty(fnSubstituta, 'toString', {
                value: function () { return 'function ' + nome + '() { [native code] }'; },
                configurable: true
            });
        } catch (e) {}
        return fnSubstituta;
    }

    var urlsDeXhr = null;
    try { urlsDeXhr = new WeakMap(); } catch (e) { urlsDeXhr = null; }

    // Localiza o objeto da questão dentro do scope Angular (o dado que o
    // próprio site carregou). Nenhum patch de nativo: apenas leitura dos
    // objetos que a aplicação já mantém em memória.
    function acharObjetoQuestaoNoScope(scope) {
        if (!scope) return null;
        var nomesConhecidos = ['questao', 'q', 'item', 'questaoAtual'];
        var i, v;
        for (i = 0; i < nomesConhecidos.length; i += 1) {
            v = scope[nomesConhecidos[i]];
            if (v && typeof v === 'object' && (v.idQuestao != null || v.numeroAlternativaCorreta != null)) return v;
        }
        var chaves = Object.keys(scope);
        for (i = 0; i < chaves.length; i += 1) {
            v = scope[chaves[i]];
            if (v && typeof v === 'object' && (v.idQuestao != null || v.numeroAlternativaCorreta != null)) return v;
        }
        if (scope.vm && typeof scope.vm === 'object' && scope.vm.questao &&
            (scope.vm.questao.idQuestao != null || scope.vm.questao.numeroAlternativaCorreta != null)) {
            return scope.vm.questao;
        }
        if (scope.ctrl && typeof scope.ctrl === 'object' && scope.ctrl.questao &&
            (scope.ctrl.questao.idQuestao != null || scope.ctrl.questao.numeroAlternativaCorreta != null)) {
            return scope.ctrl.questao;
        }
        return null;
    }

    var GabaritoInterceptor = {
        cache: {},          // por idQuestao → letra
        cachePorIndex: {},  // por "cadernoId:index" → letra
        cacheSemGabarito: {},   // por idQuestao → true (payload chegou e NÃO tem gabarito)
        semGabaritoPorIndex: {}, // por "cadernoId:index" → true
        payloadsVistos: 0,  // quantos payloads de questão foram observados nesta sessão
        instalado: false,
        ultimoMetodo: null,
        estatisticas: { viaCache: 0, viaResolucaoVisivel: 0, viaClique: 0, viaRapido: 0, semGabarito: 0 },
        processarRespostaJson: function (url, data) {
            try {
                var m = String(url || '').match(/\/api\/cadernos\/(\d+)\/questoes\/(\d+)/);
                if (!m || !data) return;
                this.payloadsVistos += 1;
                var q = data.questao;
                if (q && q.idQuestao != null) {
                    var letra = extrairGabaritoDoPayload(q);
                    var chave = String(q.idQuestao);
                    var porIndex = m[1] + ':' + m[2];
                    log('Resposta de questão observada na rede.', {
                        tipo: 'observacao', fase: 'coletando',
                        contexto: { cadernoId: m[1], indice: Number(m[2]), questaoId: chave }
                    });
                    if (letra) {
                        this.cache[chave] = letra;
                        this.cachePorIndex[porIndex] = letra;
                        delete this.cacheSemGabarito[chave];
                        delete this.semGabaritoPorIndex[porIndex];
                        log('Gabarito capturado pela interceptação.', {
                            tipo: 'resultado', nivel: 'ok', fase: 'resolvendo',
                            contexto: { cadernoId: m[1], indice: Number(m[2]), questaoId: chave, gabarito: letra, metodo: 'interceptacao' }
                        });
                    } else if (payloadConfirmaAusenciaGabarito(q)) {
                        this.cacheSemGabarito[chave] = true;
                        this.semGabaritoPorIndex[porIndex] = true;
                        log('Resposta da questão não trouxe gabarito utilizável.', {
                            tipo: 'resultado', nivel: 'warn', fase: 'resolvendo',
                            contexto: { cadernoId: m[1], indice: Number(m[2]), questaoId: chave, gabarito: null, metodo: 'interceptacao' }
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
        // Leitura passiva do scope Angular: zero patches em nativos. Se o
        // objeto da questão já estiver renderizado no próprio site, o
        // gabarito (ou a ausência dele) é registrado nos mesmos caches.
        lerGabaritoDoScope: function (artigo) {
            try {
                if (typeof angular === 'undefined' || !artigo || typeof angular.element !== 'function') return null;
                var el = angular.element(artigo);
                var scope = (typeof el.scope === 'function') ? el.scope() : null;
                for (var profundidade = 0; profundidade < 8 && scope; profundidade += 1) {
                    var objeto = acharObjetoQuestaoNoScope(scope);
                    if (objeto && objeto.idQuestao != null && payloadDeclaraCampoGabarito(objeto)) {
                        var chave = String(objeto.idQuestao);
                        var letra = extrairGabaritoDoPayload(objeto);
                        if (letra) {
                            this.cache[chave] = letra;
                            delete this.cacheSemGabarito[chave];
                        } else if (payloadConfirmaAusenciaGabarito(objeto)) {
                            this.cacheSemGabarito[chave] = true;
                        } else {
                            scope = scope.$parent;
                            continue;
                        }
                        this.payloadsVistos += 1;
                        return { questaoId: chave, letra: letra || null };
                    }
                    scope = scope.$parent;
                }
                return null;
            } catch (e) {
                return null;
            }
        },
        // Decisão para a coleta: 'com-gabarito' (letra pronta) |
        // 'sem-gabarito' (payload ou scope confirmaram ausência) |
        // 'desconhecido' (nenhuma das fontes falou ainda).
        consultarGabaritoQuestao: function (questaoId, artigo) {
            var chave = String(questaoId == null ? '' : questaoId);
            if (!chave) return { estado: 'desconhecido' };
            if (this.cache[chave]) return { estado: 'com-gabarito', letra: this.cache[chave] };
            if (this.cacheSemGabarito[chave]) return { estado: 'sem-gabarito' };
            var doScope = this.lerGabaritoDoScope(artigo);
            if (doScope && doScope.questaoId) {
                if (this.cache[doScope.questaoId]) return { estado: 'com-gabarito', letra: this.cache[doScope.questaoId] };
                if (this.cacheSemGabarito[doScope.questaoId]) return { estado: 'sem-gabarito' };
            }
            return { estado: 'desconhecido' };
        },
        instalar: function () {
            if (this.instalado) return;
            this.instalado = true;
            var interceptor = this;
            var configGlobal = (typeof CONFIG === 'object' && CONFIG) || {};

            // 1. Interceptação camuflada de XMLHttpRequest
            //    A URL é guardada em WeakMap (invisível na enumeração de
            //    propriedades do XHR; antes era uma propriedade própria
            //    enumerável, um rastro detectável).
            if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
                var origOpen = XMLHttpRequest.prototype.open;
                var origSend = XMLHttpRequest.prototype.send;

                var novoOpen = function (method, url) {
                    if (urlsDeXhr) {
                        try { urlsDeXhr.set(this, String(url || '')); } catch (e) {}
                    }
                    return origOpen.apply(this, arguments);
                };
                camuflarFuncaoNativa(novoOpen, origOpen, 'open');
                XMLHttpRequest.prototype.open = novoOpen;

                var novoSend = function () {
                    var xhr = this;
                    var url = '';
                    if (urlsDeXhr) {
                        try { url = urlsDeXhr.get(xhr) || ''; } catch (e) {}
                    }
                    this.addEventListener('load', function () {
                        try {
                            if (xhr.status === 200 && xhr.responseText) {
                                var data = JSON.parse(xhr.responseText);
                                interceptor.processarRespostaJson(url, data);
                            }
                        } catch (e) {}
                    });
                    return origSend.apply(this, arguments);
                };
                camuflarFuncaoNativa(novoSend, origSend, 'send');
                XMLHttpRequest.prototype.send = novoSend;
            }

            // 2. Interceptação passiva de window.fetch — desligada por padrão:
            //    o AngularJS do site usa XHR, e cada patch extra é superfície
            //    de detecção sem benefício. Reativa com CONFIG.interceptarFetch.
            if (configGlobal.interceptarFetch === true &&
                typeof window !== 'undefined' && typeof window.fetch === 'function') {
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
        obterPorIndex: function (cadernoId, index) { return this.cachePorIndex[String(cadernoId) + ':' + String(index)] || null; },
        obterSemGabaritoPorQuestaoId: function (id) { return this.cacheSemGabarito[String(id)] === true; },
        obterSemGabaritoPorIndex: function (cadernoId, index) { return this.semGabaritoPorIndex[String(cadernoId) + ':' + String(index)] === true; }
    };

