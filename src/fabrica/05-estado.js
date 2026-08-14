    /* =====================================================================
     * ESTADO PERSISTENTE (retomável em qualquer fase)
     * =================================================================== */
    var cicloExecucaoId = 0;
    var LIMITE_RESOLUCOES_DIARIAS = 1200;

    function chaveDiaLocal(agora) {
        var data = agora instanceof Date ? agora : new Date(agora || Date.now());
        return data.getFullYear() + '-' + String(data.getMonth() + 1).padStart(2, '0') + '-' + String(data.getDate()).padStart(2, '0');
    }

    function normalizarControleResolucoesDiarias(valor, agora) {
        if (!valor || typeof valor !== 'object') return valor;
        var hoje = chaveDiaLocal(agora);
        var controle = valor.controleResolucoesDiarias;
        if (!controle || typeof controle !== 'object' || controle.data !== hoje || !Number.isInteger(Number(controle.total)) || Number(controle.total) < 0) {
            valor.controleResolucoesDiarias = { data: hoje, total: 0 };
            return valor;
        }
        controle.total = Math.min(Number(controle.total), LIMITE_RESOLUCOES_DIARIAS);
        return valor;
    }

    function resolucoesDiariasRestantes(valor, agora) {
        normalizarControleResolucoesDiarias(valor, agora);
        return Math.max(0, LIMITE_RESOLUCOES_DIARIAS - valor.controleResolucoesDiarias.total);
    }

    function resumoResolucoesDiarias(valor, agora) {
        normalizarControleResolucoesDiarias(valor, agora);
        var usadas = valor.controleResolucoesDiarias.total;
        return {
            data: valor.controleResolucoesDiarias.data,
            limite: LIMITE_RESOLUCOES_DIARIAS,
            usadas: usadas,
            restantes: Math.max(0, LIMITE_RESOLUCOES_DIARIAS - usadas),
            esgotado: usadas >= LIMITE_RESOLUCOES_DIARIAS
        };
    }

    function reservarResolucaoDiaria(valor, agora) {
        if (!valor || typeof valor !== 'object') return false;
        normalizarControleResolucoesDiarias(valor, agora);
        if (valor.controleResolucoesDiarias.total >= LIMITE_RESOLUCOES_DIARIAS) return false;
        valor.controleResolucoesDiarias.total += 1;
        return true;
    }
