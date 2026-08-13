    /* =====================================================================
     * TIMERS À PROVA DE ABA EM SEGUNDO PLANO
     * =================================================================== */
    // Scheduler compartilhado e reutilizável — substitui a criação de um
    // Worker+Blob por chamada (que vazava blob URLs e threads a cada sleep
    // e poll) por UM único Worker e UM único Blob atendendo a todas as
    // tarefas do script:
    //   * sleep e poll CONCORRENTES, registrados por id;
    //   * cancelamento por id (Scheduler.cancelar) e timeout por deadline;
    //   * cleanup: Scheduler.limpar() derruba tarefas e encerra o worker;
    //   * a blob URL é revogada (revokeObjectURL) logo após a construção;
    //   * fallback automático para setTimeout/setInterval quando
    //     Worker/Blob/URL não existirem ou falharem (CSP, ambientes
    //     restritos, navegadores antigos) — e o mesmo fallback assume as
    //     tarefas pendentes caso o worker morra em pleno voo.
    // API pública preservada (consumida por esperar()/pausaAleatoria() e
    // por toda a engine): workerSleep(ms) → Promise e workerTick(intervalo,
    // condicao, timeout, callback). Compatível com Chrome/Edge/Tampermonkey.
    var Scheduler = (function () {
        // Programa que roda DENTRO do worker: recebe {id, tipo, ms} e
        // devolve postMessage(id) quando o tempo de cada tarefa chega;
        // 'cancel' limpa o intervalo correspondente no próprio worker.
        var WORKER_CODE =
            'var ivs = {};' +
            'onmessage = function (e) {' +
            '  var m = e.data;' +
            '  if (m.tipo === "cancel") {' +
            '    if (ivs[m.id]) { clearInterval(ivs[m.id]); delete ivs[m.id]; }' +
            '    return;' +
            '  }' +
            '  if (m.tipo === "once") { setTimeout(function () { postMessage(m.id); }, m.ms); return; }' +
            '  ivs[m.id] = setInterval(function () { postMessage(m.id); }, m.ms);' +
            '};';

        var worker = null; // null = ainda não tentou; false = indisponível; Worker = ativo
        var tarefas = {};  // id -> {tipo, fim, intervalo, condicao, callback, resolve, timer}
        var proximoId = 1;

        function tentarCriarWorker() {
            if (typeof Worker !== 'function' || typeof Blob !== 'function' ||
                typeof URL === 'undefined' || !URL.createObjectURL || !URL.revokeObjectURL) {
                worker = false;
                return;
            }
            var url = null;
            try {
                var blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
                url = URL.createObjectURL(blob);
                var w = new Worker(url);
                // A URL só é necessária na construção: revoga já, sem vazar.
                URL.revokeObjectURL(url);
                w.onmessage = function (e) { entregar(e.data); };
                w.onerror = function () {
                    // Worker morreu com tarefas pendentes: repassa tudo ao
                    // fallback com o tempo restante (nada fica pendurado).
                    if (worker) { try { worker.terminate(); } catch (err) {} }
                    worker = false;
                    Object.keys(tarefas).forEach(function (id) { repassarAoFallback(id); });
                };
                worker = w;
            } catch (err) {
                if (url) { try { URL.revokeObjectURL(url); } catch (e2) {} }
                worker = false;
            }
        }

        function registrar(tarefa) {
            var id = proximoId++;
            tarefas[id] = tarefa;
            return id;
        }

        // Remove a tarefa e derruba o timer de fallback dela (se houver).
        function remover(id) {
            var t = tarefas[id];
            if (!t) return null;
            delete tarefas[id];
            if (t.timer !== undefined) {
                if (t.tipo === 'once') clearTimeout(t.timer);
                else clearInterval(t.timer);
            }
            return t;
        }

        function cancelarNoWorker(id) {
            if (worker) {
                try { worker.postMessage({ id: id, tipo: 'cancel' }); } catch (err) {}
            }
        }

        function cancelar(id) {
            if (remover(id)) cancelarNoWorker(id);
        }

        // Ponto único de entrega: mensagem do worker ou tick do fallback.
        function entregar(id) {
            var t = tarefas[id];
            if (!t) return; // já cancelada: ignora a mensagem órfã
            if (t.tipo === 'once') {
                delete tarefas[id];
                if (t.timer !== undefined) clearTimeout(t.timer);
                t.resolve();
                return;
            }
            // poll: termina quando a condição satisfaz ou o deadline estoura;
            // senão segue aguardando (o intervalo continua vivo).
            if (t.condicao()) {
                delete tarefas[id];
                if (t.timer !== undefined) clearInterval(t.timer);
                cancelarNoWorker(id);
                t.callback(true);
                return;
            }
            if (Date.now() > t.fim) {
                delete tarefas[id];
                if (t.timer !== undefined) clearInterval(t.timer);
                cancelarNoWorker(id);
                t.callback(false);
                return;
            }
        }

        // Reagenda a tarefa com setTimeout/setInterval (fallback ou
        // recuperação após a morte do worker), com o tempo restante.
        function repassarAoFallback(id) {
            var t = tarefas[id];
            if (!t) return;
            if (t.tipo === 'once') {
                var restante = Math.max(0, t.fim - Date.now());
                t.timer = setTimeout(function () { entregar(id); }, restante);
            } else {
                t.timer = setInterval(function () { entregar(id); }, t.intervalo);
                entregar(id); // checa a condição já de cara, como o fallback original
            }
        }

        function limpar() {
            Object.keys(tarefas).forEach(function (id) { cancelar(id); });
            if (worker) { try { worker.terminate(); } catch (err) {} }
            worker = null; // permite recriar na próxima chamada
        }

        function sleep(ms) {
            return new Promise(function (resolve) {
                if (worker === null) tentarCriarWorker();
                var id = registrar({ tipo: 'once', fim: Date.now() + ms, resolve: resolve });
                if (worker) {
                    try { worker.postMessage({ id: id, tipo: 'once', ms: ms }); return; }
                    catch (err) { repassarAoFallback(id); return; }
                }
                repassarAoFallback(id);
            });
        }

        function poll(intervalo, condicao, timeout, callback) {
            if (worker === null) tentarCriarWorker();
            var id = registrar({
                tipo: 'poll',
                fim: Date.now() + timeout,
                intervalo: intervalo,
                condicao: condicao,
                callback: callback
            });
            if (worker) {
                try { worker.postMessage({ id: id, tipo: 'poll', ms: intervalo }); return id; }
                catch (err) { repassarAoFallback(id); return id; }
            }
            repassarAoFallback(id);
            return id;
        }

        return {
            sleep: sleep,     // → Promise (contrato inalterado)
            poll: poll,       // → id da tarefa (permite Scheduler.cancelar)
            cancelar: cancelar,
            limpar: limpar
        };
    })();

    // API pública — assinaturas idênticas às originais, consumidas por
    // esperar()/pausaAleatoria() (DOM HELPERS) e por toda a engine.
    function workerSleep(ms) {
        return Scheduler.sleep(ms);
    }

    function workerTick(intervalo, condicao, timeout, callback) {
        Scheduler.poll(intervalo, condicao, timeout, callback);
    }

