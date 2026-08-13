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

