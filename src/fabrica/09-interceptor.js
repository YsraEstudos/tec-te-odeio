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

    var GabaritoInterceptor = {
        cache: {},          // por idQuestao → letra
        cachePorIndex: {},  // por "cadernoId:index" → letra
        instalado: false,
        estatisticas: { viaCache: 0, viaResolucaoVisivel: 0, viaClique: 0, semGabarito: 0 },
        instalar: function () {
            if (this.instalado) return;
            this.instalado = true;
            var interceptor = this;
            var origOpen = XMLHttpRequest.prototype.open;
            var origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (method, url) {
                this.__tecFabricaUrl = String(url || '');
                return origOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function () {
                var xhr = this;
                this.addEventListener('load', function () {
                    try {
                        var m = String(xhr.__tecFabricaUrl || '').match(/\/api\/cadernos\/(\d+)\/questoes\/(\d+)/);
                        if (m && xhr.status === 200) {
                            var data = JSON.parse(xhr.responseText);
                            var q = data && data.questao;
                            if (q && q.idQuestao != null) {
                                var letra = extrairGabaritoDoPayload(q);
                                if (letra) {
                                    interceptor.cache[String(q.idQuestao)] = letra;
                                    interceptor.cachePorIndex[m[1] + ':' + m[2]] = letra;
                                }
                            }
                        }
                    } catch (e) { /* resposta não-JSON ou irrelevante */ }
                });
                return origSend.apply(this, arguments);
            };
        },
        obterPorQuestaoId: function (id) { return this.cache[String(id)] || null; },
        obterPorIndex: function (cadernoId, index) { return this.cachePorIndex[String(cadernoId) + ':' + String(index)] || null; }
    };

