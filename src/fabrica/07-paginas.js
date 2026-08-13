    /* =====================================================================
     * PÁGINAS / NAVEGAÇÃO
     * =================================================================== */
    function paginaAtual() {
        var path = location.pathname || '';
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
            var origem = location.pathname || '';
            var destino = String(url || '').split('?')[0];
            if (location.href.split('?')[0] === url.split('?')[0]) {
                log('Navegação dispensada: a rota já está aberta.', {
                    tipo: 'decisao', nivel: 'info', fase: estado.fase || 'navegando',
                    contexto: { origem: origem, destino: destino, resultado: 'mesma-rota' }
                });
                resolve(true);
                return;
            }
            log('Tentando navegar para a próxima etapa.', {
                tipo: 'tentativa', fase: estado.fase || 'navegando',
                contexto: { origem: origem, destino: destino }
            });
            salvarEstado(true);
            var done = false;
            var t0 = Date.now();
            workerTick(300, function () {
                var cur = location.href;
                return cur.split('?')[0] === url.split('?')[0] || Date.now() - t0 > 30000;
            }, 30000, function () {
                if (!done) {
                    done = true;
                    log('Navegação encerrada; o próximo boot continuará a fase.', {
                        tipo: 'resultado', nivel: location.href.split('?')[0] === url.split('?')[0] ? 'ok' : 'warn',
                        fase: estado.fase || 'navegando',
                        contexto: { origem: origem, destino: destino, decorridoMs: Date.now() - t0 }
                    });
                    resolve(true);
                }
            });
            location.href = url;
        });
    }

    function navegarQuestao(numero) {
        log('Tentando abrir a questão solicitada.', {
            tipo: 'tentativa', fase: 'coletando',
            contexto: { numero: Number(numero), questaoAtual: lerQuestaoIdAtual() || null }
        });
        try {
            salvarEstado(true);
            var appEl = document.querySelector('[ng-app]') || document.body;
            var inj = angular.element(appEl).injector();
            inj.get('$rootScope').$broadcast('abrir-questao', numero);
            log('Abertura da questão enviada ao Angular.', {
                tipo: 'resultado', nivel: 'ok', fase: 'coletando',
                contexto: { numero: Number(numero), metodo: 'angular' }
            });
            return true;
        } catch (e) {
            var btn = document.querySelector("button[ng-click*='questaoSeguinte']");
            if (btn) {
                btn.click();
                log('Abertura da questão feita pelo botão de avanço.', {
                    tipo: 'resultado', nivel: 'ok', fase: 'coletando',
                    contexto: { numero: Number(numero), metodo: 'botao', motivoAngular: 'indisponivel' }
                });
                return true;
            }
            log('Não foi possível abrir a questão solicitada.', {
                tipo: 'resultado', nivel: 'erro', fase: 'coletando',
                contexto: { numero: Number(numero), metodo: 'nenhum', motivo: 'controles indisponiveis' }
            });
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

    function normalizarNumeroInterface(valor) {
        var texto = String(valor == null ? '' : valor).replace(/\s/g, '');
        if (!/^\d[\d.,]*$/.test(texto)) return null;
        var numero = parseInt(texto.replace(/[.,]/g, ''), 10);
        return numero > 0 ? numero : null;
    }

    function lerPosicao() {
        var cont = document.querySelector('.questao-cabecalho-informacoes-numero');
        if (!cont) {
            log('Posição da questão ainda não está disponível no DOM.', {
                tipo: 'observacao', nivel: 'warn', fase: 'coletando',
                contexto: { resultado: 'elemento-ausente' }
            });
            return null;
        }
        var texto = String(cont.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        var m = texto.match(/Quest[aã]o\s+([\d.,\s]+)\s+de\s+([\d.,\s]+)/i);
        var posicao = m ? normalizarNumeroInterface(m[1]) : null;
        var total = m ? normalizarNumeroInterface(m[2]) : null;
        if (!posicao || !total) {
            log('Posição da questão não pôde ser interpretada.', {
                tipo: 'observacao', nivel: 'warn', fase: 'coletando',
                contexto: { resultado: 'texto-incompativel', textoCabecalho: texto }
            });
            return null;
        }
        return { posicao: posicao, total: total };
    }
