    /* =====================================================================
     * LOG OPERACIONAL ESTRUTURADO
     * =================================================================== */
    var LOG_MAX_EVENTOS = 600;
    var LOG_MAX_STRING = 280;
    var LOG_MAX_FASE = 80;
    var LOG_PERSIST_DEBOUNCE_MS = 250;
    var LOG_TIPOS = { observacao: true, decisao: true, tentativa: true, resultado: true, erro: true, evento: true };
    var LOG_NIVEIS = { info: true, ok: true, warn: true, erro: true };
    var logSequencia = 0;
    var logPersistTimer = null;

    function chaveSensivelLog(chave) {
        return /token|cookie|authorization|senha|password|secret|session|credential|innerhtml|responsetext|querystring/i.test(String(chave));
    }

    function truncarStringLog(valor, limite) {
        var texto;
        try { texto = String(valor); } catch (e) { texto = '[valor indisponível]'; }
        return texto.length > limite ? texto.slice(0, limite) : texto;
    }

    function normalizarValorLog(valor, vistos, profundidade, dentroDeArray) {
        if (valor === null) return null;
        var tipo = typeof valor;
        if (tipo === 'string') return truncarStringLog(valor, LOG_MAX_STRING);
        if (tipo === 'boolean') return valor;
        if (tipo === 'number') return isFinite(valor) ? valor : null;
        if (tipo === 'undefined' || tipo === 'function' || tipo === 'symbol' || tipo === 'bigint') {
            return dentroDeArray ? null : undefined;
        }
        if (profundidade >= 6) return '[profundidade limitada]';
        if (Object.prototype.toString.call(valor) === '[object Date]') {
            try { return isNaN(valor.getTime()) ? null : valor.toISOString(); } catch (e) { return null; }
        }
        if (vistos.indexOf(valor) !== -1) return '[referência circular]';
        vistos.push(valor);
        var resultado;
        if (Array.isArray(valor)) {
            resultado = valor.slice(0, 20).map(function (item) {
                return normalizarValorLog(item, vistos, profundidade + 1, true);
            });
        } else {
            resultado = {};
            Object.keys(valor).some(function (chave) {
                if (Object.keys(resultado).length >= 16 || chaveSensivelLog(chave)) return Object.keys(resultado).length >= 16;
                var item;
                try { item = valor[chave]; } catch (e) { item = '[valor indisponível]'; }
                var normalizado = normalizarValorLog(item, vistos, profundidade + 1, false);
                if (normalizado !== undefined) resultado[chave] = normalizado;
                return Object.keys(resultado).length >= 16;
            });
        }
        vistos.pop();
        return resultado;
    }

    function normalizarContextoLog(valor) {
        return normalizarValorLog(valor, [], 0, false);
    }

    function formatarEventoLog(evento) {
        var item = evento || {};
        var linha = String(item.at || '') + ' [' + String(item.nivel || 'info') + '] [' +
            String(item.tipo || 'evento') + '] [' + String(item.fase || 'nenhuma') + '] ' + String(item.mensagem || '');
        if (item.contexto !== undefined && item.contexto !== null) {
            try { linha += ' ' + JSON.stringify(item.contexto); } catch (e) { linha += ' [contexto indisponível]'; }
        }
        return linha;
    }

    function obterEstadoParaLog() {
        return typeof estado !== 'undefined' && estado && typeof estado === 'object' ? estado : null;
    }

    function agendarPersistenciaLog() {
        if (typeof setTimeout !== 'function') return;
        if (logPersistTimer !== null && typeof clearTimeout === 'function') clearTimeout(logPersistTimer);
        logPersistTimer = setTimeout(function () {
            logPersistTimer = null;
            if (typeof salvarEstado !== 'function') return;
            try {
                salvarEstado();
            } catch (e) {
                log('Falha interna ao persistir o log: ' + String(e && e.message || e), {
                    tipo: 'erro', nivel: 'erro', persist: false
                });
            }
        }, LOG_PERSIST_DEBOUNCE_MS);
    }

    function log(mensagem, opcoes) {
        var options = opcoes && typeof opcoes === 'object' ? opcoes : {};
        var state = obterEstadoParaLog();
        if (state && Array.isArray(state.logs)) {
            state.logs.forEach(function (item) {
                if (item && Number.isFinite(Number(item.id)) && Number(item.id) > logSequencia) logSequencia = Number(item.id);
            });
        }
        var tipo = LOG_TIPOS[options.tipo] ? options.tipo : 'evento';
        var nivel = LOG_NIVEIS[options.nivel] ? options.nivel : 'info';
        var fase = options.fase !== undefined && options.fase !== null ? String(options.fase) :
            (state && state.fase ? String(state.fase) : 'nenhuma');
        var evento = {
            id: ++logSequencia,
            at: new Date().toISOString(),
            tipo: tipo,
            nivel: nivel,
            fase: truncarStringLog(fase, LOG_MAX_FASE),
            mensagem: truncarStringLog(mensagem, LOG_MAX_STRING),
            contexto: Object.prototype.hasOwnProperty.call(options, 'contexto') ? normalizarContextoLog(options.contexto) : null
        };

        if (state) {
            if (!Array.isArray(state.logs)) state.logs = [];
            state.logs.push(evento);
            if (state.logs.length > LOG_MAX_EVENTOS) state.logs.splice(0, state.logs.length - LOG_MAX_EVENTOS);
        }
        try {
            if (typeof console !== 'undefined' && console && typeof console.log === 'function') {
                console.log('[TecFabrica] ' + formatarEventoLog(evento));
            }
        } catch (e) { /* logging não pode interromper a coleta */ }
        try {
            if (typeof UI !== 'undefined' && UI && typeof UI.appendLog === 'function') UI.appendLog(evento);
        } catch (e) { /* hook visual é opcional */ }
        if (options.persist !== false) agendarPersistenciaLog();
        return evento;
    }

    if (typeof window !== 'undefined') {
        window.__TecFabricaLog = {
            log: log,
            normalizarContextoLog: normalizarContextoLog,
            formatarEventoLog: formatarEventoLog
        };
    }
