// ==UserScript==
// @name         Tec Concursos — Fábrica de Cadernos
// @namespace    tec-fabrica-cadernos
// @version      2.0.0
// @description  Cria cadernos em lote a partir de um plano de matérias (com bancas e anos), coleta cada questão com o gabarito oficial e exporta HTML interativo + Excel completos.
// @author       voce
// @match        https://www.tecconcursos.com.br/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* =========================================================================
 * TEC CONCURSOS — FÁBRICA DE CADERNOS
 * -------------------------------------------------------------------------
 * Mecanismos validados ao vivo (12/08/2026):
 *  - Filtros: abas .menu-alternador-opcao; busca "Pesquisar por nome";
 *    itens .arvore-item (.arvore-item-conteudo é o alvo do clique);
 *    atalhos [role=button].link-atalho ("Remover anuladas"/"Remover desatualizadas");
 *    contador .gerador-filtrador strong.ng-binding.
 *  - Criação: #nomeCadernoId (ng-model sincroniza no blur), #pastaCadernosId,
 *    botão "Gerar Caderno" (vm.gerarCaderno()).
 *  - Coleta: article.questao-enunciado → .questao-enunciado-texto (HTML),
 *    ul.questao-enunciado-alternativas > label.questao-enunciado-alternativa
 *    (.questao-enunciado-alternativa-opcao = letra, -texto = conteúdo);
 *    navegação via $rootScope.$broadcast('abrir-questao', N);
 *    contador .questao-cabecalho-informacoes-numero ("Questão X de Y").
 *  - Gabarito: marcar alternativa (radio) → clicar "RESOLVER QUESTÃO" →
 *    ler "a correta é: X" / "Gabarito: X" em .questao-enunciado-resolucao.
 *  - Exportação: HTML interativo escuro e XLSX com imagens embutidas,
 *    réplica fiel dos templates do projeto "Tecconcursos" do usuário.
 * ========================================================================= */
