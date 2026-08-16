/* =====================================================================
     * ANTI-TELEMETRIA & DISCRIÇÃO TOTAL
     * ---------------------------------------------------------------------
     * Bloqueia destinos conhecidos de analytics/ads em APIs de conexão e
     * recursos DOM. Não tenta bloquear as requisições essenciais do próprio
     * TecConcursos nem o reCAPTCHA necessário à sessão.
     * =================================================================== */
    var ANTITRACKER_DOMINIOS = [
        'google-analytics.com', 'googletagmanager.com', 'googleadservices.com',
        'googlesyndication.com', 'doubleclick.net', 'amplitude.com',
        'mixpanel.com', 'hotjar.com', 'sentry.io', 'newrelic.com',
        'nr-data.net', 'segment.io', 'segment.com', 'facebook.com',
        'clarity.ms', 'logrocket.com', 'smartlook.com', 'mouseflow.com',
        'crazyegg.com', 'scorecardresearch.com', 'posthog.com',
        'inspectlet.com', 'fullstory.com', 'taboola.com', 'outbrain.com',
        'yandex.ru', 'yandex.com', 'tiktok.com', 'hubspot.com',
        'intercom.io', 'intercomcdn.com', 'crisp.chat', 'crisp.im',
        'freshchat.com', 'appsflyer.com', 'kochava.com', 'branch.io',
        'adjust.com', 'chartbeat.com', 'parsely.com', 'criteo.com',
        'adnxs.com', 'rubiconproject.com', 'openx.net', 'pubmatic.com',
        'amazon-adsystem.com'
    ];
    var ANTITRACKER_CAMINHO = /(?:^|\/)(?:analytics?|telemetry|tracking|beacon|collect|metrics?|events?|session-replay)(?:\/|$)/i;
    var ANTI_XHR_BLOQUEADO = '__tfAntiTelemetryBlocked';
    var ANTI_FUNCAO_MARCADA = '__tfAntiTelemetryWrapped';

    function urlDaEntradaTelemetria(entrada) {
        try {
            var valor = entrada && typeof entrada === 'object' && entrada.url !== undefined
                ? entrada.url : entrada;
            if (valor === undefined || valor === null || typeof URL !== 'function') return null;
            var url = new URL(String(valor), location.href);
            if (!/^(?:https?:|wss?:)$/i.test(url.protocol)) return null;
            return url;
        } catch (e) {
            return null;
        }
    }

    function dominioAlvo(hostname) {
        var host = String(hostname || '').toLowerCase().replace(/\.$/, '');
        for (var i = 0; i < ANTITRACKER_DOMINIOS.length; i += 1) {
            var dominio = ANTITRACKER_DOMINIOS[i];
            if (host === dominio || host.slice(-(dominio.length + 1)) === '.' + dominio) return true;
        }
        return false;
    }

    function eAlvoTelemetria(entrada) {
        var url = urlDaEntradaTelemetria(entrada);
        if (!url) return false;
        return dominioAlvo(url.hostname) || ANTITRACKER_CAMINHO.test(url.pathname);
    }

    function marcarFuncao(funcao) {
        try {
            Object.defineProperty(funcao, ANTI_FUNCAO_MARCADA, { value: true });
        } catch (e) {}
        return funcao;
    }

    function marcarXhr(xhr, bloqueado) {
        try {
            Object.defineProperty(xhr, ANTI_XHR_BLOQUEADO, {
                value: !!bloqueado,
                writable: true,
                configurable: true,
                enumerable: false
            });
        } catch (e) {
            try { xhr[ANTI_XHR_BLOQUEADO] = !!bloqueado; } catch (e2) {}
        }
    }

    function respostaVaziaParaTracker() {
        try {
            if (typeof Response === 'function') return Promise.resolve(new Response(null, { status: 204 }));
        } catch (e) {}
        return Promise.reject(new TypeError('requisição bloqueada'));
    }

    function resultadoFetchLaterBloqueado() {
        return { activated: false };
    }

    function bloquearRecursosDom() {
        try {
            if (typeof MutationObserver !== 'function') return;
            var observarElemento = function (elemento) {
                if (!elemento || elemento.nodeType !== 1) return;
                var nome = String(elemento.tagName || '').toLowerCase();
                var valores = [elemento.getAttribute('src'), elemento.getAttribute('href'), elemento.getAttribute('ping')];
                if (!valores.some(eAlvoTelemetria)) return;
                if (nome === 'a') {
                    elemento.removeAttribute('ping');
                } else if (nome === 'link') {
                    elemento.removeAttribute('href');
                } else {
                    elemento.removeAttribute('src');
                }
                if (nome === 'script' || nome === 'iframe') elemento.remove();
            };
            var observarArvore = function (raiz) {
                if (!raiz || raiz.nodeType !== 1) return;
                observarElemento(raiz);
                if (typeof raiz.querySelectorAll === 'function') {
                    raiz.querySelectorAll('[src],[href],[ping]').forEach(observarElemento);
                }
            };
            var observer = new MutationObserver(function (mutacoes) {
                mutacoes.forEach(function (mutacao) {
                    if (mutacao.type === 'attributes') observarElemento(mutacao.target);
                    else mutacao.addedNodes.forEach(observarArvore);
                });
            });
            observer.observe(document, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'href', 'ping']
            });
            if (document.readyState !== 'loading') observarArvore(document.documentElement);
            else document.addEventListener('DOMContentLoaded', function () { observarArvore(document.documentElement); }, { once: true });
        } catch (e) {}
    }

    function bloquearTelemetria() {
        try {
            var xhrProto = XMLHttpRequest.prototype;
            var origOpen = xhrProto.open;
            var origSend = xhrProto.send;
            if (typeof origOpen === 'function' && !origOpen[ANTI_FUNCAO_MARCADA]) {
                xhrProto.open = marcarFuncao(function (metodo, url) {
                    var bloqueado = eAlvoTelemetria(url);
                    marcarXhr(this, bloqueado);
                    if (bloqueado) {
                        try {
                            var args = Array.prototype.slice.call(arguments);
                            args[1] = 'about:blank';
                            return origOpen.apply(this, args);
                        } catch (e) { return undefined; }
                    }
                    return origOpen.apply(this, arguments);
                });
            }
            if (typeof origSend === 'function' && !origSend[ANTI_FUNCAO_MARCADA]) {
                xhrProto.send = marcarFuncao(function () {
                    if (this && this[ANTI_XHR_BLOQUEADO]) return undefined;
                    return origSend.apply(this, arguments);
                });
            }
        } catch (e) {}
        try {
            var origFetch = window.fetch;
            if (typeof origFetch === 'function' && !origFetch[ANTI_FUNCAO_MARCADA]) {
                window.fetch = marcarFuncao(function (input) {
                    if (eAlvoTelemetria(input)) return respostaVaziaParaTracker();
                    return origFetch.apply(this, arguments);
                });
            }
        } catch (e) {}
        try {
            var origFetchLater = window.fetchLater;
            if (typeof origFetchLater === 'function' && !origFetchLater[ANTI_FUNCAO_MARCADA]) {
                window.fetchLater = marcarFuncao(function (input) {
                    if (eAlvoTelemetria(input)) return resultadoFetchLaterBloqueado();
                    return origFetchLater.apply(this, arguments);
                });
            }
        } catch (e) {}
        try {
            var origBeacon = navigator.sendBeacon;
            if (typeof origBeacon === 'function' && !origBeacon[ANTI_FUNCAO_MARCADA]) {
                navigator.sendBeacon = marcarFuncao(function (url) {
                    if (eAlvoTelemetria(url)) return false;
                    return origBeacon.apply(navigator, arguments);
                });
            }
        } catch (e) {}
        bloquearRecursosDom();
    }

    function mascararFingerprint() {
        // webdriver é um sinal explícito de automação. Outros valores do
        // navigator não são falsificados: inconsistências aumentam a entropia.
        try {
            var atual = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
            if (!atual || atual.configurable !== false) {
                Object.defineProperty(navigator, 'webdriver', {
                    get: function () { return undefined; },
                    enumerable: atual ? atual.enumerable : false,
                    configurable: true
                });
            }
        } catch (e) {}
    }

    function ocultarGlobal(chave, valor) {
        try {
            Object.defineProperty(window, chave, {
                value: valor,
                enumerable: false,
                writable: false,
                configurable: false
            });
        } catch (e) {}
    }
