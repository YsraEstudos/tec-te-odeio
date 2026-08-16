/* =====================================================================
     * ANTI-TELEMETRIA & DISCRIÇÃO TOTAL
     * ---------------------------------------------------------------------
     * Minimiza o que sai do navegador:
     * 1. Bloqueia trackers de terceiros (analytics, anúncios, gravação de
     *    sessão) em XHR, fetch e sendBeacon — nenhum dado da sessão vaza
     *    para eles; só trafega o essencial do próprio site;
     * 2. Oculta sinais de automação (navigator.webdriver) — o navegador
     *    responde como uma sessão humana comum;
     * 3. Expõe as APIs internas de forma não-enumerável: Object.keys(),
     *    for-in e ferramentas de extensão não revelam o script.
     * =================================================================== */
    var ANTITRACKER_ALVOS = [
        'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
        'googleadservices.com', 'googlesyndication.com', 'doubleclick.net',
        'googletagmanager', 'amplitude.com', 'cdn.amplitude.com',
        'mixpanel.com', 'hotjar.com', 'static.hotjar.com', 'sentry.io',
        'browser.sentry-cdn.com', 'js-agent.newrelic.com', 'bam.nr-data.net',
        'segment.io', 'segment.com', 'connect.facebook.net',
        'facebook.com/tr', 'clarity.ms', 'logrocket.com', 'smartlook.com',
        'mouseflow.com', 'crazyegg.com', 'scorecardresearch.com',
        'posthog.com', 'inspectlet.com', 'fullstory.com', 'cdn.taboola.com',
        'outbrain.com', 'mc.yandex.ru', 'yandex.com/metrika',
        'tiktok.com/analytics', 'hubspot', 'intercom', 'crisp.chat',
        'freshchat.com', 'userpilot', 'appsflyer.com', 'kochava.com',
        'branch.io', 'adjust.com', 'chartbeat.com', 'parsely.com',
        'criteo.com', 'adnxs.com', 'rubiconproject.com', 'openx.net',
        'pubmatic.com', 'taboola.com', 'amazon-adsystem.com'
    ];

    function eAlvoTelemetria(url) {
        try {
            var u = String(url || '').toLowerCase();
            if (!/^https?:/i.test(u)) return false;
            for (var i = 0; i < ANTITRACKER_ALVOS.length; i += 1) {
                if (u.indexOf(ANTITRACKER_ALVOS[i]) !== -1) return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    function bloquearTelemetria() {
        try {
            var origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (metodo, url) {
                try {
                    if (eAlvoTelemetria(url)) url = 'about:blank';
                } catch (e) {}
                return origOpen.apply(this, arguments);
            };
        } catch (e) {}
        try {
            var origFetch = window.fetch;
            if (typeof origFetch === 'function') {
                window.fetch = function (input, init) {
                    var url = typeof input === 'string' ? input : (input && input.url) || '';
                    if (eAlvoTelemetria(url)) {
                        return Promise.reject(new TypeError('bloqueado pela anti-telemetria'));
                    }
                    return origFetch.apply(this, arguments);
                };
            }
        } catch (e) {}
        try {
            var origBeacon = navigator.sendBeacon;
            if (typeof origBeacon === 'function') {
                navigator.sendBeacon = function (url, data) {
                    if (eAlvoTelemetria(url)) return false;
                    return origBeacon.call(navigator, url, data);
                };
            }
        } catch (e) {}
    }

    function mascararFingerprint() {
        try {
            Object.defineProperty(navigator, 'webdriver', {
                get: function () { return undefined; }
            });
        } catch (e) {}
        try {
            Object.defineProperty(navigator, 'languages', {
                get: function () { return ['pt-BR', 'pt', 'en-US', 'en']; }
            });
        } catch (e) {}
    }

    function ocultarGlobal(chave, valor) {
        try {
            Object.defineProperty(window, chave, {
                value: valor,
                enumerable: false,
                writable: true,
                configurable: true
            });
        } catch (e) {}
    }