(function () {
    'use strict';

    // Versão do script — espelha @version no cabeçalho do userscript; logada
    // no Console na inicialização para conferir a cópia em execução.
    var SCRIPT_VERSION = '2.0.0';

    /* =====================================================================
     * CONFIG
     * =================================================================== */
    var CONFIG = {
        storageKey: 'tec_fabrica_estado_v1',
        delayMin: 3500,
        delayMax: 6500,
        pollInterval: 400,
        loadTimeout: 20000,
        filtroTimeout: 15000,
        batchSize: 20,
        coletarAposCriar: true,
        autoContinuarLote: false,
        banks: ['FCC', 'Fundatec', 'Vunesp', 'Cesgranrio', 'FGV', 'Legalle', 'Fundação La Salle', 'Instituto AOCP', 'Objetiva',
            'CEBRASPE', 'IBFC', 'Instituto Consulplan', 'QUADRIX', 'IDECAN', 'FEPESE', 'FAURGS'],
        years: [2023, 2020, 2022, 2018, 2025, 2021, 2017, 2024, 2019, 2026, 2016],
        removeCancelled: true,
        removeOutdated: true,
        usarCliqueGabarito: true,
        impressaoLimiteDia: 1000,
        usarImpressao: true
    };

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

    function log(msg) {
        console.log('[TecFabrica] ' + msg);
        if (UI && typeof UI.appendLog === 'function') UI.appendLog(msg);
    }

    /* =====================================================================
     * PLANO (aceita o JSON do usuário e o formato Markdown consolidado)
     * =================================================================== */
    function parsePlanoJson(valor) {
        var texto = String(valor == null ? '' : valor);
        texto = texto.replace(/^\ufeff/, '').trim();
        var iniCerca = texto.indexOf('```');
        var fimCerca = texto.lastIndexOf('```');
        if (iniCerca !== -1 && fimCerca > iniCerca + 2) {
            texto = texto.slice(iniCerca + 3, fimCerca);
            texto = texto.replace(/^\s*json\b\s*/i, '');
        }
        texto = texto.replace(/^\s*json\s*[:=]\s*/i, '');
        var inicio = -1;
        var aberto = '';
        var fechado = '';
        for (var i = 0; i < texto.length; i += 1) {
            var ch = texto.charAt(i);
            if (ch === '{' || ch === '[') {
                inicio = i;
                aberto = ch;
                fechado = (ch === '{') ? '}' : ']';
                break;
            }
        }
        if (inicio === -1) {
            throw new Error('O plano deve ser um JSON. Cole o conteúdo do arquivo mapeamento_de_materias.json.');
        }
        texto = texto.slice(inicio);
        var profundidade = 0;
        var emString = false;
        var escapado = false;
        var fimJson = -1;
        for (var j = 0; j < texto.length; j += 1) {
            var c = texto.charAt(j);
            if (emString) {
                if (escapado) escapado = false;
                else if (c === '\\') escapado = true;
                else if (c === '"') emString = false;
                continue;
            }
            if (c === '"') { emString = true; continue; }
            if (c === aberto) profundidade += 1;
            else if (c === fechado) {
                profundidade -= 1;
                if (profundidade === 0) { fimJson = j + 1; break; }
            }
        }
        if (fimJson === -1) {
            throw new Error('JSON incompleto: não foi encontrado o fechamento "' + fechado + '" correspondente ao início do plano.');
        }
        texto = texto.slice(0, fimJson);
        // Remove vírgulas sobrando imediatamente antes de } ou ] (regex segura).
        texto = texto.replace(/,(\s*[}\]])/g, '$1');
        try {
            return JSON.parse(texto);
        } catch (e) {
            var pos = (typeof e.position === 'number' && e.position >= 0) ? e.position : -1;
            var linha = 1;
            var coluna = 1;
            if (pos === -1) {
                var mPos = /line\s+(\d+)\s+column\s+(\d+)/i.exec(e && e.message ? e.message : '');
                if (mPos) {
                    linha = parseInt(mPos[1], 10);
                    coluna = parseInt(mPos[2], 10);
                }
            } else {
                for (var k = 0; k < pos && k < texto.length; k += 1) {
                    if (texto.charAt(k) === '\n') { linha += 1; coluna = 1; }
                    else { coluna += 1; }
                }
            }
            var trecho = '';
            var de = Math.max(0, pos - 40);
            var ate = Math.min(texto.length, pos + 40);
            trecho = texto.slice(de, ate).replace(/\s+/g, ' ').trim();
            var msg = 'JSON inválido na linha ' + linha + ', coluna ' + coluna + '.';
            if (trecho) { msg += ' Trecho próximo ao erro: "' + trecho + '".'; }
            msg += ' Não é possível reparar o JSON automaticamente: se faltou uma vírgula, adicione-a antes da propriedade indicada.';
            throw new Error(msg);
        }
    }

    /* Localiza a raiz real do plano dentro de wrappers comuns do usuário:
     * { json: ... }, { data: ... }, { resultado: ... }, { plano: ... },
     * { mapeamento: ... } (podendo estar aninhados) ou um array com um único
     * elemento contendo a raiz. */
    function localizarRaizPlano(dados) {
        var CHAVES_WRAPPER = ['json', 'data', 'resultado', 'plano', 'mapeamento'];
        // Só desembrulha um array de um elemento quando o elemento tem cara de
        // raiz do plano (não quando é uma matéria avulsa numa lista direta).
        function pareceRaizOuWrapper(v) {
            if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
            if (v.categorias !== undefined || Array.isArray(v.materias) || Array.isArray(v.matters)) return true;
            for (var w = 0; w < CHAVES_WRAPPER.length; w += 1) {
                if (v[CHAVES_WRAPPER[w]] !== undefined && v[CHAVES_WRAPPER[w]] !== null) return true;
            }
            return false;
        }
        if (Array.isArray(dados) && dados.length === 1 && pareceRaizOuWrapper(dados[0])) dados = dados[0];
        var nivel = 0;
        while (dados && typeof dados === 'object' && !Array.isArray(dados) && nivel < 3) {
            if (dados.categorias !== undefined || Array.isArray(dados.materias) || Array.isArray(dados.matters)) return dados;
            var interno = null;
            for (var i = 0; i < CHAVES_WRAPPER.length; i += 1) {
                var v = dados[CHAVES_WRAPPER[i]];
                if (v !== null && typeof v === 'object') { interno = v; break; }
            }
            if (interno === null) return dados;
            if (Array.isArray(interno) && interno.length === 1 && pareceRaizOuWrapper(interno[0])) interno = interno[0];
            dados = interno;
            nivel += 1;
        }
        return dados;
    }

    function normalizarPlano(valor) {
        var plano = { name: 'Plano TecConcursos', banks: CONFIG.banks.slice(), years: CONFIG.years.slice(), removeCancelled: true, removeOutdated: true, matters: [] };
        if (!valor) {
            throw new Error('Nenhum plano informado: cole o JSON do plano (ex.: conteúdo do mapeamento_de_materias.json) no campo da aba Plano antes de clicar em "Carregar plano".');
        }
        var dados = localizarRaizPlano(parsePlanoJson(valor));
        // Chaves aceitas para a lista de assuntos de uma matéria — usadas tanto
        // na adição de matérias quanto na detecção de matéria avulsa colada
        // sozinha (sem o raiz total_materias_unicas/categorias).
        var CHAVES_SUBS = ['materias_tecconcursos', 'materiasTecconcursos', 'subjects', 'materias'];
        // Evita duplicatas apenas quando título + grupo + assuntos são idênticos;
        // categorias diferentes (grupos distintos) nunca são colapsadas.
        var vistos = {};

        function chaveUnica(mtr) {
            var ids = mtr.subjectIds.slice().sort().join('|');
            var caminhos = mtr.subjectPaths.slice().sort().join('|');
            return (mtr.title + '\u0001' + mtr.group + '\u0001' + caminhos).toLocaleLowerCase('pt-BR') + '\u0002' + ids;
        }

        // Matéria pode usar titulo/title; assuntos em materias_tecconcursos,
        // materiasTecconcursos, subjects ou materias; cada assunto com
        // codigo/code/id e materia/path/nome/name. Só adiciona matéria com
        // título não vazio e ao menos um assunto com código ou caminho.
        function adicionarMateria(m, grupo) {
            if (!m || typeof m !== 'object') return;
            var titulo = clean(m.titulo);
            if (!titulo) titulo = clean(m.title);
            if (!titulo) return;
            var subsRaw = null;
            for (var i = 0; i < CHAVES_SUBS.length && subsRaw === null; i += 1) {
                if (Array.isArray(m[CHAVES_SUBS[i]])) subsRaw = m[CHAVES_SUBS[i]];
            }
            var subs = [];
            if (Array.isArray(subsRaw)) {
                subsRaw.forEach(function (s) {
                    if (!s || typeof s !== 'object') return;
                    var codigo = s.codigo !== undefined ? s.codigo : (s.code !== undefined ? s.code : s.id);
                    var caminho = s.materia !== undefined ? s.materia : (s.path !== undefined ? s.path : (s.nome !== undefined ? s.nome : s.name));
                    var temCodigo = codigo !== undefined && codigo !== null && String(codigo).trim() !== '';
                    var temCaminho = clean(caminho) !== '';
                    if (temCodigo || temCaminho) {
                        subs.push({ codigo: temCodigo ? String(codigo) : '', materia: clean(caminho) });
                    }
                });
            }
            if (!subs.length) return;
            var grupoLimpo = clean(grupo) || 'Plano';
            var mtr = {
                code: 'MAT-' + String(plano.matters.length + 1).padStart(3, '0'),
                title: titulo,
                group: grupoLimpo,
                subjectIds: subs.map(function (s) { return s.codigo; }),
                subjectPaths: subs.map(function (s) { return s.materia; })
            };
            var chave = chaveUnica(mtr);
            if (vistos[chave]) return;
            vistos[chave] = true;
            plano.matters.push(mtr);
        }

        // Matéria avulsa colada sozinha: objeto com título (titulo/title) e uma
        // lista de assuntos — suporta colar só o objeto de uma matéria, sem o
        // raiz total_materias_unicas/categorias do arquivo completo.
        function pareceMateriaUnica(obj) {
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
            if (clean(obj.titulo) === '' && clean(obj.title) === '') return false;
            for (var s = 0; s < CHAVES_SUBS.length; s += 1) {
                if (Array.isArray(obj[CHAVES_SUBS[s]])) return true;
            }
            return false;
        }

        // Extrai a lista de matérias de uma categoria: array direto,
        // { materias: [...] }, { itens: [...] } ou lista aninhada um nível,
        // ex.: { materias: { itens: [...] } }.
        function listaDeMaterias(cat) {
            if (Array.isArray(cat)) return cat;
            if (!cat || typeof cat !== 'object') return [];
            var alvo = cat;
            if (cat.materias !== undefined) alvo = cat.materias;
            else if (cat.itens !== undefined) alvo = cat.itens;
            if (Array.isArray(alvo)) return alvo;
            if (alvo && typeof alvo === 'object') {
                if (Array.isArray(alvo.itens)) return alvo.itens;
                if (Array.isArray(alvo.materias)) return alvo.materias;
                var chaves = Object.keys(alvo).filter(function (k) { return Array.isArray(alvo[k]); });
                if (chaves.length) return alvo[chaves[0]];
            }
            return [];
        }

        // Formato categorizado: { categorias: { "Nome": { quantidade, materias: [...] } } }
        function adicionarMateriasCategorizadas(categorias) {
            var entradas = [];
            if (Array.isArray(categorias)) {
                categorias.forEach(function (c, i) {
                    var nome = c && (c.nome !== undefined ? c.nome : c.categoria);
                    entradas.push({ nome: nome !== undefined && nome !== null ? String(nome) : ('Categoria ' + (i + 1)), cat: c });
                });
            } else {
                Object.keys(categorias).forEach(function (k) { entradas.push({ nome: k, cat: categorias[k] }); });
            }
            entradas.forEach(function (e) {
                listaDeMaterias(e.cat).forEach(function (m) { adicionarMateria(m, e.nome); });
            });
        }

        var temCategorias = dados && typeof dados === 'object' && !Array.isArray(dados) &&
            dados.categorias !== undefined && dados.categorias !== null && typeof dados.categorias === 'object';
        if (temCategorias) adicionarMateriasCategorizadas(dados.categorias);
        if (!plano.matters.length) {
            if (Array.isArray(dados.materias)) {
                // Formato simples do usuário: { materias: [{titulo, materias_tecconcursos:[{codigo, materia}]}] }
                dados.materias.forEach(function (m) { adicionarMateria(m, 'Plano'); });
            } else if (Array.isArray(dados.matters)) {
                // Formato do projeto: { matters: [{code, title, group, subjectIds, subjectPaths}] }
                plano.name = clean(dados.name) || plano.name;
                if (Array.isArray(dados.banks)) plano.banks = dados.banks.map(clean).filter(Boolean);
                if (Array.isArray(dados.years)) plano.years = dados.years.map(Number).filter(function (y) { return y >= 1900 && y <= 2100; });
                plano.removeCancelled = dados.removeCancelled !== false;
                plano.removeOutdated = dados.removeOutdated !== false;
                plano.matters = dados.matters.map(function (m) {
                    return {
                        code: clean(m.code || 'MAT-000'),
                        title: clean(m.title),
                        group: clean(m.group) || 'Sem grupo',
                        subjectIds: (m.subjectIds || []).map(String),
                        subjectPaths: (m.subjectPaths || []).map(clean)
                    };
                }).filter(function (m) { return m.title; });
            } else if (pareceMateriaUnica(dados)) {
                // Matéria avulsa colada diretamente (ex.: só o objeto de uma
                // matéria, sem o raiz total_materias_unicas/categorias): aceita
                // como uma única matéria do plano.
                adicionarMateria(dados, 'Plano');
            } else if (Array.isArray(dados)) {
                // Raiz é uma lista direta de matérias (ex.: wrapper com array).
                dados.forEach(function (m) { adicionarMateria(m, 'Plano'); });
            }
        }
        if (!plano.matters.length) {
            var chavesDetectadas = dados && typeof dados === 'object' && !Array.isArray(dados) ? Object.keys(dados) : [];
            // Raiz com cara de matéria avulsa (título + chave de assuntos), mas
            // sem nenhum assunto utilizável — ou a lista veio num formato não
            // suportado, ou foi colado só o objeto de uma matéria/categoria.
            var pareceMateriaAvulsa = dados && typeof dados === 'object' && !Array.isArray(dados) &&
                (clean(dados.titulo) !== '' || clean(dados.title) !== '') &&
                CHAVES_SUBS.some(function (k) { return dados[k] !== undefined; });
            if (pareceMateriaAvulsa) {
                // Diagnóstico de parser: lembra que colar só uma matéria não
                // carrega o plano completo (a mensagem cai direto na UI).
                var avisoUmaMateria = 'Foi colada apenas uma matéria; para carregar todas, cole o arquivo desde total_materias_unicas até o último }.';
                log(avisoUmaMateria);
                throw new Error('A matéria colada não possui nenhum assunto válido: cada assunto precisa de um código (codigo/code/id) ou caminho (materia/path/nome/name). ' +
                    avisoUmaMateria + ' Chaves detectadas no JSON: ' +
                    (chavesDetectadas.length ? chavesDetectadas.join(', ') : '(objeto vazio ou array)') + '.');
            }
            throw new Error('O plano não contém matérias. Chaves detectadas no JSON: ' +
                (chavesDetectadas.length ? chavesDetectadas.join(', ') : '(objeto vazio ou array)') +
                '. Formatos aceitos: { categorias: { "Nome": { materias: [...] } } } (categoria também pode ser array direto ou { itens: [...] }), ' +
                '{ materias: [...] }, { matters: [...] } ou um wrapper json/data/resultado/plano/mapeamento contendo um desses. ' +
                'Cada matéria precisa de título e ao menos um assunto com código ou caminho.');
        }
        return plano;
    }

    function ultimoSegmento(caminho) {
        var partes = clean(caminho).split('>').map(clean).filter(Boolean);
        return partes.length ? partes[partes.length - 1] : '';
    }

    /* =====================================================================
     * ESTADO PERSISTENTE (retomável em qualquer fase)
     * =================================================================== */
    /* =====================================================================
     * PERSISTÊNCIA INDEXEDDB V2
     * ---------------------------------------------------------------------
     * O cache agregado continua sendo a fonte de compatibilidade em memória;
     * o banco guarda metadados, cadernos e questões separadamente.
     * =================================================================== */
    var RE_DATA_IMAGE_B64 = /data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9=.-]+)*;base64,[A-Za-z0-9+/=\s]+/gi;
    var IDB_DB = 'tec_fabrica_db';
    var IDB_VERSION = 2;
    var IDB_LEGACY_STORE = 'estado';
    var IDB_META_STORE = 'meta';
    var IDB_CADERNOS_STORE = 'cadernos';
    var IDB_QUESTOES_STORE = 'questoes';
    var IDB_STATE_KEY = 'state';
    var idbPromise = null;
    var saveTimer = null;
    var saveQueued = false;
    var saveRunning = false;
    var saveCritical = false;
    var saveRevision = 0;
    var SAVE_DEBOUNCE_MS = 5000;
    var migrationFailed = false;
    var cadernosPorId = new Map();
    var questoesPorId = new Map();
    var questaoIdsPorCaderno = new Map();

    function criarDebounce(fn) {
        var timer = null;
        var pendente = false;
        return {
            agendar: function (delay) {
                pendente = true;
                if (timer) clearTimeout(timer);
                timer = setTimeout(function () {
                    timer = null;
                    if (!pendente) return;
                    pendente = false;
                    fn();
                }, delay);
            },
            cancelar: function () { if (timer) clearTimeout(timer); timer = null; pendente = false; },
            pendente: function () { return pendente; }
        };
    }

    function sanitizarParaPersistencia(valor) {
        if (typeof valor === 'string') return valor.replace(RE_DATA_IMAGE_B64, '');
        if (valor === null || typeof valor !== 'object') return valor;
        if (Array.isArray(valor)) return valor.map(sanitizarParaPersistencia);
        var out = {};
        Object.keys(valor).forEach(function (k) { out[k] = sanitizarParaPersistencia(valor[k]); });
        return out;
    }

    function resetarIndices() {
        cadernosPorId.clear();
        questoesPorId.clear();
        questaoIdsPorCaderno.clear();
    }

    function indexarEstado(valor) {
        resetarIndices();
        var biblioteca = valor && valor.biblioteca || {};
        Object.keys(biblioteca).forEach(function (id) {
            var caderno = biblioteca[id];
            if (!caderno || !caderno.id) return;
            cadernosPorId.set(String(caderno.id), caderno);
            var ids = new Set();
            (caderno.questoes || []).forEach(function (questao) {
                if (!questao || !questao.id) return;
                var qid = String(questao.id);
                questoesPorId.set(qid, questao);
                ids.add(qid);
            });
            questaoIdsPorCaderno.set(String(caderno.id), ids);
        });
    }

    function estadoVazio() {
        return {
            plano: null, config: null, status: 'parado', fase: 'nenhuma', modo: 'lote',
            planIndex: 0, loteInicio: 0, loteFim: 0, cadernoAtual: null,
            biblioteca: {}, impressao: { data: '', usadas: 0 }, impressaoParte: null,
            mensagem: '', erro: null, retomada: false, atualizadoEm: null
        };
    }

    var estado = estadoVazio();

    function validarEstado(valor) {
        return !!(valor && typeof valor === 'object' && valor.biblioteca &&
            typeof valor.biblioteca === 'object' && !Array.isArray(valor.biblioteca));
    }

    function validarMetaV2(meta) {
        return !!(meta && meta.key === IDB_STATE_KEY && meta.schema === 2 &&
            typeof meta === 'object');
    }

    function reconstruirEstadoV2(meta, cadernos, questoes) {
        if (!validarMetaV2(meta)) return null;
        var agregado = {};
        Object.keys(meta).forEach(function (key) {
            if (key !== 'key' && key !== 'schema') agregado[key] = meta[key];
        });
        agregado.biblioteca = {};
        (cadernos || []).forEach(function (caderno) {
            if (!caderno || !caderno.id) return;
            agregado.biblioteca[caderno.id] = caderno;
            agregado.biblioteca[caderno.id].questoes = [];
        });
        (questoes || []).forEach(function (questao) {
            var caderno = agregado.biblioteca[questao && questao.cadernoId];
            if (caderno && questao.id) caderno.questoes.push(questao);
        });
        return validarEstado(agregado) ? agregado : null;
    }

    function parseLegadoV1(json) {
        var legado;
        try { legado = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
        return validarEstado(legado) ? legado : null;
    }

    function abrirIdb() {
        if (idbPromise) return idbPromise;
        idbPromise = new Promise(function (resolve, reject) {
            if (!window.indexedDB) { reject(new Error('indexedDB indisponível')); return; }
            var req;
            try { req = window.indexedDB.open(IDB_DB, IDB_VERSION); } catch (e) { reject(e); return; }
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(IDB_META_STORE)) db.createObjectStore(IDB_META_STORE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(IDB_CADERNOS_STORE)) db.createObjectStore(IDB_CADERNOS_STORE, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(IDB_QUESTOES_STORE)) {
                    var qs = db.createObjectStore(IDB_QUESTOES_STORE, { keyPath: 'id' });
                    qs.createIndex('cadernoId', 'cadernoId', { unique: false });
                    qs.createIndex('id', 'id', { unique: true });
                    qs.createIndex('posicao', ['cadernoId', 'number'], { unique: false });
                }
                var cs = req.transaction.objectStore(IDB_CADERNOS_STORE);
                if (!cs.indexNames.contains('id')) cs.createIndex('id', 'id', { unique: true });
            };
            req.onsuccess = function () {
                var db = req.result;
                db.onversionchange = function () { db.close(); idbPromise = null; };
                resolve(db);
            };
            req.onerror = function () { reject(req.error || new Error('falha ao abrir IndexedDB')); };
        }).catch(function (e) { idbPromise = null; throw e; });
        return idbPromise;
    }

    function idbTransacao(stores, mode, fn) {
        return abrirIdb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx;
                try {
                    tx = db.transaction(stores, mode);
                    fn(tx);
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { reject(tx.error || new Error('transação IndexedDB falhou')); };
                    tx.onabort = function () { reject(tx.error || new Error('transação IndexedDB abortada')); };
                } catch (e) { reject(e); }
            });
        });
    }

    function estadoBaseParaMeta(valor) {
        var meta = {};
        Object.keys(valor || {}).forEach(function (key) { if (key !== 'biblioteca') meta[key] = valor[key]; });
        meta.key = IDB_STATE_KEY;
        meta.schema = 2;
        meta.atualizadoEm = new Date().toISOString();
        return sanitizarParaPersistencia(meta);
    }

    function registrosNormalizados(valor) {
        var cadernos = [], questoes = [];
        Object.keys(valor.biblioteca || {}).forEach(function (key) {
            var original = valor.biblioteca[key];
            if (!original || !original.id) return;
            var caderno = sanitizarParaPersistencia(original);
            var lista = caderno.questoes || [];
            delete caderno.questoes;
            cadernos.push(caderno);
            lista.forEach(function (questao, index) {
                if (!questao || !questao.id) return;
                var q = sanitizarParaPersistencia(questao);
                q.cadernoId = String(caderno.id);
                if (q.number === undefined) q.number = index + 1;
                questoes.push(q);
            });
        });
        return { cadernos: cadernos, questoes: questoes };
    }

    function salvarSnapshot(json) {
        var valor = typeof json === 'string' ? JSON.parse(json) : json;
        if (!validarEstado(valor)) return Promise.reject(new Error('estado inválido para persistência'));
        var normal = registrosNormalizados(valor);
        return idbTransacao([IDB_META_STORE, IDB_CADERNOS_STORE, IDB_QUESTOES_STORE], 'readwrite', function (tx) {
            var meta = tx.objectStore(IDB_META_STORE);
            var cs = tx.objectStore(IDB_CADERNOS_STORE);
            var qs = tx.objectStore(IDB_QUESTOES_STORE);
            meta.put(estadoBaseParaMeta(valor));
            // Reconciliação dentro da mesma transação: registros atuais são
            // upsertados e somente IDs que desapareceram são removidos.
            var novosCadernos = new Map();
            var novasQuestoes = new Map();
            normal.cadernos.forEach(function (c) { novosCadernos.set(String(c.id), c); cs.put(c); });
            normal.questoes.forEach(function (q) { novasQuestoes.set(String(q.id), q); qs.put(q); });
            cs.getAll().onsuccess = function (event) {
                (event.target.result || []).forEach(function (old) {
                    if (!novosCadernos.has(String(old.id))) cs.delete(old.id);
                });
            };
            qs.getAll().onsuccess = function (event) {
                (event.target.result || []).forEach(function (old) {
                    if (!novasQuestoes.has(String(old.id))) qs.delete(old.id);
                });
            };
        });
    }

    function carregarV2() {
        return abrirIdb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction([IDB_META_STORE, IDB_CADERNOS_STORE, IDB_QUESTOES_STORE], 'readonly');
                var result = { meta: null, cadernos: [], questoes: [] };
                tx.objectStore(IDB_META_STORE).get(IDB_STATE_KEY).onsuccess = function (e) { result.meta = e.target.result; };
                tx.objectStore(IDB_CADERNOS_STORE).getAll().onsuccess = function (e) { result.cadernos = e.target.result || []; };
                tx.objectStore(IDB_QUESTOES_STORE).getAll().onsuccess = function (e) { result.questoes = e.target.result || []; };
                tx.oncomplete = function () { resolve(reconstruirEstadoV2(result.meta, result.cadernos, result.questoes)); };
                tx.onerror = function () { reject(tx.error || new Error('falha ao ler v2')); };
                tx.onabort = function () { reject(tx.error || new Error('leitura v2 abortada')); };
            });
        });
    }

    function migrarV1() {
        return abrirIdb().then(function (db) {
            if (!db.objectStoreNames.contains(IDB_LEGACY_STORE)) return null;
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(IDB_LEGACY_STORE, 'readonly');
                var req = tx.objectStore(IDB_LEGACY_STORE).get(CONFIG.storageKey);
                req.onsuccess = function () {
                    var rec = req.result;
                    if (!rec || !rec.json) { resolve(null); return; }
                    var legado;
                    legado = parseLegadoV1(rec.json);
                    if (!legado) {
                        migrationFailed = true;
                        console.warn('[TecFabrica] legado v1 inválido; preservado.');
                        resolve({ failed: true, reason: 'legado v1 inválido' }); return;
                    }
                    salvarSnapshot(legado).then(function () {
                        return idbTransacao([IDB_META_STORE, IDB_LEGACY_STORE], 'readwrite', function (t) {
                            t.objectStore(IDB_META_STORE).put({ key: 'legacy-v1-archive', schema: 2, archivedAt: Date.now(), json: rec.json });
                            t.objectStore(IDB_LEGACY_STORE).delete(CONFIG.storageKey);
                        });
                    }).then(function () { console.log('[TecFabrica] estado v1 migrado para v2.'); resolve(legado); }).catch(function (e) {
                        migrationFailed = true;
                        console.warn('[TecFabrica] migração v1 falhou; legado preservado.', e);
                        resolve({ failed: true, reason: 'falha na migração v1' });
                    });
                };
                req.onerror = function () { resolve(null); };
            });
        });
    }

    function carregarEstadoIdb() {
        return carregarV2().then(function (v2) { return v2 || migrarV1(); });
    }

    function salvarEstadoIdb(json) {
        if (!window.indexedDB) return;
        if (saveRunning) { saveQueued = true; return; }
        saveRunning = true;
        salvarSnapshot(json).catch(function (e) {
            console.warn('[TecFabrica] aviso: falha ao salvar no IndexedDB (' + (e && e.name || e) + ').');
        }).then(function () {
            saveRunning = false;
            if (saveQueued) { saveQueued = false; salvarEstadoIdb(JSON.stringify(sanitizarParaPersistencia(estado))); }
        });
    }

    function carregarEstado() {
        return carregarEstadoIdb().then(function (parsed) {
            if (parsed && parsed.failed) {
                estado = estadoVazio();
                estado.status = 'erro';
                estado.erro = parsed.reason;
                estado.mensagem = parsed.reason + '. O legado foi preservado.';
                indexarEstado(estado);
                return estado;
            }
            if (parsed && validarEstado(parsed)) {
                estado = parsed; indexarEstado(estado); log('Estado restaurado do IndexedDB v2.'); return parsed;
            }
            indexarEstado(estado); return null;
        }).catch(function (e) {
            migrationFailed = true;
            estado.status = 'erro';
            estado.erro = e && e.message || String(e);
            estado.mensagem = 'Falha ao carregar o estado; dados legados foram preservados.';
            console.warn('[TecFabrica] AVISO: IndexedDB indisponível ou falhou a leitura — estado em memória preservado (' + (e && e.message || e) + ').');
            indexarEstado(estado); return estado;
        });
    }

    function salvarEstado(checkpointCritico) {
        estado.atualizadoEm = new Date().toISOString();
        indexarEstado(estado);
        saveRevision += 1;
        if (checkpointCritico === true) saveCritical = true;
        if (saveTimer) clearTimeout(saveTimer);
        var atraso = saveCritical ? 0 : SAVE_DEBOUNCE_MS;
        saveTimer = setTimeout(function () {
            saveTimer = null; saveCritical = false;
            var snapshot;
            try { snapshot = JSON.stringify(sanitizarParaPersistencia(estado)); }
            catch (e) { log('ERRO: falha ao serializar o estado (' + (e && e.name || e) + ').'); estado.status = 'pausado'; return; }
            salvarEstadoIdb(snapshot);
        }, atraso);
    }

    if (typeof window !== 'undefined') {
        window.__TecFabricaPersistence = {
            sanitizarParaPersistencia: sanitizarParaPersistencia,
            validarEstado: validarEstado,
            indexarEstado: indexarEstado,
            salvarSnapshot: salvarSnapshot,
            indices: { cadernosPorId: cadernosPorId, questoesPorId: questoesPorId, questaoIdsPorCaderno: questaoIdsPorCaderno }
            ,validarMetaV2: validarMetaV2,
            reconstruirEstadoV2: reconstruirEstadoV2,
            parseLegadoV1: parseLegadoV1
            ,criarDebounce: criarDebounce
        };
    }
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
    /* =====================================================================
     * EXTRAÇÃO DA QUESTÃO (DOM, HTML limpo + metadados)
     * =================================================================== */
    var ATRIBUTOS_PERMITIDOS = new Set(['style', 'src', 'alt', 'href', 'colspan', 'rowspan', 'width', 'height', 'align', 'valign', 'border', 'cellpadding', 'cellspacing', 'title']);

    function limparHtml(el) {
        var clone = el.cloneNode(true);
        clone.querySelectorAll('script, style, iframe, button, input, select, textarea, form, noscript, .questao-enunciado-resolucao')
            .forEach(function (n) { n.remove(); });
        clone.querySelectorAll('*').forEach(function (n) {
            Array.prototype.slice.call(n.attributes || []).forEach(function (a) {
                if (!ATRIBUTOS_PERMITIDOS.has(a.name)) n.removeAttribute(a.name);
            });
            if (n.tagName === 'IMG') {
                var src = n.getAttribute('src');
                if (src) n.setAttribute('src', new URL(src, location.href).href);
            }
            if (n.tagName === 'A') {
                var href = n.getAttribute('href');
                if (href && !/^https?:/i.test(href)) n.removeAttribute('href');
            }
        });
        return clone.innerHTML.trim();
    }

    function textoDe(el) {
        return el ? clean(el.innerText || el.textContent) : '';
    }

    function parseCabecalho(valor) {
        // "#1646838 FCC - 2024 - Técnico Judiciário (TRT 11ª)/Administrativa/Cargo" →
        // bank=FCC, year=2024, vacancy=..., organization=..., role=...
        var header = clean(valor).replace(/^#?\s*\d{4,10}\s*/, '');
        var pieces = header.split('/').map(clean).filter(Boolean);
        var first = pieces.shift() || '';
        var firstSplit = first.split(/\s+-\s+/);
        var bank = clean(firstSplit.shift());
        var vacancy = clean(firstSplit.join(' - '));
        var year = null;
        var firstYear = vacancy.match(/\b(19|20)\d{2}\b/);
        if (firstYear) {
            year = Number(firstYear[0]);
            vacancy = clean(vacancy.replace(firstYear[0], '').replace(/^\s*-\s*|\s*-\s*$/g, ''));
        }
        var last = pieces.length ? pieces[pieces.length - 1] : '';
        var lastYear = last.match(/\b(19|20)\d{2}\b/);
        if (lastYear && year == null) year = Number(lastYear[0]);
        if (lastYear) pieces[pieces.length - 1] = clean(last.replace(lastYear[0], '').replace(/^\s*-\s*|\s*-\s*$/g, ''));
        pieces = pieces.filter(Boolean);
        return {
            raw: header,
            bank: bank,
            vacancy: vacancy,
            organization: pieces.shift() || '',
            role: pieces.join(' / '),
            year: year
        };
    }

    function extrairQuestaoAtual() {
        var art = document.querySelector('article.questao-enunciado');
        if (!art) return null;

        var h1 = document.querySelector('h1');
        var idm = h1 ? h1.textContent.match(/#(\d+)/) : null;
        var pos = lerPosicao();

        var headerEl = art.querySelector('.questao-enunciado-concurso') || document.querySelector('.questao-cabecalho h1, h1');
        var meta = parseCabecalho(textoDe(headerEl));

        var materiaEl = document.querySelector('.questao-cabecalho-informacoes-materia');
        var assuntoEl = document.querySelector('.questao-cabecalho-informacoes-assunto');

        var txt = art.querySelector('.questao-enunciado-texto');
        var alternativas = Array.prototype.map.call(
            art.querySelectorAll('.questao-enunciado-alternativa'),
            function (li) {
                var letraEl = li.querySelector('.questao-enunciado-alternativa-opcao');
                var textoEl = li.querySelector('.questao-enunciado-alternativa-texto');
                var letra = letraEl ? textoDe(letraEl).replace(/[.):]\s*$/, '') : '';
                return {
                    letter: letra,
                    text: textoEl ? clean(textoEl.innerText || textoEl.textContent) : '',
                    html: textoEl ? limparHtml(textoEl) : ''
                };
            }
        ).filter(function (o) { return o.letter; });

        // URL da questão (link no h1)
        var linkQ = h1 ? h1.querySelector("a[href*='/questoes/']") : null;
        var urlQ = linkQ ? linkQ.href : (location.origin + '/questoes/' + (idm ? idm[1] : ''));

        return {
            id: idm ? idm[1] : null,
            number: pos ? pos.posicao : null,
            total: pos ? pos.total : null,
            url: urlQ,
            header: meta.raw,
            bank: meta.bank,
            year: meta.year,
            vacancy: meta.vacancy,
            organization: meta.organization,
            role: meta.role,
            subject: clean((materiaEl ? materiaEl.innerText : '').replace(/^Mat[ée]ria:\s*/i, '')),
            topic: clean((assuntoEl ? assuntoEl.innerText : '').replace(/^Assunto:\s*/i, '')),
            statement: txt ? clean(txt.innerText || txt.textContent) : '',
            statementHtml: txt ? limparHtml(txt) : '',
            options: alternativas
        };
    }

    /* =====================================================================
     * INTERCEPTAÇÃO DO GABARITO (zero requisições extras)
     * ---------------------------------------------------------------------
     * O Angular do site carrega cada questão via XHR para
     * /api/cadernos/{id}/questoes/{index} — a resposta já contém o campo
     * oficial numeroAlternativaCorreta (1=A, 2=B...). Interceptamos essa
     * resposta e guardamos o gabarito em cache. O campo "status" NÃO é
     * confiável (verificado ao vivo: status=3 ≠ gabarito real) e é ignorado.
     * =================================================================== */
    function extrairGabaritoDoPayload(q) {
        var campos = ['numeroAlternativaCorreta', 'alternativaCorreta', 'gabaritoDefinitivo', 'gabaritoPreliminar', 'gabarito'];
        for (var i = 0; i < campos.length; i += 1) {
            var v = q[campos[i]];
            if (v === null || v === undefined || v === false || v === '') continue;
            var s = String(v).trim().toUpperCase();
            if (/^[A-E]$/.test(s)) return s;
            if (/^[1-5]$/.test(s)) return String.fromCharCode(64 + Number(s));
        }
        return null;
    }

    var GabaritoInterceptor = {
        cache: {},          // por idQuestao → letra
        cachePorIndex: {},  // por "cadernoId:index" → letra
        instalado: false,
        estatisticas: { viaCache: 0, viaResolucaoVisivel: 0, viaClique: 0, semGabarito: 0 },
        instalar: function () {
            if (this.instalado) return;
            this.instalado = true;
            var interceptor = this;
            var origOpen = XMLHttpRequest.prototype.open;
            var origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (method, url) {
                this.__tecFabricaUrl = String(url || '');
                return origOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function () {
                var xhr = this;
                this.addEventListener('load', function () {
                    try {
                        var m = String(xhr.__tecFabricaUrl || '').match(/\/api\/cadernos\/(\d+)\/questoes\/(\d+)/);
                        if (m && xhr.status === 200) {
                            var data = JSON.parse(xhr.responseText);
                            var q = data && data.questao;
                            if (q && q.idQuestao != null) {
                                var letra = extrairGabaritoDoPayload(q);
                                if (letra) {
                                    interceptor.cache[String(q.idQuestao)] = letra;
                                    interceptor.cachePorIndex[m[1] + ':' + m[2]] = letra;
                                }
                            }
                        }
                    } catch (e) { /* resposta não-JSON ou irrelevante */ }
                });
                return origSend.apply(this, arguments);
            };
        },
        obterPorQuestaoId: function (id) { return this.cache[String(id)] || null; },
        obterPorIndex: function (cadernoId, index) { return this.cachePorIndex[String(cadernoId) + ':' + String(index)] || null; }
    };

    /* =====================================================================
     * GABARITO VIA RESOLUÇÃO (clique como um humano faria)
     * =================================================================== */
    function lerGabaritoDoTexto(texto) {
        // formato de erro: "a correta é: A" / "Gabarito: A"
        var g = texto.match(/a correta [ée]:\s*([A-E])/i) || texto.match(/Gabarito:\s*([A-E])/i) || texto.match(/correta [ée]:\s*([A-E])/i);
        if (g) return g[1].toUpperCase();
        // formato de acerto: "você selecionou: A, alternativa correta"
        g = texto.match(/selecionou:\s*([A-E])[.,]?\s+alternativa correta/i);
        if (g) return g[1].toUpperCase();
        return null;
    }

    function resolverParaGabarito(questao) {
        return new Promise(function (resolve) {
            var opts = questao.options;
            if (!opts.length) { GabaritoInterceptor.estatisticas.semGabarito += 1; resolve(null); return; }
            // 1. Gabarito interceptado da resposta que o site já enviou (zero requests extras)
            var doCache = GabaritoInterceptor.obterPorQuestaoId(questao.id);
            if (doCache) { GabaritoInterceptor.estatisticas.viaCache += 1; resolve(doCache); return; }
            // 2. Questão já resolvida antes: a resolução já está visível e os radios desabilitados
            var resVisivel = document.querySelector('.questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou');
            if (resVisivel) {
                var gv = lerGabaritoDoTexto(resVisivel.innerText || '');
                if (gv) { GabaritoInterceptor.estatisticas.viaResolucaoVisivel += 1; resolve(gv); return; }
            }
            // 3. Clique para resolver (fallback — opcional, desligável na Config)
            if (estado.config && estado.config.usarCliqueGabarito === false) { GabaritoInterceptor.estatisticas.semGabarito += 1; resolve(null); return; }
            var art = document.querySelector('article.questao-enunciado');
            if (!art) { resolve(null); return; }
            var labels = Array.from(art.querySelectorAll('.questao-enunciado-alternativa'));
            // marca a primeira alternativa disponível
            var campo = labels[0] ? labels[0].querySelector('input[type=radio]') : null;
            if (!campo) { resolve(null); return; }
            campo.click();
            workerSleep(600).then(function () {
                var resolver = Array.from(document.querySelectorAll('button')).find(function (b) {
                    return /RESOLVER QUEST[AÃ]O/i.test(b.innerText || '') && !b.disabled;
                });
                if (!resolver) { resolve(null); return; }
                resolver.click();
                workerTick(CONFIG.pollInterval, function () {
                    var res = document.querySelector('.questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou, .questao-enunciado-mensagem-resolucao');
                    return res && /correta|acert|errou|Gabarito/i.test(res.innerText || '');
                }, CONFIG.loadTimeout, function (ok) {
                    if (!ok) { resolve(null); return; }
                    var m = document.querySelector('.questao-enunciado-mensagem-resolucao, .questao-enunciado-resolucao-errou, .questao-enunciado-resolucao-acertou');
                    var t = m ? (m.innerText || m.textContent) : '';
                    var gab = lerGabaritoDoTexto(t);
                    if (gab) GabaritoInterceptor.estatisticas.viaClique += 1;
                    else GabaritoInterceptor.estatisticas.semGabarito += 1;
                    resolve(gab);
                });
            });
        });
    }

    /* =====================================================================
     * ENGINE — FILTROS
     * =================================================================== */
    var ALIASES_BANCA = {
        'FCC': ['FCC', 'Fundação Carlos Chagas'],
        'Fundação La Salle': ['Fundação La Salle', 'La Salle'],
        'Instituto AOCP': ['Instituto AOCP', 'AOCP'],
        'Fundatec': ['Fundatec', 'FUNDATEC'],
        'Vunesp': ['Vunesp', 'VUNESP'],
        'Cesgranrio': ['Cesgranrio', 'CESGRANRIO'],
        'FGV': ['FGV', 'Fundação Getulio Vargas'],
        'Legalle': ['Legalle', 'Legalle Concursos'],
        'Objetiva': ['Objetiva', 'OBJETIVA CONCURSOS', 'Objetiva Concursos'],
        'CEBRASPE': ['CEBRASPE', 'CEBRASPE (CESPE)', 'CESPE'],
        'IBFC': ['IBFC', 'Instituto Brasileiro de Formação e Capacitação'],
        'Instituto Consulplan': ['Instituto Consulplan', 'CONSULPLAN', 'Consulplan'],
        'QUADRIX': ['QUADRIX'],
        'IDECAN': ['IDECAN'],
        'FEPESE': ['FEPESE', 'Fundação de Estudos e Pesquisas Socioeconômicos', 'Fundação de Estudos e Pesquisas Sócio-Econômicos'],
        'FAURGS': ['FAURGS', 'Fundação de Apoio da Universidade Federal do Rio Grande do Sul']
    };

    function boxDaAba(titulo) {
        var alvo = titulo === 'Matéria e assunto' ? 'Matérias' : titulo;
        return visiveis('.gerador-buscador').find(function (b) {
            return (b.getAttribute('titulo') || '').indexOf(alvo) >= 0;
        }) || null;
    }

    async function clicarAba(titulo) {
        var tab = visiveis('.menu-alternador-opcao').find(function (n) { return mesmoTexto(n.innerText, titulo); });
        if (!tab) throw new Error('Aba de filtro "' + titulo + '" não encontrada.');
        tab.click();
        await esperar(function () { return !!boxDaAba(titulo); }, 10000, 'A aba "' + titulo + '" não abriu.');
    }

    function itemDaArvore(box, texto) {
        return visiveis('.arvore-item').find(function (n) {
            if (box && !box.contains(n)) return false;
            return mesmoTexto(n.innerText, texto) || mesmoTexto(n.getAttribute('title'), texto);
        }) || null;
    }

    function itemSelecionado(box, texto) {
        return visiveis('.arvore-item').some(function (n) {
            return box.contains(n) && n.classList.contains('arvore-item-selecionado') &&
                (mesmoTexto(n.innerText, texto) || mesmoTexto(n.getAttribute('title'), texto));
        });
    }

    async function selecionarValor(titulo, valor) {
        await clicarAba(titulo);
        var box = boxDaAba(titulo);
        if (titulo === 'Ano') {
            var anoItem = itemDaArvore(box, valor);
            if (!anoItem) throw new Error('Ano ' + valor + ' não encontrado na lista.');
            await pausaAleatoria();
            (anoItem.querySelector('.arvore-item-conteudo') || anoItem).click();
            await esperar(function () { return itemSelecionado(box, valor); }, 6000, 'Seleção do ano ' + valor + ' não confirmada.');
            return;
        }
        // Demais abas: busca por nome
        var link = Array.from(box.querySelectorAll('a')).find(function (a) { return clean(a.innerText) === 'Pesquisar por nome'; });
        if (link) { link.click(); await workerSleep(600); }
        var search = box.querySelector("input[ng-model='vm.textoBusca']");
        if (!search) throw new Error('Campo de busca da aba "' + titulo + '" não encontrado.');
        var candidatos = titulo === 'Banca' ? (ALIASES_BANCA[valor] || [valor]) : [valor];
        var item = null;
        var candidatoAchado = null;
        for (var i = 0; i < candidatos.length && !item; i += 1) {
            setInput(search, candidatos[i]);
            try {
                await esperar(function () { return !!itemDaArvore(box, candidatos[i]); }, 3500, '');
                item = itemDaArvore(box, candidatos[i]);
                candidatoAchado = candidatos[i];
            } catch (e) { item = null; }
        }
        if (!item) throw new Error('"' + valor + '" não encontrado no filtro ' + titulo + '.');
        await pausaAleatoria();
        // a lista pode ter sido re-renderizada pelo Angular após a busca: re-obtém o nó fresco
        if (!item.isConnected) item = itemDaArvore(box, candidatoAchado) || item;
        (item.querySelector('.arvore-item-conteudo') || item).click();
        try {
            await esperar(function () { return itemSelecionado(box, candidatoAchado); }, 2500, '');
            return;
        } catch (e) {
            // fallback Angular (mesmo do projeto): dispara vm.notificarClick no escopo do item
            await workerSleep(400);
            if (!item.isConnected) item = itemDaArvore(box, candidatoAchado) || item;
            var clickable = item.querySelector('.arvore-item-conteudo') || item;
            var angEl = angular.element(clickable);
            var scope = angEl && ((typeof angEl.isolateScope === 'function' && angEl.isolateScope()) || (typeof angEl.scope === 'function' && angEl.scope()));
            if (scope && scope.vm && typeof scope.vm.notificarClick === 'function') {
                var notify = function () { scope.vm.notificarClick(); };
                if (scope.$root && scope.$root.$$phase) notify();
                else if (typeof scope.$apply === 'function') scope.$apply(notify);
                else notify();
                await esperar(function () { return itemSelecionado(box, candidatoAchado); }, 6000, 'O TecConcursos ignorou a seleção de "' + valor + '".');
                return;
            }
            throw new Error('O TecConcursos ignorou a seleção de "' + valor + '".');
        }
    }

    function contarFiltrosAtivos() {
        var painel = visiveis('.gerador-filtrador').find(function (n) { return /Filtros ativos:/i.test(n.innerText || ''); });
        var t = painel ? clean(painel.innerText) : '';
        var m = t.match(/Filtros ativos:\s*(\d+)/i);
        return m ? Number(m[1]) : 0;
    }

    async function limparFiltros() {
        if (!contarFiltrosAtivos()) return;
        var limpar = visiveis('.gerador-filtrador-cabecalho-limpar, [class*="limpar"]').find(function (n) { return /Limpar/i.test(n.innerText || ''); });
        if (!limpar) throw new Error('Há filtros ativos, mas não encontrei o controle "Limpar".');
        await pausaAleatoria();
        limpar.click();
        await esperar(function () { return contarFiltrosAtivos() === 0; }, 8000, 'A limpeza dos filtros não foi confirmada.');
    }

    function lerContagem() {
        var el = document.querySelector('.gerador-filtrador strong.ng-binding');
        return el ? parseInt(clean(el.textContent).replace(/\D/g, ''), 10) || 0 : 0;
    }

    async function aplicarFiltros(materia, plano) {
        await limparFiltros();
        // assuntos (folha de cada caminho)
        for (var i = 0; i < materia.subjectPaths.length; i += 1) {
            var folha = ultimoSegmento(materia.subjectPaths[i]);
            if (!folha) continue;
            UI.setStatus('Filtros: assunto "' + folha + '"');
            await selecionarValor('Matéria e assunto', folha);
        }
        // bancas
        for (var b = 0; b < plano.banks.length; b += 1) {
            UI.setStatus('Filtros: banca ' + plano.banks[b]);
            await selecionarValor('Banca', plano.banks[b]);
        }
        // anos
        for (var y = 0; y < plano.years.length; y += 1) {
            UI.setStatus('Filtros: ano ' + plano.years[y]);
            await selecionarValor('Ano', String(plano.years[y]));
        }
        // opções
        if (plano.removeCancelled) {
            var anuladas = visiveis("[role='button'].link-atalho").find(function (n) { return /Remover anuladas/i.test(n.innerText || ''); });
            if (anuladas) { await pausaAleatoria(); anuladas.click(); await workerSleep(1200); }
        }
        if (plano.removeOutdated) {
            var desatualizadas = visiveis("[role='button'].link-atalho").find(function (n) { return /Remover desatualizadas/i.test(n.innerText || ''); });
            if (desatualizadas) { await pausaAleatoria(); desatualizadas.click(); await workerSleep(1200); }
        }
        // aguarda o contador estabilizar
        await esperar(function () { return lerContagem() > 0; }, CONFIG.filtroTimeout, 'Os filtros não retornaram questões.');
    }

    /* =====================================================================
     * ENGINE — CRIAÇÃO DO CADERNO
     * =================================================================== */
    async function criarCaderno(materia, config) {
        var nomeInput = document.querySelector('#nomeCadernoId');
        var pastaSelect = document.querySelector('#pastaCadernosId');
        var gerar = visiveis('button').find(function (b) { return /Gerar Caderno/i.test(b.innerText || ''); });
        if (!nomeInput || !pastaSelect || !gerar) throw new Error('Controles de geração do caderno não encontrados.');

        // nome (sincroniza ng-model no blur)
        setInput(nomeInput, materia.title);
        nomeInput.dispatchEvent(new Event('blur', { bubbles: true }));
        await workerSleep(600);

        // pasta
        var opt = Array.from(pastaSelect.options).find(function (o) { return String(o.value) === String(config.folderId); });
        if (!opt) throw new Error('A pasta ' + config.folderId + ' não está no seletor. Abra a página de filtros da pasta correta.');
        pastaSelect.value = opt.value;
        pastaSelect.dispatchEvent(new Event('change', { bubbles: true }));

        await esperar(function () { return !gerar.disabled; }, 12000, 'O botão "Gerar Caderno" permaneceu desabilitado.');
        await pausaAleatoria();
        gerar.click();

        // aguarda navegação para o caderno criado
        await esperar(function () { return paginaAtual() === 'caderno'; }, 20000, 'O caderno não foi criado (a página não navegou).');
        return cadernoIdDaUrl();
    }

    /* =====================================================================
     * ENGINE — IMPRESSÃO (réplica do projeto: partes de até 200 questões,
     * extração da página de saída + gabarito oficial do bloco #gabarito)
     * O site tem um saldo diário de impressão (/api/cadernos/impressoes/restantes).
     * Imprimimos até min(saldo, limite configurado). Quando o saldo acaba,
     * a captura por clique assume do ponto em que a impressão parou.
     * =================================================================== */
    function hojeStr() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function saldoImpressaoLocal() {
        if (estado.impressao.data !== hojeStr()) {
            estado.impressao = { data: hojeStr(), usadas: 0 };
        }
        var teto = (estado.config && estado.config.impressaoLimiteDia) ? Number(estado.config.impressaoLimiteDia) : CONFIG.impressaoLimiteDia;
        var usadas = Number(estado.impressao.usadas) || 0;
        return Math.max(0, (teto || 1000) - usadas);
    }

    async function consultarSaldoSite() {
        try {
            var r = await fetch('/api/cadernos/impressoes/restantes', {
                credentials: 'include',
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!r.ok) return -1;
            var d = await r.json();
            return d && typeof d.int === 'number' ? d.int : -1;
        } catch (e) { return -1; }
    }

    function maxNumberColetado(caderno) {
        var max = 0;
        (caderno.questoes || []).forEach(function (q) { if (Number(q.number) > max) max = Number(q.number); });
        return max;
    }

    function htmlAbsoluto(node) {
        // clona e resolve URLs de imagens (mesma ideia do projeto;
        // respeita data-tec-original-src, usado quando imagens são adiadas)
        var clone = node.cloneNode(true);
        Array.from(clone.querySelectorAll('img')).forEach(function (img) {
            var src = img.getAttribute('data-tec-original-src') || img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '';
            if (src && !/^data:/i.test(src)) img.setAttribute('src', new URL(src, location.href).href);
            else if (src) img.setAttribute('src', src);
            var srcset = img.getAttribute('data-tec-original-srcset') || img.getAttribute('srcset') || '';
            if (srcset) {
                img.setAttribute('srcset', srcset.split(',').map(function (c) {
                    var p = c.trim().split(/\s+/);
                    p[0] = new URL(p[0], location.href).href;
                    return p.join(' ');
                }).join(', '));
            }
        });
        clone.querySelectorAll('script, style').forEach(function (n) { n.remove(); });
        return clone.innerHTML.trim();
    }

    /* Bloqueia o window.print() automático que o site dispara na página de saída
       (mesmo comportamento do print-blocker do projeto). Sem isso, o diálogo
       nativo de impressão abriria e interromperia a extração. */
    function bloquearPrintAutomatico() {
        if (!/\/questoes\/cadernos\/\d+\/imprimir/i.test(location.pathname || '')) return;
        try {
            window.print = function () { return undefined; };
        } catch (e) { /* ignorado */ }
    }

    function extrairQuestoesImpressas() {
        // parsePrintedQuestion do projeto, adaptado ao formato da nossa biblioteca
        var saida = [];
        Array.from(document.querySelectorAll('.questao')).forEach(function (source, index) {
            var link = source.querySelector("a[href*='/questoes/']");
            var url = link ? String(link.href || '') : '';
            var idMatch = url.match(/\/questoes\/(\d+)/);
            var info = source.querySelector('.cabecalho .informacoes');
            var blocks = info ? Array.from(info.children || []) : [];
            var headerBlock = blocks.filter(function (b) {
                return !/(linkQuestao|classificacao)/.test(String(b.className || ''));
            })[0];
            var classificacao = source.querySelector('.classificacao');
            var classText = clean(classificacao && (classificacao.innerText || classificacao.textContent));
            var classParts = classText.split(/\s+-\s+/);
            var meta = parseCabecalho(headerBlock && (headerBlock.innerText || headerBlock.textContent));
            var enunciado = source.querySelector('.enunciado');
            var numNode = enunciado ? enunciado.querySelector('strong') : null;
            var numMatch = clean(numNode && (numNode.innerText || numNode.textContent)).match(/^(\d+)\)/);
            var alternativas = Array.from(source.querySelectorAll('.alternativa')).map(function (alt) {
                var raw = clean(alt && (alt.innerText || alt.textContent));
                var lm = raw.match(/^([a-e])\)\s*/i);
                return {
                    letter: lm ? lm[1].toUpperCase() : '',
                    text: raw.replace(/^([a-e])\)\s*/i, ''),
                    html: htmlAbsoluto(alt)
                };
            }).filter(function (o) { return o.letter && o.text; });
            var answerNode = source.querySelector('.gabarito, .resposta-correta');
            var answer = clean(answerNode && (answerNode.innerText || answerNode.textContent));
            var gab = (answer.match(/(?:GABARITO|RESPOSTA|ALTERNATIVA)\s*[:.)-]?\s*([A-E])\b/i) || answer.match(/^([A-E])\s*[:.)-]/i) || []);
            saida.push({
                id: idMatch ? idMatch[1] : 'print-' + (index + 1),
                number: numMatch ? Number(numMatch[1]) : index + 1,
                url: url || (location.origin + '/questoes/' + (idMatch ? idMatch[1] : '')),
                header: meta.raw,
                bank: meta.bank,
                year: meta.year,
                vacancy: meta.vacancy,
                organization: meta.organization,
                role: meta.role,
                subject: clean(classParts.shift()),
                topic: clean(classParts.join(' - ')),
                statement: clean(enunciado && (enunciado.innerText || enunciado.textContent)),
                statementHtml: enunciado ? htmlAbsoluto(enunciado) : '',
                options: alternativas,
                answer: gab[1] ? gab[1].toUpperCase() : '',
                answerSource: gab[1] ? 'print-page' : ''
            });
        });
        return saida;
    }

    function parseGabaritoBloco() {
        // bloco #gabarito no final da página de impressão (#gabarito .resposta)
        var entries = [];
        var nodes = document.querySelectorAll('#gabarito .resposta');
        nodes.forEach(function (node) {
            var numberNode = node.querySelector('strong');
            var rawNumber = numberNode ? String(numberNode.textContent || '') : '';
            var index = Number(rawNumber.replace(/[^\d]/g, ''));
            var answer = String(node.textContent || '').replace(/^\s*\d+\s*\)\s*/, '').trim();
            var gab = (answer.match(/(?:GABARITO|RESPOSTA|ALTERNATIVA)\s*[:.)-]?\s*([A-E])\b/i) || answer.match(/^([A-E])(?:\s*[:.)-]|\s*$)/i) || answer.match(/^[A-E]$/i) || []);
            if (index > 0 && gab[1]) entries.push({ index: index, answer: gab[1].toUpperCase() });
        });
        return entries;
    }

    function aplicarGabaritoBloco(questoes, entries) {
        var byIndex = {};
        entries.forEach(function (e) { if (e.index > 0 && e.answer) byIndex[e.index] = e.answer; });
        return questoes.map(function (q) {
            if (q.answer) return q;
            var a = byIndex[Number(q.number)];
            if (!a) return q;
            q.answer = a;
            q.answerSource = 'print-page';
            return q;
        });
    }

    function consolidarImpressas(caderno, extraidas) {
        var colecao = caderno.questoes || (caderno.questoes = []);
        var porId = {};
        colecao.forEach(function (q) { porId[q.id] = true; });
        var novas = 0;
        extraidas.forEach(function (q) {
            if (porId[q.id]) return;
            porId[q.id] = true;
            colecao.push(q);
            novas += 1;
        });
        caderno.questoes = colecao;
        caderno.coletadas = colecao.length;
        return novas;
    }

    function scopeDoInput(sel) {
        var el = document.querySelector(sel);
        if (!el) return null;
        var angEl = angular.element(el);
        return (typeof angEl.isolateScope === 'function' && angEl.isolateScope()) || (typeof angEl.scope === 'function' && angEl.scope());
    }

    async function submeterParteImpressao(caderno) {
        // página esperada: o caderno. Abre a aba Imprimir e submete a próxima parte.
        var aba = visiveis("div[role=button]").find(function (n) { return mesmoTexto(n.innerText, 'Imprimir'); });
        if (!aba) throw new Error('Aba Imprimir não encontrada no caderno.');
        aba.click();
        await esperar(function () { return !!document.querySelector('#questaoInicialInput'); }, 12000, 'A tela de impressão não abriu.');
        await workerSleep(600);
        var scope = scopeDoInput('#questaoInicialInput');
        if (!scope || !scope.vm) throw new Error('Controller de impressão não encontrado.');
        var primeira = maxNumberColetado(caderno) + 1;
        var total = Number(caderno.total) || (scope.vm.caderno && scope.vm.caderno.numeroTotalQuestoes) || primeira;
        var saldoSite = await consultarSaldoSite();
        var tetoLocal = saldoImpressaoLocal();
        var disponivel = saldoSite >= 0 ? Math.min(saldoSite, tetoLocal) : tetoLocal;
        var count = Math.min(200, Math.max(0, total - primeira + 1), disponivel);
        if (count <= 0) throw new Error('Sem saldo de impressão disponível para esta parte.');
        scope.$apply(function () {
            scope.vm.questaoInicial = primeira;
            scope.vm.calcularQuantidadeMaxima(primeira);
            scope.vm.quantidadeQuestoesGetterSetter(count);
        });
        await workerSleep(600);
        // aguarda o Angular habilitar o botão (totalQuestoesSelecionadas > 0 e saldo > 0)
        await esperar(function () {
            var btn = document.querySelector('#confirmar-button');
            return btn && !btn.disabled;
        }, 8000, 'O botão "Imprimir Caderno" não habilitou.');
        var form = document.querySelector('#configurar-impressao form, form[action*="imprimir"]');
        if (!form) throw new Error('Formulário de impressão não encontrado.');
        form.setAttribute('target', '_self'); // mantém a aba atual (retomável)
        estado.fase = 'impr-saida';
        estado.impressaoParte = { start: primeira, count: count };
        estado.mensagem = 'Imprimindo parte: questões ' + primeira + ' a ' + (primeira + count - 1) + ' (' + count + ').';
        salvarEstado();
        UI.setStatus(estado.mensagem);
        log(estado.mensagem);
        form.submit(); // POST → navega para a página de saída (auto-resume retoma)
    }

    async function processarSaidaImpressao(caderno) {
        // página esperada: /questoes/cadernos/{id}/imprimir (saída)
        var parte = estado.impressaoParte || { start: 1, count: 0 };
        var esperadas = Number(parte.count) || 0;
        await esperar(function () {
            var n = document.querySelectorAll('.questao').length;
            return n > 0 && (!esperadas || n >= esperadas);
        }, 60000, 'A página de impressão não montou as questões esperadas (' + esperadas + ').');
        await workerSleep(400);
        var extraidas = extrairQuestoesImpressas();
        var comGabarito = aplicarGabaritoBloco(extraidas, parseGabaritoBloco());
        var novas = consolidarImpressas(caderno, comGabarito);
        estado.impressao.usadas += comGabarito.length;
        estado.impressaoParte = null;
        caderno.total = caderno.total || (parte.start + comGabarito.length - 1);
        salvarEstado();
        UI.renderBiblioteca();
        UI.renderProgresso();
        log('Impressão: parte salva (' + comGabarito.length + ' questões, ' + novas + ' novas). Acumulado: ' + estado.impressao.usadas + ' hoje.');
        var faltam = (caderno.total || 0) - (caderno.questoes || []).length;
        if (faltam > 0 && saldoImpressaoLocal() > 0) {
            estado.fase = 'impr-caderno';
            estado.mensagem = 'Próxima parte de impressão do caderno ' + caderno.titulo + '.';
            salvarEstado();
            irPara(location.origin + '/questoes/cadernos/' + caderno.id); // navega → auto-resume
            return;
        }
        estado.fase = 'coletando';
        estado.mensagem = 'Impressão concluída/encerrada para "' + caderno.titulo + '". Continuando com captura por clique se faltarem questões.';
        salvarEstado();
    }

    /* =====================================================================
     * ENGINE — COLETA (copia cada questão com gabarito)
     * =================================================================== */
    async function coletarCaderno(caderno) {
        // caderno = {id, titulo, total, questoes: [...]}
        var colecao = caderno.questoes || [];
        indexarEstado(estado);
        var porId = questaoIdsPorCaderno.get(String(caderno.id)) || new Set();

        // Começa de onde a coleta parou (retomada) ou da questão 1
        var maxColetada = 0;
        colecao.forEach(function (q) { if (Number(q.number) > maxColetada) maxColetada = Number(q.number); });
        var posInicial = lerPosicao();
        if (maxColetada > 0 && (!posInicial || posInicial.posicao !== maxColetada)) {
            UI.setStatus('Retomando da questão ' + maxColetada + '...');
            var sentinelRetomada = lerQuestaoIdAtual() || '';
            var assinaturaRetomada = assinaturaQuestao();
            navegarQuestao(maxColetada);
            await new Promise(function (resolve) { aguardarQuestaoMudar(sentinelRetomada, assinaturaRetomada, resolve); });
            await workerSleep(800);
        } else if (maxColetada === 0 && posInicial && posInicial.posicao > 1) {
            UI.setStatus('Indo para a questão 1...');
            var sentinelQ1 = lerQuestaoIdAtual() || '';
            var assinaturaQ1 = assinaturaQuestao();
            navegarQuestao(1);
            await new Promise(function (resolve) { aguardarQuestaoMudar(sentinelQ1, assinaturaQ1, resolve); });
            await workerSleep(800);
        }

        while (true) {
            if (estado.status !== 'rodando') return;
            var questao = extrairQuestaoAtual();
            if (!questao || !questao.id) {
                await workerSleep(1200);
                questao = extrairQuestaoAtual();
                if (!questao || !questao.id) throw new Error('Não consegui extrair a questão atual.');
            }
            var existente = porId.has(String(questao.id)) ? questoesPorId.get(String(questao.id)) : null;
            if (!existente || !existente.answer) {
                UI.setStatus('Coletando questão ' + questao.number + '/' + (caderno.total || '?') + '...');
                var gabarito = await resolverParaGabarito(questao);
                if (existente) {
                    // atualiza apenas o que faltava (gabarito retentado)
                    existente.answer = gabarito || existente.answer || '';
                    existente.answerSource = gabarito ? 'resolucao' : (existente.answerSource || 'nao-obtido');
                    if (!existente.statementHtml) existente.statementHtml = questao.statementHtml;
                    if (!existente.statement) existente.statement = questao.statement;
                    if (!existente.options.length) existente.options = questao.options;
                } else {
                    questao.answer = gabarito || '';
                    questao.answerSource = gabarito ? 'resolucao' : 'nao-obtido';
                    colecao.push(questao);
                    porId.add(String(questao.id));
                    questoesPorId.set(String(questao.id), questao);
                }
                caderno.questoes = colecao;
                caderno.coletadas = colecao.length;
                salvarEstado(true);
                UI.renderBiblioteca();
                UI.renderProgresso();
                log('#' + questao.id + ' (pos ' + questao.number + ') coletada. Gabarito: ' + (gabarito || 'NÃO OBTIDO'));
            }
            var pos = lerPosicao();
            var total = caderno.total || (pos ? pos.total : colecao.length);
            caderno.total = total;
            if (!pos || pos.posicao >= total) break;
            await pausaAleatoria();
            if (estado.status !== 'rodando') return;
            var idAnterior = questao.id;
            var assinaturaAnterior = assinaturaQuestao();
            if (!navegarQuestao(pos.posicao + 1)) throw new Error('Não consegui navegar para a próxima questão.');
            var mudou = await new Promise(function (resolve) { aguardarQuestaoMudar(idAnterior, assinaturaAnterior, resolve); });
            if (!mudou && estado.status === 'rodando') {
                // timeout transitório: tenta navegar de novo uma vez
                log('Navegação lenta para a questão ' + (pos.posicao + 1) + ' — tentando de novo.');
                assinaturaAnterior = assinaturaQuestao();
                if (!navegarQuestao(pos.posicao + 1)) throw new Error('Não consegui navegar para a próxima questão.');
                mudou = await new Promise(function (resolve) { aguardarQuestaoMudar(idAnterior, assinaturaAnterior, resolve); });
            }
            if (!mudou) throw new Error('A questão ' + (pos.posicao + 1) + ' não carregou a tempo.');
        }
        // Passadas de retry: questões que ficaram sem gabarito (ex: acertou ao marcar A)
        var passadas = 0;
        while (passadas < 2 && estado.status === 'rodando') {
            var pendentes = colecao.filter(function (q) { return !q.answer; });
            if (!pendentes.length) break;
            passadas += 1;
            log('Retry ' + passadas + ': ' + pendentes.length + ' questões sem gabarito.');
            UI.setStatus('Retry de gabarito: ' + pendentes.length + ' questão(ões)...');
            var idsPendentes = {};
            pendentes.forEach(function (q) { idsPendentes[q.id] = true; });
            for (var i = 0; i < colecao.length; i += 1) {
                if (estado.status !== 'rodando') return;
                if (!idsPendentes[colecao[i].id]) continue;
                var posAntes = lerPosicao();
                var sentinelRetry = (posAntes && posAntes.posicao === colecao[i].number) ? '' : (lerQuestaoIdAtual() || '');
                var assinaturaRetry = assinaturaQuestao();
                navegarQuestao(colecao[i].number);
                await new Promise(function (resolve) { aguardarQuestaoMudar(sentinelRetry, assinaturaRetry, resolve); });
                await workerSleep(500);
                var qRetry = extrairQuestaoAtual();
                if (!qRetry) continue;
                var gRetry = await resolverParaGabarito(qRetry);
                if (gRetry) {
                    colecao[i].answer = gRetry;
                    colecao[i].answerSource = 'resolucao';
                    caderno.questoes = colecao;
                    salvarEstado();
                    log('Gabarito obtido no retry para #' + colecao[i].id + ': ' + gRetry);
                }
                await pausaAleatoria();
            }
        }
        caderno.completo = true;
        salvarEstado();
        UI.renderBiblioteca();
        UI.renderProgresso();
        log('Caderno "' + caderno.titulo + '" completo (' + caderno.questoes.length + ' questões).');
    }
    /* =====================================================================
     * ORQUESTRADOR — máquina de fases retomável por navegação
     * ---------------------------------------------------------------------
     * Regra de ouro: NENHUM await cruza uma navegação completa. Toda
     * navegação (irPara) salva o estado com a fase e encerra a execução;
     * o próximo carregamento da página (auto-resume) continua pela fase.
     * Fases por matéria (monotônicas, sem reentrada):
     *   pasta-check → criar-novo → criando → coletando
     * =================================================================== */
    function acharCadernoPorTitulo(titulo) {
        return Object.keys(estado.biblioteca).map(function (k) { return estado.biblioteca[k]; })
            .find(function (b) { return b.titulo === titulo; }) || null;
    }

    function urlFiltros() { return location.origin + '/questoes/filtrar?idPasta=' + (estado.config ? estado.config.folderId : ''); }
    function urlPasta() { return location.origin + '/questoes/pastas/' + (estado.config ? estado.config.folderId : ''); }
    function urlCaderno(id) { return location.origin + '/questoes/cadernos/' + id; }

    function terminarCompleto() {
        estado.status = 'parado';
        estado.fase = 'nenhuma';
        estado.cadernoAtual = null;
        estado.mensagem = 'Plano completo: ' + estado.plano.matters.length + ' matérias processadas.';
        salvarEstado();
        UI.setStatus(estado.mensagem);
        UI.renderProgresso();
        UI.renderBiblioteca();
        log('Plano completo.');
    }

    function terminarLote() {
        var plano = estado.plano;
        var config = estado.config;
        if (estado.planIndex >= plano.matters.length) { terminarCompleto(); return; }
        if (config.autoContinuarLote) {
            estado.loteFim = Math.min(estado.planIndex + config.batchSize, plano.matters.length);
            log('Continuando lote automaticamente...');
            processarLote();
            return;
        }
        estado.status = 'pausado';
        estado.fase = 'nenhuma';
        estado.cadernoAtual = null;
        estado.mensagem = 'Lote concluído: ' + estado.planIndex + ' de ' + plano.matters.length +
            ' matérias. Próximo lote: ' + (estado.planIndex + 1) + ' a ' + Math.min(estado.planIndex + config.batchSize, plano.matters.length);
        salvarEstado();
        UI.setStatus(estado.mensagem);
        UI.renderProgresso();
        UI.renderBiblioteca();
        log('Lote concluído em ' + estado.planIndex + ' matérias.');
    }

    function encontrarLinkCadernoNaPasta(titulo) {
        var alvo = titulo.toLocaleLowerCase('pt-BR');
        return Array.from(document.querySelectorAll("a[href*='/questoes/cadernos/']"))
            .filter(function (a) { return a.offsetParent !== null; })
            .find(function (a) {
                var txt = clean(a.innerText || a.textContent);
                return txt.toLocaleLowerCase('pt-BR') === alvo && !/imprimir/i.test(a.href || '');
            }) || null;
    }

    function avancarMateria() {
        estado.planIndex += 1;
        estado.cadernoAtual = null;
        estado.fase = 'nenhuma';
        salvarEstado();
        UI.renderBiblioteca();
        UI.renderProgresso();
        if (estado.loteFim > 0 && estado.planIndex >= estado.loteFim) {
            terminarLote();
        } else {
            processarLote();
        }
    }

    async function processarLote() {
        var plano = estado.plano;
        var config = estado.config;
        if (!plano || !config) return;
        if (estado.status !== 'rodando') return;
        if (estado.planIndex >= plano.matters.length) { terminarCompleto(); return; }

        var materia = plano.matters[estado.planIndex];
        var existente = acharCadernoPorTitulo(materia.title);

        /* ---- matéria com caderno registrado: impressão → clique ---- */
        if (existente) {
            if (existente.completo && existente.questoes && existente.questoes.length) {
                avancarMateria();
                return;
            }
            // retomada da página de saída da impressão
            if (estado.fase === 'impr-saida') {
                if (paginaAtual() === 'impressao') {
                    try {
                        await processarSaidaImpressao(existente);
                    } catch (e) {
                        log('Falha ao ler a saída da impressão: ' + (e && e.message || e) + '. Seguindo com captura por clique.');
                        estado.fase = 'coletando';
                        salvarEstado();
                    }
                    processarLote();
                    return;
                }
                estado.fase = 'impr-caderno';
                salvarEstado();
                irPara(urlCaderno(existente.id));
                return;
            }
            // decisão inicial: tenta impressão antes do clique (config.usarImpressao)
            if (estado.fase !== 'coletando' && estado.fase !== 'impr-caderno') {
                var faltaImpressao = (existente.total || 0) - (existente.questoes || []).length;
                if ((!estado.config || estado.config.usarImpressao !== false) && faltaImpressao > 0 && saldoImpressaoLocal() > 0) {
                    estado.fase = 'impr-caderno';
                    estado.mensagem = 'Impressão disponível. Preparando partes do caderno "' + existente.titulo + '".';
                    salvarEstado();
                    UI.setStatus(estado.mensagem);
                    processarLote();
                    return;
                }
                estado.fase = 'coletando';
            }
            // fase impr-caderno: página do caderno → submete a próxima parte
            if (estado.fase === 'impr-caderno') {
                if (paginaAtual() !== 'caderno' || cadernoIdDaUrl() !== existente.id) {
                    irPara(urlCaderno(existente.id));
                    return;
                }
                try {
                    await submeterParteImpressao(existente);
                    return; // navegou → auto-resume em 'impr-saida'
                } catch (e) {
                    log('Impressão indisponível (' + (e && e.message || e) + '). Seguindo com captura por clique.');
                    estado.fase = 'coletando';
                    salvarEstado();
                }
            }
            // captura por clique (começa da primeira posição não capturada)
            if (paginaAtual() !== 'caderno' || cadernoIdDaUrl() !== existente.id) {
                estado.fase = 'coletando';
                estado.cadernoAtual = existente;
                estado.mensagem = 'Abrindo caderno ' + existente.id + '...';
                salvarEstado();
                UI.setStatus(estado.mensagem);
                irPara(urlCaderno(existente.id)); // navega → próximo boot retoma
                return;
            }
            estado.cadernoAtual = existente;
            estado.fase = 'coletando';
            salvarEstado();
            UI.renderProgresso();
            try {
                await coletarCaderno(existente); // SPA: sem navegação completa
                avancarMateria();
            } catch (e) {
                estado.status = 'erro';
                estado.erro = String(e && e.message || e);
                estado.fase = 'nenhuma';
                salvarEstado();
                log('ERRO: ' + estado.erro);
                UI.setStatus('Erro: ' + estado.erro);
                UI.renderProgresso();
            }
            return;
        }

        /* ---- matéria sem caderno: máquina de criação ---- */
        switch (estado.fase) {
            case 'pasta-check': {
                // página esperada: a pasta de destino
                if (paginaAtual() !== 'pasta') {
                    irPara(urlPasta()); // navega → próximo boot retoma em pasta-check
                    return;
                }
                var link = encontrarLinkCadernoNaPasta(materia.title);
                if (link) {
                    var mId = (link.href || '').match(/cadernos\/(\d+)/);
                    if (mId) {
                        log('Caderno "' + materia.title + '" já existe (' + mId[1] + '). Usando o existente.');
                        estado.biblioteca[mId[1]] = { id: mId[1], titulo: materia.title, categoria: materia.group || 'Plano', total: 0, coletadas: 0, completo: false, questoes: [] };
                        estado.fase = 'nenhuma';
                        salvarEstado();
                        UI.renderBiblioteca();
                        processarLote();
                        return;
                    }
                }
                log('Caderno não encontrado na pasta. Criando novo.');
                estado.fase = 'criar-novo';
                salvarEstado();
                irPara(urlFiltros()); // navega → próximo boot retoma em criar-novo
                return;
            }
            case 'criar-novo': {
                // página esperada: filtros
                if (paginaAtual() !== 'filtros') {
                    irPara(urlFiltros()); // navega → próximo boot retoma em criar-novo
                    return;
                }
                if (!document.querySelector('#nomeCadernoId')) {
                    await workerSleep(2500);
                    if (!document.querySelector('#nomeCadernoId')) {
                        estado.status = 'erro';
                        estado.erro = 'A página de filtros não carregou os controles de criação.';
                        estado.fase = 'nenhuma';
                        salvarEstado();
                        UI.setStatus('Erro: ' + estado.erro);
                        return;
                    }
                }
                try {
                    UI.setStatus('Aplicando filtros: ' + materia.title);
                    await aplicarFiltros(materia, plano);
                    var contagem = lerContagem();
                    if (!contagem) {
                        log('Matéria "' + materia.title + '" sem questões nos filtros. Pulando.');
                        estado.planIndex += 1;
                        estado.fase = 'nenhuma';
                        salvarEstado();
                        processarLote();
                        return;
                    }
                    estado.fase = 'criando';
                    estado.pendenciaContagem = contagem;
                    estado.mensagem = 'Criando caderno: ' + materia.title + ' (' + contagem + ' questões)';
                    salvarEstado();
                    UI.setStatus(estado.mensagem);
                    await criarCaderno(materia, config); // clique → navega → próximo boot retoma em 'criando'
                } catch (e) {
                    estado.status = 'erro';
                    estado.erro = String(e && e.message || e);
                    estado.fase = 'nenhuma';
                    salvarEstado();
                    log('ERRO: ' + estado.erro);
                    UI.setStatus('Erro: ' + estado.erro);
                    UI.renderProgresso();
                }
                return;
            }
            case 'criando': {
                // página esperada: o caderno recém-criado
                if (paginaAtual() === 'caderno') {
                    var novoId = cadernoIdDaUrl();
                    var contagemSalva = estado.pendenciaContagem || 0;
                    estado.biblioteca[novoId] = { id: novoId, titulo: materia.title, categoria: materia.group || 'Plano', total: contagemSalva, coletadas: 0, completo: false, questoes: [] };
                    delete estado.pendenciaContagem;
                    estado.fase = 'nenhuma';
                    salvarEstado();
                    UI.renderBiblioteca();
                    log('Caderno criado: ' + novoId + ' — "' + materia.title + '" (' + contagemSalva + ' questões)');
                    processarLote();
                    return;
                }
                // crash entre o clique e a navegação: página ainda é filtros → re-verifica a pasta
                estado.fase = 'pasta-check';
                salvarEstado();
                irPara(urlPasta());
                return;
            }
            default: {
                // fase 'nenhuma' (início/retomada): sempre verifica a pasta antes de criar
                estado.fase = 'pasta-check';
                estado.mensagem = 'Verificando se "' + materia.title + '" já existe na pasta...';
                salvarEstado();
                UI.setStatus(estado.mensagem);
                irPara(urlPasta()); // navega → próximo boot retoma em pasta-check
                return;
            }
        }
    }

    function iniciar() {
        if (estado.status === 'rodando') return;
        if (!estado.plano || !estado.config) {
            UI.setStatus('Carregue o plano e configure antes de iniciar.');
            estado.status = 'parado';
            UI.renderProgresso();
            return;
        }
        estado.status = 'rodando';
        estado.modo = 'lote';
        estado.erro = null;
        estado.loteInicio = Math.max(0, estado.planIndex);
        estado.loteFim = Math.min(estado.planIndex + estado.config.batchSize, estado.plano.matters.length);
        salvarEstado();
        UI.renderProgresso();
        processarLote();
    }

    function parar() {
        estado.status = 'pausado';
        salvarEstado();
        UI.renderProgresso();
        UI.setStatus('Pausado em ' + (estado.planIndex + 1) + ' de ' + (estado.plano ? estado.plano.matters.length : '?') + ' matérias. Dados preservados.');
    }

    function continuar() {
        if (estado.status === 'rodando') return;
        if (!estado.plano || !estado.config) { UI.setStatus('Carregue o plano e configure primeiro.'); return; }
        estado.status = 'rodando';
        estado.modo = 'lote';
        estado.erro = null;
        estado.loteInicio = Math.max(0, estado.planIndex);
        estado.loteFim = Math.min(estado.planIndex + estado.config.batchSize, estado.plano.matters.length);
        salvarEstado();
        UI.renderProgresso();
        processarLote();
    }

    /* =====================================================================
     * (continua — exportadores e UI nas próximas seções)
     * =================================================================== */
    window.__TecFabrica = {
        CONFIG: CONFIG,
        estado: function () { return estado; },
        iniciar: iniciar,
        parar: parar,
        continuar: continuar,
        log: log,
        GabaritoInterceptor: GabaritoInterceptor
    };

    /* =====================================================================
     * EXPORTAÇÃO — réplica fiel dos templates do projeto "Tecconcursos"
     * =================================================================== */
    function safeFilename(value) {
        return clean(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\.+$/g, '').slice(0, 100) || 'arquivo';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function jsJson(value) {
        return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
    }

    function baixarBlob(nomeArquivo, blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = nomeArquivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    function entradaBiblioteca(caderno) {
        // mesmo formato de entrada do projeto: {id, code, title, group, questions}
        return {
            id: 'caderno-' + caderno.id,
            code: caderno.id,
            title: caderno.titulo,
            group: 'Plano',
            questions: (caderno.questoes || []).map(function (q) {
                return {
                    id: q.id,
                    number: q.number,
                    url: q.url,
                    header: q.header,
                    bank: q.bank || '',
                    year: q.year != null ? q.year : '',
                    vacancy: q.vacancy || '',
                    organization: q.organization || '',
                    role: q.role || '',
                    subject: q.subject || '',
                    topic: q.topic || '',
                    statement: q.statement || '',
                    statementHtml: q.statementHtml || '',
                    options: q.options || [],
                    answer: q.answer || ''
                };
            })
        };
    }

    /* ---- HTML interativo (template do projeto) ---- */
    function buildInteractiveHtml(entry) {
        var data = Object.assign({}, entry, { questions: entry.questions || [] });
        var initial = { attempts: [{ id: 'tentativa-1', createdAt: new Date().toISOString(), answers: {}, eliminated: {} }], activeAttempt: 0 };
        var fileName = safeFilename((entry.title || entry.code || 'caderno') + '-interativo.html');
        var runtime = String.raw`(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("tec-caderno-data").textContent);
  var fallback = JSON.parse(document.getElementById("tec-caderno-state").textContent);
  var state = fallback;
  var index = 0;
  var downloadName = ${jsJson(fileName)};
  var darkTheme = document.createElement("style");
  darkTheme.textContent = ":root{color-scheme:dark}body{background:#0b1120;color:#e5e7eb}.card{background:#111827;color:#e5e7eb}.controls button,.controls input,.controls select{background:#1f2937;color:#f9fafb;border-color:#4b5563}.meta{color:#cbd5e1}.tag{background:#172554;color:#bfdbfe}.option{background:#1f2937;color:#f9fafb;border-color:#4b5563;transition:background .2s ease,border-color .2s ease,opacity .3s ease,filter .3s ease}.option:hover{border-color:#60a5fa}.option.selected{background:#172554;border-color:#60a5fa}.option.correct{background:#052e16;border-color:#22c55e}.option.incorrect{background:#450a0a;border-color:#ef4444}.option.eliminated{background:#111827;opacity:.3;filter:grayscale(.8)}.hint,.empty{color:#94a3b8}.feedback{margin:14px 0;padding:12px 14px;border-radius:8px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-weight:700}.feedback.correct{border-color:#22c55e;background:#052e16;color:#bbf7d0}.feedback.incorrect{border-color:#ef4444;background:#450a0a;color:#fecaca}.feedback.unavailable{border-color:#f59e0b;background:#451a03;color:#fde68a}.statement img,.option img{display:block;max-width:100%;height:auto;margin:12px auto;border-radius:8px}";
  document.head.appendChild(darkTheme);
  function read() { return fallback; }
  function write() {
    document.getElementById("tec-caderno-state").textContent = JSON.stringify(state);
    document.getElementById("status").textContent = "Histórico nesta sessão; baixe o HTML para preservar";
  }
  function currentAttempt() { return state.attempts[state.activeAttempt] || state.attempts[0]; }
  function escapeValue(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]; }); }
  function answerLetter(value) {
    var raw = String(value == null ? "" : value).trim().toUpperCase();
    if (/^[A-E]$/.test(raw)) return raw;
    var labeled = raw.match(/(?:GABARITO|RESPOSTA|ALTERNATIVA)\s*[:.)-]?\s*([A-E])\b/);
    if (labeled) return labeled[1];
    var prefixed = raw.match(/^([A-E])\s*[:.)-]/);
    return prefixed ? prefixed[1] : "";
  }
  function visibleQuestions() {
    return data.questions.filter(function (question) {
      return (!document.getElementById("bank").value || question.bank === document.getElementById("bank").value) && (!document.getElementById("year").value || String(question.year || "") === document.getElementById("year").value) && (!document.getElementById("vacancy").value || question.vacancy === document.getElementById("vacancy").value);
    });
  }
  function render() {
    var visible = visibleQuestions();
    var question = visible[index];
    document.getElementById("title").textContent = data.title || data.code || "Caderno";
    document.getElementById("summary").textContent = (data.group || "Sem grupo") + " · " + visible.length + " questão(ões) filtrada(s) de " + data.questions.length;
    if (!question) { document.getElementById("question").innerHTML = '<div class="empty">Nenhuma questão para esse filtro.</div>'; return; }
    var attempt = currentAttempt();
    var correctAnswer = answerLetter(question.answer || question.gabarito);
    var selectedAnswer = answerLetter(attempt.answers[question.id]);
    var confirmed = !!(attempt.confirmed || {})[question.id];
    var meta = [question.bank, question.year, question.organization, question.role, question.vacancy, question.subject, question.topic].filter(Boolean).map(function (value) { return '<span class="tag">' + escapeValue(value) + "</span>"; }).join("");
    var body = question.statementHtml || ("<p>" + escapeValue(question.statement) + "</p>");
    var alternatives = (question.options || []).map(function (option) {
      var selected = selectedAnswer === option.letter;
      var correct = confirmed && !!correctAnswer && correctAnswer === option.letter;
      var incorrect = confirmed && selected && !!correctAnswer && selectedAnswer !== correctAnswer;
      var eliminated = !!(attempt.eliminated[question.id] || {})[option.letter];
      return '<button class="option ' + (selected ? "selected " : "") + (correct ? "correct " : "") + (incorrect ? "incorrect " : "") + (eliminated ? "eliminated " : "") + '" aria-pressed="' + (selected ? "true" : "false") + '" data-letter="' + escapeValue(option.letter) + '">' + (option.html || ("<strong>" + escapeValue(option.letter) + ")</strong> " + escapeValue(option.text))) + "</button>";
    }).join("");
    var feedbackClass = "feedback";
    var feedbackText = "Selecione uma alternativa e clique em Responder para confirmar.";
    if (selectedAnswer && correctAnswer && confirmed) {
      feedbackClass += selectedAnswer === correctAnswer ? " correct" : " incorrect";
      feedbackText = selectedAnswer === correctAnswer
        ? "✓ Você acertou! A resposta correta é " + correctAnswer + "."
        : "✕ Você errou. Você marcou " + selectedAnswer + "; a resposta correta é " + correctAnswer + ".";
    } else if (selectedAnswer && confirmed) {
      feedbackClass += " unavailable";
      feedbackText = "Resposta marcada, mas o gabarito desta questão não foi extraído.";
    } else if (selectedAnswer) {
      feedbackText = "Alternativa " + selectedAnswer + " selecionada. Clique em Responder para confirmar.";
    }
    document.getElementById("question").innerHTML = '<div class="meta">' + meta + '</div><div class="statement">' + body + "</div><div>" + alternatives + '</div><div class="answer-row"><button id="respond"' + (selectedAnswer && !confirmed ? "" : " disabled") + '>Responder</button><div id="feedback" class="' + feedbackClass + '">' + escapeValue(feedbackText) + '</div></div><div class="hint">Clique para selecionar uma alternativa e depois em Responder para confirmar. Dê duplo clique para esmaecer (descartar) ou restaurar uma alternativa.</div>';
    document.getElementById("status").textContent = "Questão " + (index + 1) + " de " + visible.length;
    Array.from(document.querySelectorAll(".option")).forEach(function (button) {
      var clickTimer = null;
      button.addEventListener("click", function () {
        if (clickTimer) clearTimeout(clickTimer);
        clickTimer = setTimeout(function () {
          attempt.answers[question.id] = button.dataset.letter;
          if (attempt.confirmed && attempt.confirmed[question.id] !== button.dataset.letter) delete attempt.confirmed[question.id];
          write();
          render();
        }, 220);
      });
      button.addEventListener("dblclick", function (event) { event.preventDefault(); if (clickTimer) clearTimeout(clickTimer); attempt.eliminated[question.id] = attempt.eliminated[question.id] || {}; if (attempt.eliminated[question.id][button.dataset.letter]) delete attempt.eliminated[question.id][button.dataset.letter]; else attempt.eliminated[question.id][button.dataset.letter] = true; write(); render(); });
    });
    var respond = document.getElementById("respond");
    if (respond) respond.addEventListener("click", function () {
      attempt.confirmed = attempt.confirmed || {};
      attempt.confirmed[question.id] = true;
      write();
      render();
    });
  }
  function resetIndex() { index = 0; render(); }
  function fillFilters() {
    Array.from(new Set(data.questions.map(function (question) { return question.bank; }).filter(Boolean))).sort().forEach(function (value) { document.getElementById("bank").insertAdjacentHTML("beforeend", "<option>" + escapeValue(value) + "</option>"); });
    Array.from(new Set(data.questions.map(function (question) { return question.year; }).filter(Boolean))).sort(function (left, right) { return right - left; }).forEach(function (value) { document.getElementById("year").insertAdjacentHTML("beforeend", "<option>" + escapeValue(value) + "</option>"); });
    Array.from(new Set(data.questions.map(function (question) { return question.vacancy; }).filter(Boolean))).sort().forEach(function (value) { document.getElementById("vacancy").insertAdjacentHTML("beforeend", "<option>" + escapeValue(value) + "</option>"); });
  }
  function ensureVacancyControl() {
    var existing = document.getElementById("vacancy");
    if (existing) return existing;
    var year = document.getElementById("year");
    var controls = year && year.parentElement && year.parentElement.parentElement;
    if (!controls) return null;
    var label = document.createElement("label");
    label.textContent = "Vaga ";
    var select = document.createElement("select");
    select.id = "vacancy";
    select.innerHTML = '<option value="">Todas</option>';
    label.appendChild(select);
    controls.appendChild(label);
    return select;
  }
  state = read();
  ensureVacancyControl();
  document.getElementById("prev").onclick = function () { index = Math.max(0, index - 1); render(); };
  document.getElementById("next").onclick = function () { index = Math.min(visibleQuestions().length - 1, index + 1); render(); };
  document.getElementById("go").onclick = function () { var number = Number(document.getElementById("jump").value); if (number > 0) { index = Math.min(visibleQuestions().length - 1, number - 1); render(); } };
  document.getElementById("bank").onchange = resetIndex;
  document.getElementById("year").onchange = resetIndex;
  document.getElementById("vacancy").onchange = resetIndex;
  document.getElementById("newAttempt").onclick = function () { state.attempts.push({ id: "tentativa-" + (state.attempts.length + 1), createdAt: new Date().toISOString(), answers: {}, eliminated: {} }); state.activeAttempt = state.attempts.length - 1; write(); render(); };
  document.getElementById("saveHtml").onclick = function () { write(); var blob = new Blob([document.documentElement.outerHTML], { type: "text/html;charset=utf-8" }); var url = URL.createObjectURL(blob); var anchor = document.createElement("a"); anchor.href = url; anchor.download = downloadName; anchor.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000); };
  fillFilters();
  render();
})();`;
        return [
            '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>', escapeHtml(entry.title || 'Caderno'),
            '</title><style>body{margin:0;background:#f3f4f6;color:#182230;font:16px system-ui,-apple-system,Segoe UI,sans-serif}.top{position:sticky;top:0;z-index:2;background:#102a43;color:#fff;padding:14px 20px;box-shadow:0 2px 8px #0003}.top h1{font-size:18px;margin:0 0 7px}.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.controls button,.controls input,.controls select{border:1px solid #aab8c8;border-radius:7px;padding:7px 9px;font:inherit}.controls button{background:#fff;color:#102a43;cursor:pointer;font-weight:700}.summary{font-size:13px;opacity:.9}.main{max-width:900px;margin:24px auto;padding:0 16px}.card{background:#fff;border-radius:12px;box-shadow:0 3px 14px #0b1f3317;padding:22px}.meta{display:flex;gap:6px;flex-wrap:wrap;color:#52606d;font-size:14px;margin-bottom:14px}.tag{background:#e6f6ff;color:#075985;padding:4px 7px;border-radius:999px}.statement{line-height:1.6}.option{display:block;width:100%;text-align:left;margin:10px 0;padding:12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer;font:inherit;transition:background .2s ease,border-color .2s ease,opacity .3s ease,filter .3s ease}.option:hover{border-color:#2563eb}.option.selected{border:2px solid #2563eb;background:#eff6ff}.option.eliminated{opacity:.3;filter:grayscale(.8);background:#f1f5f9}.answer-row{display:flex;align-items:center;gap:12px;margin-top:14px}.answer-row #feedback{margin:0;flex:1}#respond{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:11px 18px;font:700 14px system-ui;cursor:pointer;white-space:nowrap}#respond:hover:not(:disabled){background:#1d4ed8}#respond:disabled{background:#9ca3af;cursor:not-allowed}.hint{margin-top:12px;color:#64748b;font-size:13px}.status{margin-left:auto;font-size:13px}.empty{padding:30px;text-align:center;color:#64748b}</style></head><body><header class="top"><h1 id="title"></h1><div class="controls"><button id="prev">← Anterior</button><button id="next">Próxima →</button><label>Ir para <input id="jump" type="number" min="1" style="width:78px"></label><button id="go">Ir</button><label>Banca <select id="bank"><option value="">Todas</option></select></label><label>Ano <select id="year"><option value="">Todos</option></select></label><button id="newAttempt">Nova tentativa</button><button id="saveHtml">Baixar HTML com histórico</button><span class="status" id="status"></span></div><div class="summary" id="summary"></div></header><main class="main"><article class="card" id="question"></article></main><script id="tec-caderno-data" type="application/json">', jsJson(data), '</script><script id="tec-caderno-state" type="application/json">', jsJson(initial), '</script><script>', runtime, '</script></body></html>'
        ].join('');
    }

    /* ---- XLSX (réplica fiel do projeto, com imagens embutidas) ---- */
    function xmlEscape(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
        });
    }
    function columnName(index) {
        var value = index + 1, output = '';
        while (value > 0) { var r = (value - 1) % 26; output = String.fromCharCode(65 + r) + output; value = Math.floor((value - 1) / 26); }
        return output;
    }
    function crc32(bytes) {
        var table = crc32.table || (crc32.table = Array.from({ length: 256 }, function (_, i) {
            var v = i;
            for (var b = 0; b < 8; b += 1) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
            return v >>> 0;
        }));
        var crc = 0 ^ -1;
        for (var i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
        return (crc ^ -1) >>> 0;
    }
    function writeU16(view, offset, value) {
        view[offset] = value & 255;
        view[offset + 1] = (value >>> 8) & 255;
    }
    function writeU32(view, offset, value) {
        view[offset] = value & 255;
        view[offset + 1] = (value >>> 8) & 255;
        view[offset + 2] = (value >>> 16) & 255;
        view[offset + 3] = (value >>> 24) & 255;
    }
    function zipStore(files) {
        // ZIP sem compressão (método 0, "stored") — mesma estrutura do original:
        // cabeçalho local (30 bytes) + nome + conteúdo; diretório central (46
        // bytes) + nome; EOCD (22 bytes). Aloca um único Uint8Array do tamanho
        // exato e escreve por posição — sem Array.from(...).flat(), sem
        // concatenação O(n²) de arrays de números.
        var encoder = new TextEncoder();
        var names = [], contents = [], crcs = [], offsets = [];
        var localSize = 0, directorySize = 0;
        for (var i = 0; i < files.length; i += 1) {
            var file = files[i];
            var name = encoder.encode(file.name);
            var content = typeof file.content === 'string' ? encoder.encode(file.content) : new Uint8Array(file.content);
            var crc = crc32(content);
            names.push(name);
            contents.push(content);
            crcs.push(crc);
            offsets.push(localSize);
            localSize += 30 + name.length + content.length;
            directorySize += 46 + name.length;
        }
        var output = new Uint8Array(localSize + directorySize + 22);
        var write = 0;
        for (i = 0; i < files.length; i += 1) {
            name = names[i]; content = contents[i]; crc = crcs[i];
            writeU32(output, write, 0x04034B50); write += 4;   // assinatura do cabeçalho local
            writeU16(output, write, 20); write += 2;           // versão necessária
            writeU16(output, write, 0); write += 2;            // flags
            writeU16(output, write, 0); write += 2;            // método (stored)
            writeU16(output, write, 0); write += 2;            // hora de modificação
            writeU16(output, write, 0); write += 2;            // data de modificação
            writeU32(output, write, crc); write += 4;          // crc32
            writeU32(output, write, content.length); write += 4; // tamanho comprimido
            writeU32(output, write, content.length); write += 4; // tamanho original
            writeU16(output, write, name.length); write += 2;  // tamanho do nome
            writeU16(output, write, 0); write += 2;            // tamanho do extra
            output.set(name, write); write += name.length;
            output.set(content, write); write += content.length;
        }
        for (i = 0; i < files.length; i += 1) {
            name = names[i]; crc = crcs[i];
            writeU32(output, write, 0x02014B50); write += 4;   // assinatura do diretório central
            writeU16(output, write, 20); write += 2;           // versão criadora
            writeU16(output, write, 20); write += 2;           // versão necessária
            writeU16(output, write, 0); write += 2;            // flags
            writeU16(output, write, 0); write += 2;            // método
            writeU16(output, write, 0); write += 2;            // hora
            writeU16(output, write, 0); write += 2;            // data
            writeU32(output, write, crc); write += 4;          // crc32
            writeU32(output, write, contents[i].length); write += 4; // comprimido
            writeU32(output, write, contents[i].length); write += 4; // original
            writeU16(output, write, name.length); write += 2;  // tamanho do nome
            writeU16(output, write, 0); write += 2;            // extra
            writeU16(output, write, 0); write += 2;            // comentário
            writeU16(output, write, 0); write += 2;            // disco inicial
            writeU16(output, write, 0); write += 2;            // atributos internos
            writeU32(output, write, 0); write += 4;            // atributos externos
            writeU32(output, write, offsets[i]); write += 4;   // offset do cabeçalho local
            output.set(name, write); write += name.length;
        }
        writeU32(output, write, 0x06054B50); write += 4;       // assinatura EOCD
        writeU16(output, write, 0); write += 2;                // disco atual
        writeU16(output, write, 0); write += 2;                // disco do diretório
        writeU16(output, write, files.length); write += 2;     // entradas neste disco
        writeU16(output, write, files.length); write += 2;     // total de entradas
        writeU32(output, write, directorySize); write += 4;    // tamanho do diretório central
        writeU32(output, write, localSize); write += 4;        // offset do diretório central
        writeU16(output, write, 0); write += 2;                // tamanho do comentário
        return output;
    }
    function imageSourcesFromHtml(value) {
        var sources = [], pattern = /<img\b[^>]*\b(?:src|data-src)\s*=\s*(["'])(.*?)\1/gi, m;
        while ((m = pattern.exec(String(value == null ? '' : value)))) {
            var s = String(m[2] || '').trim();
            if (s && sources.indexOf(s) < 0) sources.push(s);
        }
        return sources;
    }
    function questionImageSources(question) {
        var sources = imageSourcesFromHtml(question && question.statementHtml);
        (question && question.options || []).forEach(function (option) {
            imageSourcesFromHtml(option && option.html).forEach(function (s) { if (sources.indexOf(s) < 0) sources.push(s); });
        });
        return sources;
    }
    var MAX_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024;
    function decodeBase64(value) {
        try {
            var binary = atob(String(value || '').replace(/\s/g, ''));
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            return bytes;
        } catch (_) { return null; }
    }
    function imageFormat(bytes, mime) {
        var type = String(mime || '').split(';', 1)[0].toLowerCase();
        if (bytes && bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return { extension: 'png', mime: 'image/png' };
        if (bytes && bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return { extension: 'jpg', mime: 'image/jpeg' };
        if (bytes && bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { extension: 'gif', mime: 'image/gif' };
        if (type === 'image/jpg') type = 'image/jpeg';
        if (type === 'image/png') return { extension: 'png', mime: type };
        if (type === 'image/jpeg') return { extension: 'jpg', mime: type };
        if (type === 'image/gif') return { extension: 'gif', mime: type };
        return null;
    }
    var IMAGE_LOAD_CONCURRENCY = 3;
    var imageCache = new Map();
    function clearImageCache() { imageCache.clear(); }
    async function fetchImageAsset(raw) {
        var bytes = null, mime = '';
        var dataMatch = raw.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
        if (dataMatch) {
            mime = dataMatch[1];
            bytes = dataMatch[2] ? decodeBase64(dataMatch[3]) : null;
        } else if (/^https?:/i.test(raw) && typeof fetch === 'function') {
            try {
                var response = await fetch(raw, { credentials: 'include' });
                if (!response || !response.ok) return null;
                mime = response.headers.get('content-type') || '';
                bytes = new Uint8Array(await response.arrayBuffer());
            } catch (_) { return null; }
        }
        if (!bytes || !bytes.length || bytes.length > MAX_EMBEDDED_IMAGE_BYTES) return null;
        var format = imageFormat(bytes, mime);
        return format ? { source: raw, bytes: bytes, extension: format.extension, mime: format.mime } : null;
    }
    function readImageAsset(source) {
        // Cache por URL: cada fonte é resolvida no máximo uma vez por sessão
        // (a promessa em si fica em cache, inclusive falhas/URLs quebradas,
        // evitando refetch). Mantém a API original: retorna Promise<asset|null>.
        var raw = String(source || '').trim();
        if (!raw) return null;
        if (imageCache.has(raw)) return imageCache.get(raw);
        var promise = fetchImageAsset(raw);
        imageCache.set(raw, promise);
        return promise;
    }
    function mapWithConcurrency(items, limit, worker) {
        // Executa worker(item, index) com no máximo `limit` promessas em voo;
        // resolve com os resultados na ordem de entrada. O limite é mantido
        // pelo contador `running` dentro de pump(); erro derruba a cadeia.
        return new Promise(function (resolve, reject) {
            var results = new Array(items.length);
            var next = 0, running = 0, settled = false;
            function fail(error) { if (!settled) { settled = true; reject(error); } }
            function finish() { if (!settled) { settled = true; resolve(results); } }
            function pump() {
                while (!settled && running < limit && next < items.length) {
                    (function (index) {
                        next += 1;
                        running += 1;
                        Promise.resolve().then(function () {
                            return worker(items[index], index);
                        }).then(function (result) {
                            results[index] = result;
                        }, fail).then(function () {
                            running -= 1;
                            if (!settled) {
                                if (next < items.length) pump();
                                else if (running === 0) finish();
                            }
                        });
                    })(next);
                }
                if (!settled && next >= items.length && running === 0) finish();
            }
            pump();
        });
    }
    async function loadImageAssets(questionImages, options) {
        // Concorrência limitada (padrão IMAGE_LOAD_CONCURRENCY = 3; override
        // via options.limit) + cache por URL. mediaIndex segue a ordem da
        // primeira ocorrência de cada fonte — a mesma do carregamento
        // sequencial anterior, então a planilha e os desenhos não mudam.
        var limit = options && typeof options.limit === 'number' ? options.limit : IMAGE_LOAD_CONCURRENCY;
        var sources = [];
        (questionImages || []).forEach(function (list) {
            (list || []).forEach(function (source) {
                if (sources.indexOf(source) < 0) sources.push(source);
            });
        });
        var loaded = await mapWithConcurrency(sources, limit, readImageAsset);
        var assets = new Map(), embedded = [];
        sources.forEach(function (source, index) {
            var asset = loaded[index];
            if (asset) {
                asset.mediaIndex = embedded.length + 1;
                embedded.push(asset);
                assets.set(source, asset);
            }
        });
        return { assets: assets, embedded: embedded };
    }
    function drawingXml(drawingImages) {
        var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
        drawingImages.forEach(function (image, index) {
            xml += '<xdr:oneCellAnchor><xdr:from><xdr:col>' + image.column + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + image.row + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="5000000" cy="2500000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (index + 1) + '" name="Imagem ' + (index + 1) + '"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId' + (index + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
        });
        return xml + '</xdr:wsDr>';
    }
    function drawingRelationshipsXml(drawingImages) {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + drawingImages.map(function (image, index) {
            return '<Relationship Id="rId' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + image.asset.mediaIndex + '.' + image.asset.extension + '"/>';
        }).join('') + '</Relationships>';
    }
    async function buildXlsxBlob(entry, options) {
        var config = options || {};
        var questionImages = (entry.questions || []).map(questionImageSources);
        var loadedImages = await loadImageAssets(questionImages);
        var imageCount = questionImages.reduce(function (m, s) { return Math.max(m, s.length); }, 0);
        var headers = ['Número', 'Caderno', 'Código', 'Banca', 'Ano', 'Vaga', 'Órgão', 'Cargo', 'Matéria', 'Assunto', 'Questão ID', 'URL', 'Enunciado', 'Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 'Alternativa E', 'Gabarito'];
        for (var i = 0; i < imageCount; i += 1) headers.push('Imagem ' + (i + 1));
        var rows = [headers];
        (entry.questions || []).forEach(function (question, index) {
            var alternatives = {};
            (question.options || []).forEach(function (o) { alternatives[o.letter] = o.text; });
            var tituloLinha = (config.porQuestao && question.cadernoTitulo) ? question.cadernoTitulo : entry.title;
            var codigoLinha = (config.porQuestao && question.cadernoId) ? question.cadernoId : entry.code;
            var row = [question.number || index + 1, tituloLinha, codigoLinha, question.bank, question.year, question.vacancy, question.organization, question.role, question.subject, question.topic, question.id, question.url, question.statement, alternatives.A, alternatives.B, alternatives.C, alternatives.D, alternatives.E, question.answer || question.gabarito];
            (questionImages[index] || []).forEach(function (source) {
                row.push(loadedImages.assets.has(source) ? '[imagem incorporada]' : source);
            });
            while (row.length < headers.length) row.push('');
            rows.push(row);
        });
        var worksheet = rows.map(function (row, rowIndex) {
            var cells = row.map(function (value, columnIndex) {
                var reference = columnName(columnIndex) + (rowIndex + 1);
                return '<c r="' + reference + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>';
            }).join('');
            return '<row r="' + (rowIndex + 1) + '">' + cells + '</row>';
        }).join('');
        var lastCell = columnName(rows[0].length - 1) + rows.length;
        var drawingImages = [];
        questionImages.forEach(function (sources, questionIndex) {
            sources.forEach(function (source, imageIndex) {
                var asset = loadedImages.assets.get(source);
                if (asset) drawingImages.push({ asset: asset, column: 19 + imageIndex * 2, row: questionIndex + 1 });
            });
        });
        var hasImages = drawingImages.length > 0;
        var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>';
        if (hasImages) {
            var contentTypeByExtension = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' };
            Array.from(new Set(loadedImages.embedded.map(function (im) { return im.extension; }))).forEach(function (ext) {
                contentTypes += '<Default Extension="' + ext + '" ContentType="' + contentTypeByExtension[ext] + '"/>';
            });
            contentTypes += '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
        }
        contentTypes += '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
        var worksheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' + (hasImages ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' : '') + '><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>' + worksheet + '</sheetData><autoFilter ref="A1:' + lastCell + '"/>' + (hasImages ? '<drawing r="rId1"/>' : '') + '</worksheet>';
        var files = [
            { name: '[Content_Types].xml', content: contentTypes },
            { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
            { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Questões" sheetId="1" r:id="rId1"/></sheets></workbook>' },
            { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
            { name: 'xl/worksheets/sheet1.xml', content: worksheetXml }
        ];
        if (hasImages) {
            files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>' });
            files.push({ name: 'xl/drawings/drawing1.xml', content: drawingXml(drawingImages) });
            files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', content: drawingRelationshipsXml(drawingImages) });
            loadedImages.embedded.forEach(function (im) { files.push({ name: 'xl/media/image' + im.mediaIndex + '.' + im.extension, content: im.bytes }); });
        }
        return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    function baixarHtmlCaderno(caderno) {
        var entry = entradaBiblioteca(caderno);
        var nome = safeFilename(entry.title || entry.code) + '-interativo.html';
        baixarBlob(nome, new Blob([buildInteractiveHtml(entry)], { type: 'text/html;charset=utf-8' }));
        log('HTML baixado: ' + nome);
    }

    async function baixarExcelCaderno(caderno) {
        var entry = entradaBiblioteca(caderno);
        var nome = safeFilename(entry.title || entry.code) + '.xlsx';
        UI.setStatus('Gerando Excel de "' + entry.title + '"...');
        var blob = await buildXlsxBlob(entry);
        baixarBlob(nome, blob);
        UI.setStatus('Excel baixado: ' + nome);
        log('Excel baixado: ' + nome);
    }

    function baixarJsonCaderno(caderno) {
        var nome = safeFilename(caderno.titulo || caderno.id) + '.json';
        baixarBlob(nome, new Blob([JSON.stringify(entradaBiblioteca(caderno), null, 2)], { type: 'application/json;charset=utf-8' }));
        log('JSON baixado: ' + nome);
    }

    /* ---- Categorias: agrupamento e exportação em pacote (ZIP) ---- */
    function categoriaDe(caderno) {
        return caderno && caderno.categoria ? caderno.categoria : 'Plano';
    }

    function cadernosPorCategoria() {
        var mapa = {};
        Object.keys(estado.biblioteca).forEach(function (id) {
            var cad = estado.biblioteca[id];
            var cat = categoriaDe(cad);
            (mapa[cat] = mapa[cat] || []).push(cad);
        });
        return mapa;
    }

    async function exportarCategoria(cat) {
        var lista = cadernosPorCategoria()[cat] || [];
        if (!lista.length) { UI.setStatus('Categoria "' + cat + '" sem cadernos.'); return; }
        UI.setStatus('Gerando pacote da categoria "' + cat + '"...');
        var questoes = [];
        lista.forEach(function (cad) {
            (cad.questoes || []).forEach(function (q) {
                questoes.push(Object.assign({}, q, { cadernoTitulo: cad.titulo, cadernoId: cad.id }));
            });
        });
        var entry = { id: 'categoria-' + cat, code: cat, title: cat, group: cat, questions: questoes };
        var base = safeFilename(cat);
        var files = [];
        files.push({ name: base + '.html', content: buildInteractiveHtml(entry) });
        files.push({ name: base + '.json', content: JSON.stringify(entry, null, 2) });
        var xlsx = await buildXlsxBlob(entry, { porQuestao: true });
        files.push({ name: base + '.xlsx', content: new Uint8Array(await xlsx.arrayBuffer()) });
        // HTMLs individuais de cada caderno da categoria
        lista.forEach(function (cad, i) {
            var e2 = entradaBiblioteca(cad);
            files.push({ name: String(i + 1).padStart(2, '0') + ' - ' + safeFilename(cad.titulo) + '.html', content: buildInteractiveHtml(e2) });
        });
        var zip = zipStore(files);
        baixarBlob(base + '.zip', new Blob([zip], { type: 'application/zip' }));
        UI.setStatus('Pacote "' + cat + '" baixado (' + questoes.length + ' questões em ' + files.length + ' arquivos).');
        log('Categoria "' + cat + '" exportada: ' + files.length + ' arquivos, ' + questoes.length + ' questões.');
    }

    var __TecFabricaExport = {
        buildInteractiveHtml: buildInteractiveHtml,
        buildXlsxBlob: buildXlsxBlob,
        zipStore: zipStore,
        crc32: crc32,
        mapWithConcurrency: mapWithConcurrency,
        readImageAsset: readImageAsset,
        fetchImageAsset: fetchImageAsset,
        loadImageAssets: loadImageAssets,
        clearImageCache: clearImageCache,
        imageFormat: imageFormat,
        decodeBase64: decodeBase64,
        imageSourcesFromHtml: imageSourcesFromHtml,
        questionImageSources: questionImageSources,
        columnName: columnName,
        xmlEscape: xmlEscape,
        escapeHtml: escapeHtml,
        jsJson: jsJson,
        safeFilename: safeFilename,
        baixarBlob: baixarBlob,
        baixarHtmlCaderno: baixarHtmlCaderno,
        baixarExcelCaderno: baixarExcelCaderno,
        baixarJsonCaderno: baixarJsonCaderno,
        entradaBiblioteca: entradaBiblioteca,
        exportarCategoria: exportarCategoria,
        cadernosPorCategoria: cadernosPorCategoria,
        extrairQuestoesImpressas: extrairQuestoesImpressas,
        parseGabaritoBloco: parseGabaritoBloco
    };
    // Exposição testável: no navegador (bundle) via window; em Node via
    // module.exports (require direto do fragmento). Dentro do bundle o
    // `window` existe e `module` não — o guard não altera o comportamento.
    if (typeof window !== 'undefined') {
        window.__TecFabricaExport = __TecFabricaExport;
    } else if (typeof module !== 'undefined' && module.exports) {
        module.exports = __TecFabricaExport;
    }

    /* =====================================================================
     * UI — painel "Fábrica de Cadernos" (dark, consistente com o projeto)
     * =================================================================== */
    var UI = {
        appendLog: function (msg) { },
        setStatus: function (msg) { },
        renderBiblioteca: function () { },
        renderProgresso: function () { },
        carregarPlano: function (texto) { },
        config: function () { return {}; }
    };

    var painelEl = null;
    var abaAtiva = 'plano';

    var UI_CSS = [
        '#tec-fabrica{position:fixed;top:70px;right:14px;z-index:999999;width:400px;max-height:88vh;display:flex;flex-direction:column;',
        'background:#0b1120;color:#e5e7eb;border:1px solid #1e293b;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.55);',
        'font:13px/1.5 system-ui,sans-serif;user-select:none;overflow:hidden}',
        '#tec-fabrica *{box-sizing:border-box}',
        '#tec-fabrica .tf-header{display:flex;align-items:center;gap:8px;padding:11px 14px;background:#111827;border-bottom:1px solid #1f2937}',
        '#tec-fabrica .tf-logo{width:9px;height:9px;border-radius:50%;background:#22c55e;flex:none}',
        '#tec-fabrica .tf-logo.rodando{background:#f59e0b;animation:tf-pulse 1.2s infinite}',
        '#tec-fabrica .tf-logo.erro{background:#ef4444}',
        '#tec-fabrica .tf-logo.completo{background:#3b82f6}',
        '@keyframes tf-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
        '#tec-fabrica .tf-titulo{font-weight:700;font-size:13px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#tec-fabrica .tf-status-txt{font-size:11px;color:#94a3b8;white-space:nowrap}',
        '#tec-fabrica .tf-collapse{background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;padding:0 2px}',
        '#tec-fabrica .tf-collapse:hover{color:#e2e8f0}',
        '#tec-fabrica .tf-abas{display:flex;gap:2px;padding:6px 8px 0;background:#0f172a;border-bottom:1px solid #1f2937}',
        '#tec-fabrica .tf-aba{flex:1;text-align:center;padding:6px 4px;border:none;background:none;color:#94a3b8;cursor:pointer;font-size:11.5px;border-radius:7px 7px 0 0;border-bottom:2px solid transparent}',
        '#tec-fabrica .tf-aba:hover{color:#e2e8f0}',
        '#tec-fabrica .tf-aba.ativa{color:#60a5fa;border-bottom-color:#3b82f6;background:#111827}',
        '#tec-fabrica .tf-corpo{flex:1;overflow-y:auto;padding:12px}',
        '#tec-fabrica .tf-secao-titulo{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:10px 0 6px}',
        '#tec-fabrica .tf-secao-titulo:first-child{margin-top:0}',
        '#tec-fabrica textarea{width:100%;min-height:110px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px;font:12px/1.45 ui-monospace,Consolas,monospace;resize:vertical}',
        '#tec-fabrica textarea:focus{outline:none;border-color:#3b82f6}',
        '#tec-fabrica input[type=text],#tec-fabrica input[type=number]{background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:7px;padding:6px 8px;font:12px system-ui;width:100%}',
        '#tec-fabrica input:focus{outline:none;border-color:#3b82f6}',
        '#tec-fabrica .tf-btn{background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 12px;font:700 12px system-ui;cursor:pointer}',
        '#tec-fabrica .tf-btn:hover{background:#1d4ed8}',
        '#tec-fabrica .tf-btn.sec{background:#1f2937;color:#e2e8f0}',
        '#tec-fabrica .tf-btn.sec:hover{background:#374151}',
        '#tec-fabrica .tf-btn.perigo{background:#dc2626}',
        '#tec-fabrica .tf-btn.perigo:hover{background:#b91c1c}',
        '#tec-fabrica .tf-btn:disabled{opacity:.5;cursor:not-allowed}',
        '#tec-fabrica .tf-linha{display:flex;gap:8px;align-items:center;margin:6px 0}',
        '#tec-fabrica .tf-linha label{font-size:11.5px;color:#cbd5e1;flex:none}',
        '#tec-fabrica .tf-linha input[type=checkbox]{accent-color:#3b82f6}',
        '#tec-fabrica .tf-resumo{background:#111827;border:1px solid #1f2937;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#cbd5e1;margin:8px 0}',
        '#tec-fabrica .tf-resumo b{color:#e2e8f0}',
        '#tec-fabrica .tf-bar{height:8px;background:#1f2937;border-radius:99px;overflow:hidden;margin:4px 0 2px}',
        '#tec-fabrica .tf-bar > div{height:100%;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:99px;transition:width .3s ease}',
        '#tec-fabrica .tf-bar-label{font-size:10.5px;color:#94a3b8;display:flex;justify-content:space-between}',
        '#tec-fabrica .tf-status-msg{background:#111827;border:1px solid #1f2937;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#e2e8f0;margin:8px 0}',
        '#tec-fabrica .tf-status-msg.erro{border-color:#7f1d1d;background:#1c1017;color:#fca5a5}',
        '#tec-fabrica .tf-caderno{background:#111827;border:1px solid #1f2937;border-radius:9px;padding:9px 11px;margin-bottom:8px}',
        '#tec-fabrica .tf-cat{margin-bottom:14px}',
        '#tec-fabrica .tf-cat-titulo{font-weight:700;font-size:12.5px;color:#f8fafc;padding:7px 10px;background:#172554;border:1px solid #1e3a8a;border-radius:8px;margin-bottom:6px}',
        '#tec-fabrica .tf-cat-meta{font-weight:400;font-size:10.5px;color:#93c5fd;margin-left:6px}',
        '#tec-fabrica .tf-caderno .tf-c-titulo{font-weight:600;font-size:12px;color:#f1f5f9;margin-bottom:2px}',
        '#tec-fabrica .tf-caderno .tf-c-meta{font-size:10.5px;color:#94a3b8;margin-bottom:6px}',
        '#tec-fabrica .tf-caderno .tf-c-botoes{display:flex;gap:5px;flex-wrap:wrap}',
        '#tec-fabrica .tf-caderno .tf-btn{font-size:10.5px;padding:4px 8px;border-radius:6px}',
        '#tec-fabrica .tf-log{font:10.5px/1.5 ui-monospace,Consolas,monospace;color:#94a3b8;background:#0f172a;border:1px solid #1f2937;border-radius:8px;padding:8px;height:210px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}',
        '#tec-fabrica .tf-log .ok{color:#4ade80}',
        '#tec-fabrica .tf-log .warn{color:#fbbf24}',
        '#tec-fabrica .tf-log .err{color:#f87171}',
        '#tec-fabrica ::-webkit-scrollbar{width:8px}',
        '#tec-fabrica ::-webkit-scrollbar-thumb{background:#334155;border-radius:99px}',
        '#tec-fabrica .tf-vazio{color:#64748b;font-size:11.5px;text-align:center;padding:14px 0}'
    ].join('');

    function criarUI() {
        var style = document.createElement('style');
        style.textContent = UI_CSS;
        document.head.appendChild(style);

        painelEl = document.createElement('div');
        painelEl.id = 'tec-fabrica';
        painelEl.innerHTML =
            '<div class="tf-header">' +
            '  <span class="tf-logo" id="tf-logo"></span>' +
            '  <span class="tf-titulo">Fábrica de Cadernos v' + SCRIPT_VERSION + '</span>' +
            '  <span class="tf-status-txt" id="tf-status-txt">parado</span>' +
            '  <button class="tf-collapse" id="tf-collapse" title="Recolher">—</button>' +
            '</div>' +
            '<div class="tf-abas">' +
            '  <button class="tf-aba" data-aba="plano">Plano</button>' +
            '  <button class="tf-aba" data-aba="config">Config</button>' +
            '  <button class="tf-aba" data-aba="exec">Execução</button>' +
            '  <button class="tf-aba" data-aba="biblio">Biblioteca</button>' +
            '  <button class="tf-aba" data-aba="log">Log</button>' +
            '</div>' +
            '<div class="tf-corpo" id="tf-corpo"></div>';
        document.body.appendChild(painelEl);

        painelEl.querySelectorAll('.tf-aba').forEach(function (b) {
            b.addEventListener('click', function () { mostrarAba(b.getAttribute('data-aba')); });
        });
        painelEl.querySelector('#tf-collapse').addEventListener('click', function () {
            var corpo = painelEl.querySelector('#tf-corpo');
            corpo.style.display = corpo.style.display === 'none' ? '' : 'none';
            painelEl.querySelector('#tf-collapse').textContent = corpo.style.display === 'none' ? '+' : '—';
        });

        mostrarAba('plano');
    }

    function mostrarAba(aba) {
        abaAtiva = aba;
        painelEl.querySelectorAll('.tf-aba').forEach(function (b) {
            b.classList.toggle('ativa', b.getAttribute('data-aba') === aba);
        });
        var corpo = painelEl.querySelector('#tf-corpo');
        if (aba === 'plano') corpo.innerHTML = htmlPlano();
        else if (aba === 'config') corpo.innerHTML = htmlConfig();
        else if (aba === 'exec') corpo.innerHTML = htmlExecucao();
        else if (aba === 'biblio') corpo.innerHTML = htmlBiblioteca();
        else if (aba === 'log') corpo.innerHTML = htmlLog();
        ligarEventos(corpo);
    }

    /* ---- aba Plano ---- */
    function htmlPlano() {
        var p = estado.plano;
        var resumo = p ? '<div class="tf-resumo"><b>' + p.matters.length + '</b> matérias · ' + p.banks.length + ' bancas · ' + p.years.length + ' anos · ' +
            (p.removeCancelled ? 'sem anuladas' : '') + (p.removeOutdated ? (p.removeCancelled ? ' e ' : '') + 'sem desatualizadas' : '') + '</div>' : '';
        return '<div class="tf-secao-titulo">Plano de matérias (JSON)</div>' +
            '<textarea id="tf-plano-texto" placeholder=\'Cole aqui o conteúdo do mapeamento_de_materias.json\n\nEx: {"materias": [{"titulo": "Classes de palavras", "materias_tecconcursos": [{"codigo": 12519, "materia": "Língua Portuguesa (Português) > Morfologia > Classes de Palavras"}]}]}\'>' + (p ? '' : '') + '</textarea>' +
            '<div class="tf-linha" style="justify-content:flex-end">' +
            '  <button class="tf-btn" id="tf-carregar">Carregar plano</button>' +
            '</div>' + resumo +
            '<div id="tf-plano-aviso"></div>';
    }

    function htmlConfig() {
        var c = estado.config || {};
        return '<div class="tf-secao-titulo">Pasta de destino</div>' +
            '<div class="tf-linha"><input type="text" id="tf-pasta" placeholder="ID da pasta (ex: 6423024) ou abra a página de filtros dela" value="' + (c.folderId || pastaIdDaUrl()) + '"></div>' +
            '<div class="tf-secao-titulo">Lote e ritmo</div>' +
            '<div class="tf-linha"><label style="width:130px">Matérias por lote</label><input type="number" id="tf-lote" min="1" value="' + (c.batchSize || CONFIG.batchSize) + '"></div>' +
            '<div class="tf-linha"><label style="width:130px">Pausa entre ações (s)</label><input type="text" id="tf-delay" value="' + (c.delayMin || CONFIG.delayMin) / 1000 + '-' + (c.delayMax || CONFIG.delayMax) / 1000 + '" placeholder="3-6"></div>' +
            '<div class="tf-secao-titulo">Opções</div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-coletar" ' + ((c.coletarAposCriar !== false) ? 'checked' : '') + '><label>Copiar questões após criar cada caderno</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-auto" ' + (c.autoContinuarLote ? 'checked' : '') + '><label>Continuar lotes automaticamente</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-anuladas" ' + ((c.removeCancelled !== false) ? 'checked' : '') + '><label>Remover questões anuladas</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-desatualizadas" ' + ((c.removeOutdated !== false) ? 'checked' : '') + '><label>Remover questões desatualizadas</label></div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-clique-gabarito" ' + ((c.usarCliqueGabarito !== false) ? 'checked' : '') + '><label>Clique para obter gabarito (necessário em questões novas)</label></div>' +
            '<div class="tf-secao-titulo">Impressão (saldo diário do site)</div>' +
            '<div class="tf-linha"><input type="checkbox" id="tf-usar-impressao" ' + ((c.usarImpressao !== false) ? 'checked' : '') + '><label>Usar impressão antes do clique</label></div>' +
            '<div class="tf-linha"><label style="width:130px">Teto por dia (questões)</label><input type="number" id="tf-impressao-limite" min="1" value="' + (c.impressaoLimiteDia || CONFIG.impressaoLimiteDia) + '"></div>' +
            '<div class="tf-linha"><label style="width:130px">Usadas hoje</label><span id="tf-impressao-usadas" style="color:#94a3b8;font-size:11.5px">' + (estado.impressao ? estado.impressao.usadas || 0 : 0) + '</span></div>' +
            '<div class="tf-secao-titulo">Bancas (uma por linha)</div>' +
            '<textarea id="tf-bancas" style="min-height:80px">' + (c.banks || CONFIG.banks).join('\n') + '</textarea>' +
            '<div class="tf-secao-titulo">Anos (separados por vírgula)</div>' +
            '<input type="text" id="tf-anos" value="' + (c.years || CONFIG.years).join(', ') + '">' +
            '<div class="tf-linha" style="justify-content:flex-end;margin-top:10px">' +
            '  <button class="tf-btn" id="tf-salvar-config">Salvar configuração</button>' +
            '</div><div id="tf-config-aviso"></div>';
    }

    function htmlExecucao() {
        var p = estado.plano;
        var c = estado.config;
        if (!p) return '<div class="tf-vazio">Carregue o plano na aba Plano.</div>';
        var total = p.matters.length;
        var idx = Math.min(estado.planIndex, total);
        var pct = total ? Math.round(idx / total * 100) : 0;
        var loteFim = estado.loteFim || (c ? Math.min(c.batchSize, total) : total);
        var lotePct = (loteFim - estado.loteInicio) > 0 ? Math.round((idx - estado.loteInicio) / (loteFim - estado.loteInicio) * 100) : 100;
        var materiaAtual = idx < total ? p.matters[idx].title : '—';
        var cad = estado.cadernoAtual;
        var cadPct = 0, cadLabel = '';
        if (cad && cad.total) {
            cadPct = Math.round((cad.coletadas || 0) / cad.total * 100);
            cadLabel = cad.titulo + ' — ' + (cad.coletadas || 0) + '/' + cad.total + ' questões';
        }
        var faseTxt = { 'filtros': 'aplicando filtros', 'criando': 'criando caderno', 'coletando': 'copiando questões', 'nenhuma': '—' }[estado.fase] || estado.fase;
        var msgErro = estado.erro ? '<div class="tf-status-msg erro">' + escapeHtml(estado.erro) + '</div>' : '';
        var msg = estado.mensagem ? '<div class="tf-status-msg">' + escapeHtml(estado.mensagem) + '</div>' : '';
        var rodando = estado.status === 'rodando';
        return '<div class="tf-status-msg" id="tf-msg">' + escapeHtml(faseTxt) + (estado.cadernoAtual ? ' · ' + escapeHtml(estado.cadernoAtual.titulo) : '') + '</div>' + msg + msgErro +
            '<div class="tf-secao-titulo">Progresso do plano</div>' +
            '<div class="tf-bar"><div style="width:' + pct + '%"></div></div>' +
            '<div class="tf-bar-label"><span>' + idx + ' de ' + total + ' matérias</span><span>' + pct + '%</span></div>' +
            '<div class="tf-secao-titulo">Lote atual (matérias ' + (estado.loteInicio + 1) + '–' + loteFim + ')</div>' +
            '<div class="tf-bar"><div style="width:' + Math.max(0, lotePct) + '%"></div></div>' +
            '<div class="tf-bar-label"><span>Atual: ' + escapeHtml(materiaAtual) + '</span><span>' + Math.max(0, lotePct) + '%</span></div>' +
            (cad ? '<div class="tf-secao-titulo">Caderno em andamento</div>' +
                '<div class="tf-bar"><div style="width:' + cadPct + '%"></div></div>' +
                '<div class="tf-bar-label"><span>' + escapeHtml(cadLabel) + '</span><span>' + cadPct + '%</span></div>' : '') +
            '<div class="tf-linha" style="justify-content:center;gap:8px;margin-top:14px">' +
            (rodando
                ? '<button class="tf-btn perigo" id="tf-parar">⏸ Pausar</button>'
                : '<button class="tf-btn" id="tf-iniciar">▶ Iniciar / Continuar</button>') +
            '</div>' +
            '<div id="tf-exec-aviso"></div>';
    }

    function htmlBiblioteca() {
        var cats = cadernosPorCategoria();
        var nomes = Object.keys(cats).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
        if (!nomes.length) return '<div class="tf-vazio">Nenhum caderno criado ainda. Rode o plano ou clique em Copiar dentro de um caderno.</div>';
        return nomes.map(function (cat) {
            var lista = cats[cat];
            var totalQ = lista.reduce(function (s, c) { return s + (c.questoes ? c.questoes.length : 0); }, 0);
            var completos = lista.filter(function (c) { return c.completo; }).length;
            var cards = lista.map(function (b) {
                var n = b.questoes ? b.questoes.length : 0;
                var pct = b.total ? Math.round(n / b.total * 100) : 0;
                return '<div class="tf-caderno">' +
                    '<div class="tf-c-titulo">' + escapeHtml(b.titulo) + '</div>' +
                    '<div class="tf-c-meta">Caderno #' + b.id + ' · ' + n + '/' + (b.total || '?') + ' questões · ' + (b.completo ? 'completo' : (n ? 'em andamento' : 'criado')) + '</div>' +
                    '<div class="tf-bar"><div style="width:' + pct + '%"></div></div>' +
                    '<div class="tf-c-botoes" style="margin-top:6px">' +
                    '  <button class="tf-btn sec" data-acao="copiar" data-id="' + b.id + '">📋 Copiar questões</button>' +
                    '  <button class="tf-btn sec" data-acao="html" data-id="' + b.id + '"' + (n ? '' : ' disabled') + '>HTML</button>' +
                    '  <button class="tf-btn sec" data-acao="excel" data-id="' + b.id + '"' + (n ? '' : ' disabled') + '>Excel</button>' +
                    '  <button class="tf-btn sec" data-acao="json" data-id="' + b.id + '"' + (n ? '' : ' disabled') + '>JSON</button>' +
                    '</div></div>';
            }).join('');
            return '<div class="tf-cat">' +
                '<div class="tf-cat-titulo">' + escapeHtml(cat) +
                ' <span class="tf-cat-meta">' + lista.length + ' cadernos · ' + completos + ' completos · ' + totalQ + ' questões</span></div>' +
                '<div class="tf-linha" style="margin:4px 0 8px">' +
                '  <button class="tf-btn" data-acao="categoria" data-cat="' + escapeHtml(cat) + '"' + (totalQ ? '' : ' disabled') + '>📦 Baixar categoria (ZIP)</button>' +
                '</div>' + cards + '</div>';
        }).join('');
    }

    function htmlLog() {
        return '<div class="tf-log" id="tf-log-box">' + ultimasLinhasLog.join('\n') + '</div>';
    }

    var ultimasLinhasLog = [];
    function anexarLog(msg) {
        var t = new Date().toLocaleTimeString('pt-BR') + ' ' + msg;
        ultimasLinhasLog.push(escapeHtml(t));
        if (ultimasLinhasLog.length > 200) ultimasLinhasLog.shift();
        var box = document.getElementById('tf-log-box');
        if (box) {
            box.innerHTML = ultimasLinhasLog.join('\n');
            box.scrollTop = box.scrollHeight;
        }
    }

    function ligarEventos(corpo) {
        var carregar = corpo.querySelector('#tf-carregar');
        if (carregar) carregar.addEventListener('click', function () {
            var texto = corpo.querySelector('#tf-plano-texto').value;
            var aviso = corpo.querySelector('#tf-plano-aviso');
            try {
                var plano = normalizarPlano(texto);
                estado.plano = plano;
                if (!estado.config) {
                    estado.config = {
                        folderId: pastaIdDaUrl() || '',
                        batchSize: CONFIG.batchSize,
                        delayMin: CONFIG.delayMin,
                        delayMax: CONFIG.delayMax,
                        coletarAposCriar: CONFIG.coletarAposCriar,
                        autoContinuarLote: CONFIG.autoContinuarLote,
                        removeCancelled: CONFIG.removeCancelled,
                        removeOutdated: CONFIG.removeOutdated,
                        banks: CONFIG.banks.slice(),
                        years: CONFIG.years.slice()
                    };
                }
                salvarEstado();
                aviso.innerHTML = '<div class="tf-resumo" style="border-color:#166534;background:#052e16;color:#bbf7d0">Plano carregado: <b>' + plano.matters.length + '</b> matérias</div>';
                log('Plano carregado: ' + plano.matters.length + ' matérias, ' + plano.banks.length + ' bancas, ' + plano.years.length + ' anos.');
            } catch (e) {
                aviso.innerHTML = '<div class="tf-status-msg erro"><b>Erro ao carregar o plano:</b> ' + escapeHtml(e.message) + '</div>';
            }
        });

        var salvar = corpo.querySelector('#tf-salvar-config');
        if (salvar) salvar.addEventListener('click', function () {
            var aviso = corpo.querySelector('#tf-config-aviso');
            try {
                var cfg = estado.config || {};
                cfg.folderId = clean(corpo.querySelector('#tf-pasta').value);
                cfg.batchSize = Math.max(1, parseInt(corpo.querySelector('#tf-lote').value, 10) || CONFIG.batchSize);
                var delayTxt = corpo.querySelector('#tf-delay').value.split('-');
                cfg.delayMin = Math.max(500, parseInt(delayTxt[0], 10) * 1000 || CONFIG.delayMin);
                cfg.delayMax = Math.max(cfg.delayMin, parseInt(delayTxt[1], 10) * 1000 || CONFIG.delayMax);
                cfg.coletarAposCriar = corpo.querySelector('#tf-coletar').checked;
                cfg.autoContinuarLote = corpo.querySelector('#tf-auto').checked;
                cfg.removeCancelled = corpo.querySelector('#tf-anuladas').checked;
                cfg.removeOutdated = corpo.querySelector('#tf-desatualizadas').checked;
                cfg.usarCliqueGabarito = corpo.querySelector('#tf-clique-gabarito').checked;
                cfg.usarImpressao = corpo.querySelector('#tf-usar-impressao').checked;
                cfg.impressaoLimiteDia = Math.max(1, parseInt(corpo.querySelector('#tf-impressao-limite').value, 10) || CONFIG.impressaoLimiteDia);
                cfg.banks = corpo.querySelector('#tf-bancas').value.split('\n').map(clean).filter(Boolean);
                cfg.years = corpo.querySelector('#tf-anos').value.split(',').map(function (y) { return parseInt(y, 10); }).filter(function (y) { return y >= 1900 && y <= 2100; });
                if (cfg.banks.length < 1) throw new Error('Informe ao menos uma banca.');
                if (cfg.years.length < 1) throw new Error('Informe ao menos um ano.');
                CONFIG.delayMin = cfg.delayMin;
                CONFIG.delayMax = cfg.delayMax;
                estado.config = cfg;
                salvarEstado();
                aviso.innerHTML = '<div class="tf-resumo" style="border-color:#166534;background:#052e16;color:#bbf7d0">Configuração salva</div>';
                log('Configuração salva: pasta ' + (cfg.folderId || '(vazio)') + ', lote ' + cfg.batchSize + ', ' + cfg.banks.length + ' bancas, ' + cfg.years.length + ' anos.');
            } catch (e) {
                aviso.innerHTML = '<div class="tf-status-msg erro">' + escapeHtml(e.message) + '</div>';
            }
        });

        var iniciar = corpo.querySelector('#tf-iniciar');
        if (iniciar) iniciar.addEventListener('click', function () { continuar(); });
        var btnParar = corpo.querySelector('#tf-parar');
        if (btnParar) btnParar.addEventListener('click', parar);

        corpo.querySelectorAll('[data-acao]').forEach(function (b) {
            b.addEventListener('click', function () {
                var acao = b.getAttribute('data-acao');
                if (acao === 'categoria') {
                    var cat = b.getAttribute('data-cat');
                    exportarCategoria(cat);
                    return;
                }
                var id = b.getAttribute('data-id');
                var caderno = estado.biblioteca[id];
                if (!caderno) return;
                if (acao === 'copiar') copiarCadernoSobDemanda(caderno);
                else if (acao === 'html') baixarHtmlCaderno(caderno);
                else if (acao === 'excel') baixarExcelCaderno(caderno);
                else if (acao === 'json') baixarJsonCaderno(caderno);
            });
        });
    }

    /* Copiar sob demanda (botão da biblioteca): navega até o caderno e coleta.
       A navegação encerra a execução; o auto-resume retoma pela fase 'coletando'. */
    async function retomarColetaSobDemanda(caderno) {
        if (estado.status !== 'rodando') return;
        if (paginaAtual() !== 'caderno' || cadernoIdDaUrl() !== caderno.id) {
            estado.fase = 'coletando';
            estado.cadernoAtual = caderno;
            estado.mensagem = 'Abrindo caderno ' + caderno.id + '...';
            salvarEstado();
            UI.setStatus(estado.mensagem);
            irPara(location.origin + '/questoes/cadernos/' + caderno.id); // navega → boot retoma
            return;
        }
        estado.cadernoAtual = caderno;
        estado.fase = 'coletando';
        salvarEstado();
        UI.renderProgresso();
        try {
            await coletarCaderno(caderno);
            estado.cadernoAtual = null;
            estado.fase = 'nenhuma';
            estado.status = 'parado';
            salvarEstado();
            UI.renderBiblioteca();
            UI.renderProgresso();
            UI.setStatus('Caderno "' + caderno.titulo + '" copiado (' + caderno.questoes.length + ' questões).');
        } catch (e) {
            estado.status = 'erro';
            estado.erro = String(e && e.message || e);
            estado.fase = 'nenhuma';
            salvarEstado();
            log('ERRO ao copiar: ' + estado.erro);
            UI.renderProgresso();
        }
    }

    async function copiarCadernoSobDemanda(caderno) {
        if (estado.status === 'rodando') { UI.setStatus('Já existe uma execução rodando.'); return; }
        estado.status = 'rodando';
        estado.modo = 'sob-demanda';
        estado.retomada = false;
        estado.erro = null;
        salvarEstado();
        retomarColetaSobDemanda(caderno);
    }

    /* ---- implementação dos hooks da UI ---- */
    UI.appendLog = function (msg) { anexarLog(msg); };
    UI.setStatus = function (msg) {
        estado.mensagem = msg;
        salvarEstado();
        var el = document.getElementById('tf-msg');
        if (el) el.textContent = msg;
    };
    UI.renderProgresso = function () {
        if (!painelEl) return;
        var statusTxt = { 'parado': 'parado', 'rodando': 'rodando', 'pausado': 'pausado', 'completo': 'concluído', 'erro': 'erro' }[estado.status] || estado.status;
        var st = painelEl.querySelector('#tf-status-txt');
        if (st) st.textContent = statusTxt;
        var logo = painelEl.querySelector('#tf-logo');
        if (logo) {
            logo.className = 'tf-logo' + (estado.status === 'rodando' ? ' rodando' : (estado.status === 'erro' ? ' erro' : (estado.status === 'completo' ? ' completo' : '')));
        }
        if (abaAtiva === 'exec') mostrarAba('exec');
    };
    UI.renderBiblioteca = function () {
        if (!painelEl) return;
        if (abaAtiva === 'biblio') mostrarAba('biblio');
    };

    /* =====================================================================
     * INICIALIZAÇÃO
     * =================================================================== */
    // linha distintiva de inicialização: permite conferir no Console qual
    // versão do script está em execução (combina com o título da UI).
    log('SCRIPT_VERSION=' + SCRIPT_VERSION);
    // instala o hook de interceptação o quanto antes (questões carregadas via XHR)
    GabaritoInterceptor.instalar();
    // página de saída da impressão: bloqueia o print nativo automático do site
    bloquearPrintAutomatico();

    function iniciarUI() {
        criarUI();
        if (estado.plano) {
            UI.setStatus(estado.plano.matters.length + ' matérias carregadas' + (estado.status === 'pausado' ? ' — retome de onde parou' : ''));
        } else {
            UI.setStatus('Cole seu plano de matérias (JSON) na aba Plano.');
        }
        UI.renderProgresso();
        UI.renderBiblioteca();
    }

    function autoResumir() {
        if (estado.status !== 'rodando') return;
        setTimeout(function () {
            log('Auto-resume: retomando execução interrompida pela navegação (fase ' + estado.fase + ').');
            if (estado.fase === 'coletando' && estado.cadernoAtual && estado.modo === 'sob-demanda') {
                // coleta sob demanda (botão Copiar) — retoma direto, sem mexer no plano
                retomarColetaSobDemanda(estado.cadernoAtual);
            } else {
                processarLote().catch(function (err) {
                    estado.status = 'erro';
                    estado.erro = String(err && err.message || err);
                    estado.fase = 'nenhuma';
                    salvarEstado();
                    log('ERRO: ' + estado.erro);
                    UI.setStatus('Erro: ' + estado.erro);
                    UI.renderProgresso();
                });
            }
        }, 1500);
    }

    /* Boot: lê o estado do IndexedDB ANTES de criar a UI, renderizar o
     * status e disparar o auto-resume — uma única fonte, sem duplicação. */
    carregarEstado().then(function () {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', iniciarUI);
        } else {
            iniciarUI();
        }
        autoResumir();
    });

    window.__TecFabricaUI = UI;
/* ==== DIAGNÓSTICO INJETADO (início) ==== */
/*
 * Instrumentação de diagnóstico — NUNCA faz parte do build limpo (dist/).
 * Gerada por scripts/diagnostico.mjs; delimitada por marcadores próprios
 * para extração e testes. Conta chamadas feitas APÓS a injeção (fim do
 * boot): timers, Workers, blob URLs, XHR/fetch, IndexedDB, persistência
 * (salvarEstado, salvarEstadoIdb, salvarSnapshot, carregarEstado) e
 * scheduler. Estado, índices e gabarito continuam observáveis via
 * __TecFabricaDiagnostico.observaveis().
 */
var TFD_instalar = function (janela) {
    if (!janela) return null;
    if (janela.__TecFabricaDiagnostico) return janela.__TecFabricaDiagnostico;
    var cont = {
        iniciadoEm: Date.now(),
        timers: { setTimeout: 0, setInterval: 0, clearTimeout: 0, clearInterval: 0, ativosTimeout: 0, ativosInterval: 0 },
        urls: { criadas: 0, revogadas: 0, delta: 0 },
        workers: { criados: 0, terminados: 0, ativos: 0 },
        requests: { xhrOpen: 0, xhrSend: 0, xhrApi: 0, xhrStatus200: 0, xhrErros: 0, fetch: 0, fetchApi: 0 },
        idb: { aberturas: 0, sucesso: 0, erro: 0, transacoes: 0 },
        persistencia: { salvarEstado: 0, salvarEstadoIdb: 0, salvarSnapshot: 0, carregarEstado: 0 },
        scheduler: { sleep: 0, poll: 0, cancelar: 0, limpar: 0 },
        interceptor: { instalado: 0 },
        dominios: {},
        ultimasUrls: [],
        amostras: []
    };
    var ativosTimeout = new Set();
    var ativosInterval = new Set();
    var restauraveis = [];
    var intervaloAmostra = null;

    function registrarUrl(u) {
        var s = String(u || '');
        cont.ultimasUrls.push(s);
        if (cont.ultimasUrls.length > 20) cont.ultimasUrls.shift();
        var m = s.match(/^https?:\/\/([^/]+)/);
        var d = m ? m[1] : '(local)';
        cont.dominios[d] = (cont.dominios[d] || 0) + 1;
        return s;
    }
    function memorizar() {
        var m = null;
        try { m = janela.performance && janela.performance.memory; } catch (e) { m = null; }
        if (!m || typeof m.usedJSHeapSize !== 'number') return null;
        return { usado: m.usedJSHeapSize, total: m.totalJSHeapSize, limite: m.jsHeapSizeLimit };
    }
    function amostrar() {
        cont.amostras.push({
            t: Date.now(),
            memoria: memorizar(),
            timersAtivos: ativosTimeout.size + ativosInterval.size,
            urlsDelta: cont.urls.delta,
            workersAtivos: cont.workers.ativos,
            idbAberturas: cont.idb.aberturas,
            salvarEstado: cont.persistencia.salvarEstado,
            salvarSnapshot: cont.persistencia.salvarSnapshot
        });
        if (cont.amostras.length > 30) cont.amostras.shift();
    }
    function guardar(alvo, prop, valor) {
        if (!alvo) return;
        restauraveis.push({ alvo: alvo, prop: prop, valor: alvo[prop] });
        alvo[prop] = valor;
    }
    function copiar(o) {
        var out = {};
        Object.keys(o || {}).forEach(function (k) { out[k] = o[k]; });
        return out;
    }

    var origSetTimeout = janela.setTimeout;
    var origSetInterval = janela.setInterval;
    var origClearTimeout = janela.clearTimeout;
    var origClearInterval = janela.clearInterval;

    if (typeof origSetTimeout === 'function') {
        guardar(janela, 'setTimeout', function (fn, ms) {
            cont.timers.setTimeout += 1;
            var id = origSetTimeout(typeof fn === 'function' ? function () {
                ativosTimeout.delete(id);
                return fn.apply(janela, arguments);
            } : fn, ms);
            ativosTimeout.add(id);
            cont.timers.ativosTimeout = ativosTimeout.size;
            return id;
        });
    }
    if (typeof origSetInterval === 'function') {
        guardar(janela, 'setInterval', function (fn, ms) {
            cont.timers.setInterval += 1;
            var id = origSetInterval(typeof fn === 'function' ? function () {
                return fn.apply(janela, arguments);
            } : fn, ms);
            ativosInterval.add(id);
            cont.timers.ativosInterval = ativosInterval.size;
            return id;
        });
    }
    if (typeof origClearTimeout === 'function') {
        guardar(janela, 'clearTimeout', function (id) {
            cont.timers.clearTimeout += 1;
            ativosTimeout.delete(id);
            cont.timers.ativosTimeout = ativosTimeout.size;
            return origClearTimeout(id);
        });
    }
    if (typeof origClearInterval === 'function') {
        guardar(janela, 'clearInterval', function (id) {
            cont.timers.clearInterval += 1;
            ativosInterval.delete(id);
            cont.timers.ativosInterval = ativosInterval.size;
            return origClearInterval(id);
        });
    }

    if (janela.URL && typeof janela.URL.createObjectURL === 'function') {
        var origCreate = janela.URL.createObjectURL;
        guardar(janela.URL, 'createObjectURL', function (blob) {
            cont.urls.criadas += 1;
            cont.urls.delta = cont.urls.criadas - cont.urls.revogadas;
            return origCreate.call(janela.URL, blob);
        });
    }
    if (janela.URL && typeof janela.URL.revokeObjectURL === 'function') {
        var origRevoke = janela.URL.revokeObjectURL;
        guardar(janela.URL, 'revokeObjectURL', function (url) {
            cont.urls.revogadas += 1;
            cont.urls.delta = cont.urls.criadas - cont.urls.revogadas;
            return origRevoke.call(janela.URL, url);
        });
    }

    var OrigWorker = janela.Worker;
    if (typeof OrigWorker === 'function') {
        var TFD_WorkerNovo = function (url, opts) {
            cont.workers.criados += 1;
            cont.workers.ativos += 1;
            var w = new OrigWorker(url, opts);
            var origTerminate = w.terminate;
            w.terminate = function () {
                cont.workers.terminados += 1;
                cont.workers.ativos = Math.max(0, cont.workers.ativos - 1);
                return origTerminate.apply(w, arguments);
            };
            return w;
        };
        TFD_WorkerNovo.prototype = OrigWorker.prototype;
        guardar(janela, 'Worker', TFD_WorkerNovo);
    }

    if (janela.XMLHttpRequest && janela.XMLHttpRequest.prototype) {
        var xp = janela.XMLHttpRequest.prototype;
        if (typeof xp.open === 'function') {
            var origXhrOpen = xp.open;
            guardar(xp, 'open', function (method, url) {
                cont.requests.xhrOpen += 1;
                var s = registrarUrl(url);
                if (/\/api\//.test(s)) cont.requests.xhrApi += 1;
                this.__tecFabricaDiagUrl = s;
                return origXhrOpen.apply(this, arguments);
            });
        }
        if (typeof xp.send === 'function') {
            var origXhrSend = xp.send;
            guardar(xp, 'send', function () {
                cont.requests.xhrSend += 1;
                var x = this;
                if (typeof x.addEventListener === 'function') {
                    x.addEventListener('load', function () {
                        if (x.status >= 400) cont.requests.xhrErros += 1;
                        else if (x.status === 200) cont.requests.xhrStatus200 += 1;
                    });
                }
                return origXhrSend.apply(this, arguments);
            });
        }
    }

    if (typeof janela.fetch === 'function') {
        var origFetch = janela.fetch;
        guardar(janela, 'fetch', function (input, init) {
            cont.requests.fetch += 1;
            var s = registrarUrl(typeof input === 'string' ? input : (input && input.url) || '');
            if (/\/api\//.test(s)) cont.requests.fetchApi += 1;
            return origFetch.call(janela, input, init);
        });
    }

    if (janela.IDBFactory && janela.IDBFactory.prototype && typeof janela.IDBFactory.prototype.open === 'function') {
        var origIdbOpen = janela.IDBFactory.prototype.open;
        guardar(janela.IDBFactory.prototype, 'open', function () {
            cont.idb.aberturas += 1;
            var req = origIdbOpen.apply(this, arguments);
            if (req && typeof req.addEventListener === 'function') {
                req.addEventListener('success', function () { cont.idb.sucesso += 1; });
                req.addEventListener('error', function () { cont.idb.erro += 1; });
            }
            return req;
        });
    }
    if (janela.IDBDatabase && janela.IDBDatabase.prototype && typeof janela.IDBDatabase.prototype.transaction === 'function') {
        var origIdbTx = janela.IDBDatabase.prototype.transaction;
        guardar(janela.IDBDatabase.prototype, 'transaction', function () {
            cont.idb.transacoes += 1;
            return origIdbTx.apply(this, arguments);
        });
    }

    if (typeof origSetInterval === 'function') {
        intervaloAmostra = origSetInterval(amostrar, 10000);
    }

    function resumo() {
        return {
            iniciadoEm: cont.iniciadoEm,
            timers: copiar(cont.timers),
            urls: copiar(cont.urls),
            workers: copiar(cont.workers),
            requests: copiar(cont.requests),
            idb: copiar(cont.idb),
            persistencia: copiar(cont.persistencia),
            scheduler: copiar(cont.scheduler),
            interceptor: copiar(cont.interceptor),
            dominios: copiar(cont.dominios),
            ultimasUrls: cont.ultimasUrls.slice(),
            memoria: memorizar(),
            nosDocumento: (janela.document && janela.document.getElementsByTagName)
                ? janela.document.getElementsByTagName('*').length
                : null
        };
    }
    function zerar() {
        Object.keys(cont).forEach(function (k) {
            if (k === 'iniciadoEm' || k === 'ultimasUrls' || k === 'amostras' || k === 'dominios') return;
            var v = cont[k];
            if (v && typeof v === 'object') {
                Object.keys(v).forEach(function (k2) { if (typeof v[k2] === 'number') v[k2] = 0; });
            } else if (typeof v === 'number') {
                cont[k] = 0;
            }
        });
        cont.ultimasUrls.length = 0;
        cont.amostras.length = 0;
        cont.dominios = {};
    }
    function desativar() {
        if (!api.ativo) return;
        if (intervaloAmostra !== null && typeof origClearInterval === 'function') {
            origClearInterval(intervaloAmostra);
            intervaloAmostra = null;
        }
        restauraveis.forEach(function (r) { r.alvo[r.prop] = r.valor; });
        restauraveis.length = 0;
        api.ativo = false;
        cont.restaurado = true;
    }

    var api = {
        ativo: true,
        versao: '1',
        contadores: cont,
        resumo: resumo,
        snapshot: function () {
            amostrar();
            return {
                resumo: resumo(),
                observaveis: api.observaveis(),
                amostras: cont.amostras.slice(-5)
            };
        },
        amostrar: amostrar,
        zerar: zerar,
        desativar: desativar,
        observaveis: function () {
            var out = {};
            if (typeof estado !== 'undefined' && estado) {
                out.estado = {
                    status: estado.status,
                    fase: estado.fase,
                    modo: estado.modo,
                    cadernos: Object.keys(estado.biblioteca || {}).length,
                    atualizadoEm: estado.atualizadoEm
                };
            }
            if (typeof GabaritoInterceptor === 'object' && GabaritoInterceptor) {
                out.gabarito = {
                    instalado: GabaritoInterceptor.instalado === true,
                    cacheQuestoes: Object.keys(GabaritoInterceptor.cache || {}).length,
                    cachePorIndex: Object.keys(GabaritoInterceptor.cachePorIndex || {}).length,
                    estatisticas: copiar(GabaritoInterceptor.estatisticas || {})
                };
            }
            var p = window.__TecFabricaPersistence;
            if (p && p.indices) {
                out.indices = {
                    cadernos: p.indices.cadernosPorId && p.indices.cadernosPorId.size,
                    questoes: p.indices.questoesPorId && p.indices.questoesPorId.size,
                    porCaderno: p.indices.questaoIdsPorCaderno && p.indices.questaoIdsPorCaderno.size
                };
            }
            return out;
        }
    };
    janela.__TecFabricaDiagnostico = api;
    return api;
};
var TFD_api = TFD_instalar(window);
(function (api) {
    if (!api) return;
    var c = api.contadores;
    if (typeof salvarEstado === 'function') {
        var t0 = salvarEstado;
        salvarEstado = function () { c.persistencia.salvarEstado += 1; return t0.apply(null, arguments); };
    }
    if (typeof salvarEstadoIdb === 'function') {
        var t1 = salvarEstadoIdb;
        salvarEstadoIdb = function () { c.persistencia.salvarEstadoIdb += 1; return t1.apply(null, arguments); };
    }
    if (typeof salvarSnapshot === 'function') {
        var t2 = salvarSnapshot;
        salvarSnapshot = function () { c.persistencia.salvarSnapshot += 1; return t2.apply(null, arguments); };
    }
    if (typeof carregarEstado === 'function') {
        var t3 = carregarEstado;
        carregarEstado = function () { c.persistencia.carregarEstado += 1; return t3.apply(null, arguments); };
    }
    if (typeof workerSleep === 'function') {
        var t4 = workerSleep;
        workerSleep = function () { c.scheduler.sleep += 1; return t4.apply(null, arguments); };
    }
    if (typeof workerTick === 'function') {
        var t5 = workerTick;
        workerTick = function () { c.scheduler.poll += 1; return t5.apply(null, arguments); };
    }
    if (typeof Scheduler === 'object' && Scheduler) {
        if (typeof Scheduler.cancelar === 'function') {
            var t6 = Scheduler.cancelar;
            Scheduler.cancelar = function () { c.scheduler.cancelar += 1; return t6.apply(Scheduler, arguments); };
        }
        if (typeof Scheduler.limpar === 'function') {
            var t7 = Scheduler.limpar;
            Scheduler.limpar = function () { c.scheduler.limpar += 1; return t7.apply(Scheduler, arguments); };
        }
    }
    if (typeof GabaritoInterceptor === 'object' && GabaritoInterceptor) {
        c.interceptor.instalado = GabaritoInterceptor.instalado === true ? 1 : 0;
    }
})(TFD_api);
window.__TecFabricaDiagnostico = TFD_api;
/* ==== DIAGNÓSTICO INJETADO (fim) ==== */
})();
