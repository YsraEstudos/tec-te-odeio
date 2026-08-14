    /* =====================================================================
     * DOM HELPERS
     * =================================================================== */
    function clean(value) {
        return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function visiveis(sel) {
        return Array.from(document.querySelectorAll(sel)).filter(function (n) {
            if (!n || n.hidden || n.disabled) return false;
            if (/ng-hide/.test(String(n.className || ''))) return false;
            return n.offsetParent !== null;
        });
    }

    function primeiro(sel) {
        return visiveis(sel)[0] || null;
    }

    function mesmoTexto(a, b) {
        return clean(a).toLocaleLowerCase('pt-BR') === clean(b).toLocaleLowerCase('pt-BR');
    }

    function setInput(input, valor) {
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, valor);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function esperar(predicate, timeout, message) {
        return new Promise(function (resolve, reject) {
            var done = false;
            workerTick(CONFIG.pollInterval, function () { return predicate(); }, timeout, function (ok) {
                if (done) return;
                done = true;
                if (ok) resolve(true);
                else reject(new Error(message || 'Tempo esgotado aguardando condição.'));
            });
        });
    }

    function pausaAleatoria() {
        var ms = CONFIG.delayMin + Math.random() * (CONFIG.delayMax - CONFIG.delayMin);
        return workerSleep(Math.round(ms));
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


