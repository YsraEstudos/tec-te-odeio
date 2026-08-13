    /* =====================================================================
     * PÁGINAS / NAVEGAÇÃO
     * =================================================================== */
    function paginaAtual() {
        var path = location.pathname || '';
        if (/\/questoes\/cadernos\/\d+\/imprimir/i.test(path)) return 'impressao';
        if (/\/questoes\/cadernos\/\d+/i.test(path)) return 'caderno';
        if (/\/questoes\/filtrar/i.test(path)) return 'filtros';
        if (/\/questoes\/pastas\/\d+/i.test(path)) return 'pasta';
        return 'outra';
    }

    function cadernoIdDaUrl() {
        var m = (location.pathname || '').match(/\/questoes\/cadernos\/(\d+)/i);
        return m ? m[1] : '';
    }

    function pastaIdDaUrl() {
        var m = (location.pathname || '').match(/\/questoes\/pastas\/(\d+)/i) || (location.search.match(/idPasta=(\d+)/) || []);
        return m ? m[1] : '';
    }

    function irPara(url) {
        return new Promise(function (resolve) {
            if (location.href.split('?')[0] === url.split('?')[0]) { resolve(true); return; }
            salvarEstado(true);
            var done = false;
            var t0 = Date.now();
            workerTick(300, function () {
                var cur = location.href;
                return cur.split('?')[0] === url.split('?')[0] || Date.now() - t0 > 30000;
            }, 30000, function () { if (!done) { done = true; resolve(true); } });
            location.href = url;
        });
    }

    function navegarQuestao(numero) {
        try {
            salvarEstado(true);
            var appEl = document.querySelector('[ng-app]') || document.body;
            var inj = angular.element(appEl).injector();
            inj.get('$rootScope').$broadcast('abrir-questao', numero);
            return true;
        } catch (e) {
            var btn = document.querySelector("button[ng-click*='questaoSeguinte']");
            if (btn) { btn.click(); return true; }
            return false;
        }
    }

    function lerQuestaoIdAtual() {
        var h1 = document.querySelector('h1');
        return h1 ? (h1.textContent.match(/#(\d+)/) || [])[1] : null;
    }

    function questaoConteudoPronta() {
        var art = document.querySelector('article.questao-enunciado');
        if (!art) return false;
        var txt = art.querySelector('.questao-enunciado-texto');
        if (txt && txt.textContent && txt.textContent.trim()) return true;
        return art.querySelectorAll('.questao-enunciado-alternativa').length > 0;
    }

    // Assinatura compacta do conteúdo atual da questão (ID + posição + hash do
    // texto completo). Usada para rejeitar artigo obsoleto após a navegação.
    function assinaturaQuestao() {
        var id = lerQuestaoIdAtual() || '?';
        var pos = lerPosicao();
        var art = document.querySelector('article.questao-enunciado');
        var texto = '';
        if (art) {
            var el = art.querySelector('.questao-enunciado-texto') || art;
            if (el && el.textContent) texto = el.textContent.trim();
        }
        var hash = 5381;
        for (var i = 0; i < texto.length; i += 1) {
            hash = ((hash * 33) ^ texto.charCodeAt(i)) >>> 0;
        }
        return id + '|' + (pos ? (pos.posicao + '/' + pos.total) : '?') + '|' + hash.toString(36);
    }

    function aguardarQuestaoMudar(idAnterior, assinaturaAnterior, callback) {
        workerTick(CONFIG.pollInterval, function () {
            // exige o ID da questão alterado E o conteúdo (article/texto) carregado;
            // quando uma assinatura anterior é informada, exige também que a
            // assinatura atual mude (rejeita artigo obsoleto).
            var idAtual = lerQuestaoIdAtual();
            if (!idAtual || idAtual === idAnterior) return false;
            if (!questaoConteudoPronta()) return false;
            if (assinaturaAnterior && assinaturaQuestao() === assinaturaAnterior) return false;
            return true;
        }, CONFIG.loadTimeout, callback);
    }

    function lerPosicao() {
        var cont = document.querySelector('.questao-cabecalho-informacoes-numero');
        var m = cont ? cont.textContent.match(/Quest[aã]o\s+(\d+)\s+de\s+(\d+)/i) : null;
        return m ? { posicao: parseInt(m[1], 10), total: parseInt(m[2], 10) } : null;
    }
