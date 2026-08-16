// ==UserScript==
// @name         Tec Concursos — Coletor Fantasma de Caderno
// @namespace    tec-coletor-fantasma
// @version      1.0.0
// @description  Coleta silenciosamente todas as questões do caderno aberto (enunciado + alternativas) e exporta um JSON pronto para PDF/Anki.
// @author       voce
// @match        https://www.tecconcursos.com.br/questoes/cadernos/*
// @match        https://www.google.com/recaptcha/api2/anchor*
// @match        https://www.recaptcha.net/recaptcha/api2/anchor*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* ============================================================
     * AUTO-CLIQUE NO reCAPTCHA (quando executado no iframe do Google)
     * ============================================================ */
    if (/(google\.com|recaptcha\.net)$/i.test(location.hostname) && /\/recaptcha\/api2\/anchor/i.test(location.pathname)) {
        (function autoClicarRecaptcha() {
            var tentativas = 0;
            var maxTentativas = 60;
            var iv = setInterval(function () {
                tentativas += 1;
                var anchor = document.getElementById('recaptcha-anchor');
                var border = document.querySelector('.recaptcha-checkbox-border');
                var checkbox = border || anchor;
                if (checkbox) {
                    var marcado = (anchor && anchor.getAttribute('aria-checked') === 'true') ||
                                  (anchor && anchor.classList.contains('recaptcha-checkbox-checked'));
                    var desabilitado = anchor && anchor.getAttribute('aria-disabled') === 'true';
                    if (marcado) {
                        clearInterval(iv);
                        return;
                    }
                    if (!desabilitado) {
                        clearInterval(iv);
                        setTimeout(function () {
                            try {
                                checkbox.click();
                            } catch (e) {
                                try {
                                    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                } catch (e2) {}
                            }
                        }, 350 + Math.floor(Math.random() * 350));
                    }
                }
                if (tentativas >= maxTentativas) {
                    clearInterval(iv);
                }
            }, 100);
        })();
        return;
    }

    /* ============================================================
     * ANTI-TELEMETRIA & DISCRIÇÃO
     * (nada de analytics/ads sai do navegador; o script não se denuncia)
     * ============================================================ */
    var ANTITRACKER_ALVOS = [
        'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
        'googleadservices.com', 'googlesyndication.com', 'doubleclick.net',
        'amplitude.com', 'cdn.amplitude.com', 'mixpanel.com', 'hotjar.com',
        'static.hotjar.com', 'sentry.io', 'browser.sentry-cdn.com',
        'js-agent.newrelic.com', 'bam.nr-data.net', 'segment.io', 'segment.com',
        'connect.facebook.net', 'facebook.com/tr', 'clarity.ms',
        'logrocket.com', 'smartlook.com', 'mouseflow.com', 'crazyegg.com',
        'scorecardresearch.com', 'posthog.com', 'inspectlet.com',
        'fullstory.com', 'cdn.taboola.com', 'outbrain.com', 'mc.yandex.ru',
        'yandex.com/metrika', 'tiktok.com/analytics', 'hubspot', 'intercom',
        'crisp.chat', 'freshchat.com', 'appsflyer.com', 'kochava.com',
        'criteo.com', 'adnxs.com', 'pubmatic.com', 'taboola.com'
    ];

    function eAlvoTelemetria(url) {
        try {
            var u = String(url || '').toLowerCase();
            if (!/^https?:/i.test(u)) return false;
            for (var i = 0; i < ANTITRACKER_ALVOS.length; i += 1) {
                if (u.indexOf(ANTITRACKER_ALVOS[i]) !== -1) return true;
            }
            return false;
        } catch (e) { return false; }
    }

    (function bloquearTelemetria() {
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
    })();

    (function mascararFingerprint() {
        try {
            Object.defineProperty(navigator, 'webdriver', {
                get: function () { return undefined; }
            });
        } catch (e) {}
    })();

    /* ============================================================
     * CONFIG
     * ============================================================ */
    var CONFIG = {
        delayMin: 3000,          // pausa mínima entre questões (ms)
        delayMax: 6000,          // pausa máxima entre questões (ms)
        imagemMaxBase64: 200 * 1024, // imagens <= 200KB viram base64 no JSON
        storageKey: 'tec_coletor_',  // prefixo da chave no IndexedDB
        pollInterval: 400,       // intervalo de verificação de carregamento (ms)
        loadTimeout: 20000       // tempo máximo esperando a questão carregar (ms)
    };

    /* ============================================================
     * ESTADO (persistido no IndexedDB)
     * ============================================================ */
    var cadernoId = (location.pathname.match(/cadernos\/(\d+)/) || [])[1] || 'desconhecido';
    var STORAGE_KEY = CONFIG.storageKey + cadernoId;

    var estado = {
        questoes: [],        // [{posicao, questaoId, titulo, enunciado, alternativas:[{letra,texto}]}]
        status: 'parado',    // 'parado' | 'coletando'
        iniciadoEm: null,
        ultimaPosicao: null,
        ultimaQuestaoId: null
    };

    /* O estado em memória mantém as imagens (base64) para a exportação;
     * o que vai para o IndexedDB é uma CÓPIA sem data:image embutidos,
     * para o JSON persistido ficar compacto. */
    var RE_DATA_IMAGE_B64 = /data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9=.\-]+)*;base64,[A-Za-z0-9+/=\s]+/gi;

    function sanitizarParaPersistencia(valor) {
        if (typeof valor === 'string') return valor.replace(RE_DATA_IMAGE_B64, '');
        if (valor === null || typeof valor !== 'object') return valor;
        if (Array.isArray(valor)) {
            var arr = [];
            for (var i = 0; i < valor.length; i += 1) arr.push(sanitizarParaPersistencia(valor[i]));
            return arr;
        }
        var out = {};
        Object.keys(valor).forEach(function (k) { out[k] = sanitizarParaPersistencia(valor[k]); });
        return out;
    }

    /* Persistência auxiliar: IndexedDB guarda o estado completo sanitizado
     * (melhor esforço — nunca bloqueia o loop de coleta). As gravações são
     * enfileiradas e executadas em ordem, para que uma transação antiga
     * nunca sobrescreva um estado mais novo (sem corrida entre saves). */
    var IDB_DB = 'tec_coletor_db';
    var IDB_STORE = 'estado';
    var idbFila = Promise.resolve();

    function idbAbrir() {
        return new Promise(function (resolve, reject) {
            try {
                if (!window.indexedDB) { reject(new Error('indexedDB indisponível')); return; }
                var req = window.indexedDB.open(IDB_DB, 1);
                req.onupgradeneeded = function () {
                    var db = req.result;
                    if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error || new Error('indexedDB falhou')); };
            } catch (e) { reject(e); }
        });
    }

    function idbOperacao(mode, callback) {
        return idbAbrir().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(IDB_STORE, mode);
                    callback(tx.objectStore(IDB_STORE));
                    tx.oncomplete = function () { db.close(); resolve(); };
                    tx.onerror = function () { db.close(); resolve(); };
                    tx.onabort = function () { db.close(); resolve(); };
                } catch (e) { try { db.close(); } catch (e2) { /* ignora */ } resolve(); }
            });
        });
    }

    function salvarEstadoIdb(json) {
        if (!window.indexedDB) return;
        // enfileira a gravação: executa em ordem, sem corrida entre saves rápidos
        idbFila = idbFila.then(function () {
            return idbOperacao('readwrite', function (store) {
                store.put({ key: STORAGE_KEY, salvoEm: Date.now(), json: json });
            });
        }).catch(function () { /* melhor esforço */ });
    }

    function carregarEstadoIdb() {
        return idbAbrir().then(function (db) {
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(IDB_STORE, 'readonly');
                    var store = tx.objectStore(IDB_STORE);
                    var req = store.get(STORAGE_KEY);
                    req.onsuccess = function () {
                        var rec = req.result;
                        db.close();
                        if (!rec || !rec.json) { resolve(null); return; }
                        try {
                            var parsed = JSON.parse(rec.json);
                            if (parsed && Array.isArray(parsed.questoes)) resolve(parsed);
                            else resolve(null);
                        } catch (e) { resolve(null); }
                    };
                    req.onerror = function () { db.close(); reject(req.error || new Error('falha na leitura do estado')); };
                } catch (e) { db.close(); reject(e); }
            });
        });
    }

    function limparEstadoIdb() {
        if (!window.indexedDB) return;
        // o delete também é enfileirado, garantindo que ocorra depois de
        // qualquer gravação pendente da sessão atual
        idbFila = idbFila.then(function () {
            return idbOperacao('readwrite', function (store) {
                store.delete(STORAGE_KEY);
            });
        }).catch(function () { /* melhor esforço */ });
    }

    /* Restaura o estado do IndexedDB ANTES de criar a UI e do auto-start.
     * Se o IndexedDB estiver indisponível ou a leitura falhar, começa com o
     * estado vazio (em memória) e avisa — sem fallback para outro storage. */
    function carregarEstado() {
        return carregarEstadoIdb().then(function (parsed) {
            if (parsed) {
                estado = parsed;
                atualizarPainel();
                log('Estado restaurado do IndexedDB.');
                return parsed;
            }
            return null;
        }).catch(function () {
            return null;
        });
    }

    function salvarEstado() {
        var json;
        try {
            json = JSON.stringify(sanitizarParaPersistencia(estado));
        } catch (e) {
            // Falha ao serializar: NUNCA chama parar() (evita recursão).
            log('ERRO: falha ao serializar o estado (' + (e && e.name || e) + ').');
            estado.status = 'parado';
            pararSolicitado = true;
            atualizarPainel();
            return;
        }
        // gravação assíncrona em IndexedDB (melhor esforço, enfileirada em
        // ordem; erros são capturados dentro de salvarEstadoIdb)
        salvarEstadoIdb(json);
    }

    /* ============================================================
     * TIMERS À PROVA DE ABA EM SEGUNDO PLANO
     * (Chrome limita setTimeout de abas ocultas a 1/min após 5 min;
     *  Web Workers mantêm ~1/s mesmo ocultos)
     * ============================================================ */
    function workerSleep(ms) {
        return new Promise(function (resolve) {
            try {
                var blob = new Blob(
                    ['onmessage=function(e){setTimeout(function(){postMessage(1)},e.data)}'],
                    { type: 'application/javascript' }
                );
                var w = new Worker(URL.createObjectURL(blob));
                w.onmessage = function () { w.terminate(); resolve(); };
                w.postMessage(ms);
            } catch (e) { setTimeout(resolve, ms); }
        });
    }

    function workerTick(intervalo, condicao, timeout, callback) {
        var inicio = Date.now();
        var w = null;
        try {
            var blob = new Blob(
                ['onmessage=function(e){setInterval(function(){postMessage(1)},e.data)}'],
                { type: 'application/javascript' }
            );
            w = new Worker(URL.createObjectURL(blob));
        } catch (e) { /* fallback abaixo */ }

        var tick = function () {
            if (condicao()) { if (w) w.terminate(); callback(true); return; }
            if (Date.now() - inicio > timeout) { if (w) w.terminate(); callback(false); return; }
        };
        if (w) {
            w.onmessage = tick;
            w.postMessage(intervalo);
        } else {
            var iv = setInterval(tick, intervalo);
            var orig = callback;
            callback = function (r) { clearInterval(iv); orig(r); };
            tick();
        }
    }

    /* ============================================================
     * EXTRAÇÃO
     * ============================================================ */
    var ATRIBUTOS_PERMITIDOS = new Set([
        'style', 'src', 'alt', 'href', 'colspan', 'rowspan',
        'width', 'height', 'align', 'valign', 'border',
        'cellpadding', 'cellspacing', 'title'
    ]);

    function limparHtml(el) {
        var clone = el.cloneNode(true);
        clone.querySelectorAll('script, style, iframe, button, input, select, textarea, form, noscript, .questao-enunciado-resolucao')
            .forEach(function (n) { n.remove(); });
        clone.querySelectorAll('*').forEach(function (n) {
            var attrs = Array.prototype.slice.call(n.attributes || []);
            attrs.forEach(function (a) {
                if (!ATRIBUTOS_PERMITIDOS.has(a.name)) n.removeAttribute(a.name);
            });
            if (n.tagName === 'IMG') {
                var src = n.getAttribute('src');
                if (src) n.setAttribute('src', new URL(src, location.href).href);
            }
            if (n.tagName === 'A') {
                var href = n.getAttribute('href');
                if (href && !/^https?:/i.test(href)) n.removeAttribute('href'); // links internos (.textoassociado etc.)
            }
        });
        return clone.innerHTML.trim();
    }

    function extrairQuestao() {
        var q = document.querySelector('.questao');
        var art = q && q.querySelector('article.questao-enunciado');
        if (!q || !art) return null;

        var h1 = document.querySelector('h1');
        var idm = h1 ? h1.textContent.match(/#(\d+)/) : null;

        var cont = document.querySelector('.questao-cabecalho-informacoes-numero');
        var cm = cont ? cont.textContent.match(/Quest[aã]o\s+(\d+)\s+de\s+(\d+)/i) : null;

        var txt = art.querySelector('.questao-enunciado-texto');
        var alternativas = Array.prototype.map.call(
            art.querySelectorAll('.questao-enunciado-alternativa'),
            function (li) {
                var letraEl = li.querySelector('.questao-enunciado-alternativa-opcao');
                var textoEl = li.querySelector('.questao-enunciado-alternativa-texto');
                return {
                    letra: letraEl ? letraEl.textContent.trim().replace(/[.):]\s*$/, '') : '',
                    texto: textoEl ? limparHtml(textoEl) : ''
                };
            }
        );

        return {
            posicao: cm ? parseInt(cm[1], 10) : null,
            total: cm ? parseInt(cm[2], 10) : null,
            questaoId: idm ? idm[1] : null,
            titulo: h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '',
            enunciado: txt ? limparHtml(txt) : '',
            alternativas: alternativas
        };
    }

    /* Imagens same-origin viram base64 SEM requisição extra: reutiliza o <img>
     * já carregado na página, desenha no canvas e converte na hora. Se a
     * imagem não estiver no DOM (ou o canvas falhar), mantém a URL — o
     * gerar_pdf.py baixa depois com Referer. */
    function enriquecerImagens(html) {
        var div = document.createElement('div');
        div.innerHTML = html;
        var imgs = div.querySelectorAll('img');
        if (!imgs.length) return Promise.resolve(html);

        imgs.forEach(function (img) {
            var src = img.getAttribute('src');
            if (!src || /^data:/i.test(src)) return;
            var url;
            try { url = new URL(src, location.href); } catch (e) { return; }
            if (url.origin !== location.origin) return; // cross-origin: Python baixa depois
            var vivo = null;
            var vivos = document.querySelectorAll('img');
            for (var i = 0; i < vivos.length; i += 1) {
                var s = vivos[i].getAttribute('src');
                if (!s) continue;
                try {
                    if (new URL(s, location.href).href === url.href) { vivo = vivos[i]; break; }
                } catch (e2) {}
            }
            if (!vivo || !vivo.complete) return; // não carregado no DOM: mantém URL
            try {
                var canvas = document.createElement('canvas');
                canvas.width = vivo.naturalWidth || vivo.width;
                canvas.height = vivo.naturalHeight || vivo.height;
                if (!canvas.width || !canvas.height) return;
                var ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.drawImage(vivo, 0, 0);
                var dataUrl = canvas.toDataURL('image/png');
                if (dataUrl.length <= CONFIG.imagemMaxBase64) img.setAttribute('src', dataUrl);
            } catch (e) { /* mantém URL */ }
        });
        return Promise.resolve(div.innerHTML);
    }

    /* ============================================================
     * NAVEGAÇÃO (mecanismo interno do Angular, verificado ao vivo)
     * ============================================================ */
    function navegarPara(numero) {
        try {
            var appEl = document.querySelector('[ng-app]') || document.body;
            var inj = angular.element(appEl).injector();
            inj.get('$rootScope').$broadcast('abrir-questao', numero);
            return true;
        } catch (e) {
            // Fallback: clique no botão "Próxima questão"
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
        var pos = lerPosicaoAtual() || '?';
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
        return id + '|' + pos + '|' + hash.toString(36);
    }

    function elementoVisivel(el) {
        if (!el || el.hidden || el.disabled) return false;
        if (/ng-hide/.test(String(el.className || ''))) return false;
        var modal = (typeof el.closest === 'function') ? el.closest('.modal') : null;
        if (modal) {
            if (modal.style && modal.style.display === 'none') return false;
            if (/ng-hide/.test(String(modal.className || ''))) return false;
            if (!/(^|\s)(in|show)(\s|$)/.test(modal.className || '') && modal.style.display !== 'block') return false;
        }
        if (el.offsetParent === null) {
            if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
                try {
                    var cs = window.getComputedStyle(el);
                    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
                    if (cs.position !== 'fixed') return false;
                } catch (e) {
                    return false;
                }
            } else {
                return false;
            }
        } else if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            try {
                var cs2 = window.getComputedStyle(el);
                if (cs2.display === 'none' || cs2.visibility === 'hidden' || cs2.opacity === '0') return false;
            } catch (e2) {}
        }
        if (typeof el.getBoundingClientRect === 'function') {
            try {
                var r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) return false;
            } catch (e3) {}
        }
        return true;
    }

    function modalRecaptchaAberto() {
        var limite = document.getElementById('recaptcha-limite-container');
        if (limite && elementoVisivel(limite)) {
            return true;
        }
        var modais = Array.from(document.querySelectorAll('.modal, .modal-body, .modal-dialog')).filter(elementoVisivel);
        for (var i = 0; i < modais.length; i += 1) {
            var txt = modais[i].textContent || '';
            if (/não é um robô|recaptcha|confirmação de robô/i.test(txt)) {
                return true;
            }
        }
        var bframes = Array.from(document.querySelectorAll('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]')).filter(function (ifr) {
            if (!elementoVisivel(ifr)) return false;
            if (typeof ifr.getBoundingClientRect === 'function') {
                try {
                    var r = ifr.getBoundingClientRect();
                    if (r.width < 100 || r.height < 100) return false;
                    if (r.bottom <= 0 || r.right <= 0) return false;
                } catch (e) {
                    return false;
                }
            }
            return true;
        });
        if (bframes.length > 0) {
            return true;
        }
        return false;
    }

    function aguardarQuestaoCarregar(questaoIdAnterior, assinaturaAnterior, callback) {
        var avisouCaptcha = false;
        workerTick(CONFIG.pollInterval, function () {
            if (modalRecaptchaAberto()) {
                if (!avisouCaptcha) {
                    avisouCaptcha = true;
                    log('Modal de verificação de robô (reCAPTCHA) detectado. Aguardando validação...');
                }
                return false;
            }
            // exige o ID da questão alterado E o conteúdo (article/texto) carregado;
            // quando uma assinatura anterior é informada, exige também que a
            // assinatura atual mude (rejeita artigo obsoleto).
            var idAtual = lerQuestaoIdAtual();
            if (!idAtual || idAtual === questaoIdAnterior) return false;
            if (!questaoConteudoPronta()) return false;
            if (assinaturaAnterior && assinaturaQuestao() === assinaturaAnterior) return false;
            return true;
        }, CONFIG.loadTimeout + 30000, callback);
    }

    /* ============================================================
     * LOOP DE COLETA
     * ============================================================ */
    var pararSolicitado = false;

    function boxMullerRandom(media, desvioPadrao) {
        var m = typeof media === 'number' ? media : 0;
        var dp = typeof desvioPadrao === 'number' ? desvioPadrao : 1;
        var u1 = 0, u2 = 0;
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
        return limpo ? limpo.split(/\s+/).filter(Boolean).length : 0;
    }

    function calcularTempoLeituraQuestao(questao) {
        var textoEnunciado = questao ? (questao.enunciado || '') : '';
        var textoAlternativas = '';
        if (questao && Array.isArray(questao.alternativas)) {
            questao.alternativas.forEach(function (alt) {
                if (alt) textoAlternativas += ' ' + (alt.texto || '');
            });
        }
        var totalPalavras = Math.max(15, contarPalavras(textoEnunciado) + contarPalavras(textoAlternativas));
        var tempoBaseMs = (totalPalavras / 220) * 60 * 1000;
        var complexidade = 1.0;
        if (/<table/i.test(textoEnunciado)) complexidade += 0.25;
        if (/<code|<pre/i.test(textoEnunciado)) complexidade += 0.35;
        var tempoCognitivo = (tempoBaseMs * complexidade) + 1500;
        var tempoFinalMs = Math.round(sampleLognormal(tempoCognitivo, 0.20));
        return Math.max(CONFIG.delayMin || 5000, Math.min(tempoFinalMs, 60000));
    }

    function pausaAleatoria(questao) {
        var ms = questao ? calcularTempoLeituraQuestao(questao) : (CONFIG.delayMin + Math.random() * (CONFIG.delayMax - CONFIG.delayMin));
        return workerSleep(Math.round(ms));
    }

    function coletarUma() {
        var questao = extrairQuestao();
        if (!questao || !questao.questaoId) {
            log('ERRO: não consegui extrair a questão atual. Parando.');
            parar();
            atualizarPainel();
            return Promise.resolve();
        }

        // dedupe por questaoId
        var jaExiste = estado.questoes.some(function (q) { return q.questaoId === questao.questaoId; });
        if (!jaExiste) {
            return enriquecerImagens(questao.enunciado).then(function (enunciadoFinal) {
                questao.enunciado = enunciadoFinal;
                estado.questoes.push(questao);
                estado.ultimaPosicao = questao.posicao;
                estado.ultimaQuestaoId = questao.questaoId;
                salvarEstado();
                log('[' + questao.posicao + '/' + questao.total + '] coletada #' + questao.questaoId + ' (total: ' + estado.questoes.length + ')');
                atualizarPainel();
            });
        }
        log('[' + questao.posicao + '/' + questao.total + '] já coletada #' + questao.questaoId + ' — pulando');
        return Promise.resolve();
    }

    function iniciar() {
        if (estado.status === 'coletando') return;
        pararSolicitado = false;
        estado.status = 'coletando';
        estado.iniciadoEm = estado.iniciadoEm || new Date().toISOString();
        salvarEstado();
        atualizarPainel();
        log('Iniciando coleta do caderno ' + cadernoId + '...');
        proximoPasso();
    }

    function proximoPasso() {
        if (pararSolicitado || estado.status !== 'coletando') return;

        var questao = extrairQuestao();
        if (!questao || !questao.questaoId) {
            // página ainda não carregou a questão — tenta de novo
            workerSleep(1000).then(proximoPasso);
            return;
        }

        coletarUma().then(function () {
            if (pararSolicitado || estado.status !== 'coletando') return;

            var pos = questao.posicao;
            var total = questao.total;

            if (pos !== null && total !== null && pos >= total) {
                log('Caderno completo (' + total + ' questões). Exportando...');
                exportar();
                parar();
                return;
            }

            atualizarPainel();
            pausaAleatoria(questao).then(function () {
                if (pararSolicitado || estado.status !== 'coletando') return;
                var idAtual = estado.ultimaQuestaoId;
                var assinaturaAtual = assinaturaQuestao();
                if (!navegarPara(pos + 1)) {
                    log('ERRO: não consegui navegar. Parando.');
                    parar();
                    atualizarPainel();
                    return;
                }
                aguardarQuestaoCarregar(idAtual, assinaturaAtual, function (ok) {
                    if (!ok) {
                        log('ERRO: a questão ' + (pos + 1) + ' não carregou a tempo. Parando.');
                        parar();
                        atualizarPainel();
                        return;
                    }
                    proximoPasso();
                });
            });
        });
    }

    function parar() {
        pararSolicitado = true;
        estado.status = 'parado';
        salvarEstado();
        atualizarPainel();
        log('Coleta pausada. ' + estado.questoes.length + ' questões salvas.');
    }

    /* ============================================================
     * EXPORTAÇÃO
     * ============================================================ */
    function exportar() {
        var tituloCaderno = (document.title || '').replace(/^Caderno\s+/i, '').trim();
        var payload = {
            caderno: cadernoId,
            titulo: tituloCaderno,
            total: estado.questoes.length ? (estado.questoes[estado.questoes.length - 1].total || null) : null,
            coletadas: estado.questoes.length,
            data: new Date().toISOString(),
            questoes: estado.questoes
        };
        var json = JSON.stringify(payload, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'meu_caderno_tec.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1000);
        log('Exportado meu_caderno_tec.json com ' + estado.questoes.length + ' questões (' + (json.length / 1024).toFixed(0) + ' KB).');
    }

    function limpar() {
        parar();
        estado = {
            questoes: [],
            status: 'parado',
            iniciadoEm: null,
            ultimaPosicao: null,
            ultimaQuestaoId: null
        };
        limparEstadoIdb();
        atualizarPainel();
        log('Dados locais apagados.');
    }

    /* ============================================================
     * PAINEL
     * ============================================================ */
    var painel = null;
    var painelTogglePendente = false;

    function criarPainel() {
        painel = document.createElement('div');
        painel.id = 'tec-coletor-painel';
        painel.innerHTML =
            '<div class="tcc-titulo">👻 Coletor Tec <span class="tcc-status"></span></div>' +
            '<div class="tcc-progresso"></div>' +
            '<div class="tcc-botoes">' +
            '  <button data-acao="iniciar">▶ Iniciar</button>' +
            '  <button data-acao="parar">⏸ Parar</button>' +
            '  <button data-acao="exportar">💾 Exportar</button>' +
            '  <button data-acao="limpar">🗑 Limpar</button>' +
            '</div>' +
            '<label class="tcc-opcao"><input type="checkbox" id="tcc-comecar1" checked> Começar da questão 1</label>' +
            '<label class="tcc-opcao"><input type="checkbox" id="tcc-auto" checked> Auto-iniciar ao abrir</label>';

        var css = document.createElement('style');
        css.textContent =
            '#tec-coletor-painel{position:fixed;top:12px;right:12px;z-index:999999;width:230px;padding:10px 12px;' +
            'background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:10px;' +
            'font:12px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);user-select:none}' +
            '#tec-coletor-painel .tcc-titulo{font-weight:700;margin-bottom:6px}' +
            '#tec-coletor-painel .tcc-status{font-weight:400;color:#94a3b8}' +
            '#tec-coletor-painel .tcc-progresso{color:#cbd5e1;margin-bottom:8px;min-height:16px}' +
            '#tec-coletor-painel .tcc-botoes{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}' +
            '#tec-coletor-painel button{flex:1;min-width:70px;padding:4px 6px;border:1px solid #475569;border-radius:6px;' +
            'background:#334155;color:#e2e8f0;cursor:pointer;font-size:11px}' +
            '#tec-coletor-painel button:hover{background:#475569}' +
            '#tec-coletor-painel .tcc-opcao{display:block;font-size:11px;color:#94a3b8;margin-top:4px;cursor:pointer}' +
            '#tec-coletor-painel .tcc-opcao input{margin-right:4px;vertical-align:middle}';
        document.head.appendChild(css);
        document.body.appendChild(painel);
        painel.style.display = painelTogglePendente ? 'block' : 'none';
        painelTogglePendente = false;

        painel.addEventListener('click', function (e) {
            var btn = e.target.closest('button');
            if (!btn) return;
            var acao = btn.getAttribute('data-acao');
            if (acao === 'iniciar') {
                var comecar1 = document.getElementById('tcc-comecar1').checked;
                var posAtual = lerPosicaoAtual();
                if (comecar1 && posAtual && posAtual > 1 && !estado.questoes.length) {
                    log('Pulando para a questão 1...');
                    var idSentinel = lerQuestaoIdAtual() || estado.ultimaQuestaoId || '';
                    var assinaturaSentinel = assinaturaQuestao();
                    navegarPara(1);
                    aguardarQuestaoCarregar(idSentinel, assinaturaSentinel, function () {
                        iniciar();
                    });
                } else {
                    iniciar();
                }
            } else if (acao === 'parar') { parar(); }
            else if (acao === 'exportar') { exportar(); }
            else if (acao === 'limpar') { limpar(); }
        });
    }

    function lerPosicaoAtual() {
        var cont = document.querySelector('.questao-cabecalho-informacoes-numero');
        var m = cont ? cont.textContent.match(/Quest[aã]o\s+(\d+)\s+de\s+(\d+)/i) : null;
        return m ? parseInt(m[1], 10) : null;
    }

    function atualizarPainel() {
        if (!painel) return;
        var statusEl = painel.querySelector('.tcc-status');
        var progEl = painel.querySelector('.tcc-progresso');
        statusEl.textContent = estado.status === 'coletando' ? '● coletando' : '○ parado';
        var pos = lerPosicaoAtual();
        var total = estado.questoes.length ? (estado.questoes[estado.questoes.length - 1].total || '?') : '?';
        progEl.textContent = 'Questão ' + (pos || '?') + ' de ' + total +
            ' — coletadas: ' + estado.questoes.length;
    }

    function log(msg) {
        // Silencioso: nenhum vestígio no Console. O progresso fica visível
        // apenas no painel (que também fica oculto até Alt+Shift+C).
    }

    function alternarPainel() {
        if (!painel) {
            painelTogglePendente = !painelTogglePendente;
            return;
        }
        painel.style.display = painel.style.display === 'none' ? 'block' : 'none';
    }

    /* ============================================================
     * INICIALIZAÇÃO
     * ============================================================ */
    function aguardarPaginaPronta(callback) {
        workerTick(CONFIG.pollInterval, function () {
            return !!document.querySelector('.questao article.questao-enunciado');
        }, 30000, callback);
    }

    function iniciarAuto() {
        var auto = document.getElementById('tcc-auto');
        if (auto && !auto.checked) return;
        if (estado.status === 'coletando') return;
        var comecar1 = document.getElementById('tcc-comecar1').checked;
        var posAtual = lerPosicaoAtual();
        if (comecar1 && posAtual && posAtual > 1 && !estado.questoes.length) {
            log('Auto-início: pulando para a questão 1...');
            var idSentinel = lerQuestaoIdAtual() || estado.ultimaQuestaoId || '';
            var assinaturaSentinel = assinaturaQuestao();
            navegarPara(1);
            aguardarQuestaoCarregar(idSentinel, assinaturaSentinel, function () {
                iniciar();
            });
        } else {
            iniciar();
        }
    }

    // O painel não depende do IndexedDB: o Edge pode bloquear storage e deixar
    // a abertura pendurada. A UI aparece imediatamente; o estado é restaurado
    // em segundo plano quando o navegador permitir.
    try {
        window.addEventListener('keydown', function (e) {
            var tecla = String(e.key || '').toLowerCase();
            if (e.altKey && e.shiftKey && (e.code === 'KeyC' || tecla === 'c' || tecla === 'ç')) {
                e.preventDefault();
                e.stopPropagation();
                alternarPainel();
            }
        }, true);
    } catch (e) {}

    criarPainel();
    atualizarPainel();
    carregarEstado().then(function () {
        atualizarPainel();
        aguardarPaginaPronta(function (ok) {
            if (!ok) { log('Página do caderno não carregou. Painel disponível para ação manual.'); return; }
            atualizarPainel();
            // pequena espera para o Angular estabilizar
            workerSleep(1500).then(iniciarAuto);
        });
    });
})();
