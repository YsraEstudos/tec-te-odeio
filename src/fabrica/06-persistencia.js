    /* =====================================================================
     * PERSISTÊNCIA INDEXEDDB V2
     * ---------------------------------------------------------------------
     * O cache agregado continua sendo a fonte de compatibilidade em memória;
     * o banco guarda metadados, cadernos e questões separadamente.
     * =================================================================== */
    var RE_DATA_IMAGE_B64 = /data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9=.-]+)*;base64,[A-Za-z0-9+/=\s]+/gi;

    // Identificador de instalação: o nome do banco IndexedDB ganha um sufixo
    // aleatório (tec_fabrica_db_<16ch>) para evitar nome estático e colisões.
    // Isto não é controle de acesso: código da mesma origem ainda pode listar
    // bancos e ler localStorage. A semente fica em tec_prefs, com versão.
    function obterIdInstalacao() {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return '';
            var bruto = window.localStorage.getItem('tec_prefs');
            var prefs = null;
            if (bruto) {
                try { prefs = JSON.parse(bruto); } catch (e) { prefs = null; }
            }
            if (prefs && prefs.v === 1 && typeof prefs.i === 'string' && /^[A-Za-z0-9]{16}$/.test(prefs.i)) {
                return prefs.i;
            }
            var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
            var novo = '';
            var aleatorios = null;
            try {
                if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
                    aleatorios = new Uint32Array(16);
                    window.crypto.getRandomValues(aleatorios);
                }
            } catch (e) { aleatorios = null; }
            for (var c = 0; c < 16; c += 1) {
                var sorteio = aleatorios ? aleatorios[c] : Math.floor(Math.random() * 0x100000000);
                novo += chars.charAt(sorteio % chars.length);
            }
            window.localStorage.setItem('tec_prefs', JSON.stringify({ v: 1, i: novo }));
            return novo;
        } catch (e) {
            return '';
        }
    }
    var idInstalacao = obterIdInstalacao();
    var IDB_DB = 'tec_fabrica_db' + (idInstalacao ? '_' + idInstalacao : '');
    var IDB_VERSION = 2;
    var IDB_LEGACY_STORE = 'estado';
    var IDB_META_STORE = 'meta';
    var IDB_CADERNOS_STORE = 'cadernos';
    var IDB_QUESTOES_STORE = 'questoes';
    var IDB_STATE_KEY = 'state';
    var idbPromise = null;
    var saveTimer = null;
    var saveChain = Promise.resolve();
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
            plano: null, planoTexto: '', config: null, status: 'parado', fase: 'nenhuma', modo: 'lote',
            passada: 'criacao',
            planIndex: 0, loteInicio: 0, loteFim: 0, cadernoAtual: null,
            biblioteca: {}, materiasPuladas: {}, logs: [], controleResolucoesDiarias: { data: null, total: 0 },
            cronometriaCriacao: { amostras: [], atual: null },
            reparoCriacao: null, reparoCriacaoConcluido: false,
            mensagem: '', erro: null, retomada: false, atualizadoEm: null
        };
    }

    var estado = estadoVazio();

    function validarEstado(valor) {
        return !!(valor && typeof valor === 'object' && valor.biblioteca &&
            typeof valor.biblioteca === 'object' && !Array.isArray(valor.biblioteca));
    }

    function normalizarEstadoPersistido(valor) {
        if (!valor || typeof valor !== 'object') return valor;
        valor.config = valor.config && typeof valor.config === 'object' ? valor.config : {};
        if (valor.config.modoColeta !== 'sem-gabarito-manual' && valor.config.modoColeta !== 'stealth-offline') {
            valor.config.modoColeta = 'com-gabarito';
        }
        if (valor.config.modoColeta === 'stealth-offline') {
            if (!valor.config.modoOperacao) valor.config.modoOperacao = 'stealth-offline';
            if (!valor.config.perfilStealth) valor.config.perfilStealth = 'ultra-furtivo';
            if (typeof valor.config.stealthWpm !== 'number' || valor.config.stealthWpm < 50) valor.config.stealthWpm = 220;
            if (typeof valor.config.stealthCoffeeBreakAtivo !== 'boolean') valor.config.stealthCoffeeBreakAtivo = true;
        }
        // Mantém a configuração rápida completa mesmo quando o usuário está
        // em outro modo e só depois alterna para stealth-offline.
        if (typeof valor.config.rapidoSemGabaritoAtivo !== 'boolean') valor.config.rapidoSemGabaritoAtivo = true;
        if (!Number.isFinite(Number(valor.config.rapidoDelayMin)) || Number(valor.config.rapidoDelayMin) < 100) valor.config.rapidoDelayMin = 300;
        if (!Number.isFinite(Number(valor.config.rapidoDelayMax)) || Number(valor.config.rapidoDelayMax) < Number(valor.config.rapidoDelayMin)) valor.config.rapidoDelayMax = 800;
        if (!Number.isFinite(Number(valor.config.rapidoPollInterval)) || Number(valor.config.rapidoPollInterval) < 50) valor.config.rapidoPollInterval = 120;
        if (!Number.isFinite(Number(valor.config.rapidoCacheEsperaMs)) || Number(valor.config.rapidoCacheEsperaMs) < 0) valor.config.rapidoCacheEsperaMs = 2000;
        if (typeof valor.config.rapidoCoffeeBreakAtivo !== 'boolean') valor.config.rapidoCoffeeBreakAtivo = true;
        if (!Number.isFinite(Number(valor.config.rapidoCoffeeBreakIntervaloMin)) || Number(valor.config.rapidoCoffeeBreakIntervaloMin) < 1) valor.config.rapidoCoffeeBreakIntervaloMin = 30;
        if (!Number.isFinite(Number(valor.config.rapidoCoffeeBreakIntervaloMax)) || Number(valor.config.rapidoCoffeeBreakIntervaloMax) < Number(valor.config.rapidoCoffeeBreakIntervaloMin)) valor.config.rapidoCoffeeBreakIntervaloMax = 60;
        if (!Number.isFinite(Number(valor.config.rapidoCoffeeBreakDuracaoMedia)) || Number(valor.config.rapidoCoffeeBreakDuracaoMedia) < 0) valor.config.rapidoCoffeeBreakDuracaoMedia = 9000;
        if (typeof valor.config.rapidoPausaAbaOculta !== 'boolean') valor.config.rapidoPausaAbaOculta = true;
        if (valor.config.modoCriacao !== 'criar-tudo') {
            valor.config.modoCriacao = 'padrao';
        }
        if (valor.passada !== 'coleta') {
            valor.passada = 'criacao';
        }
        if (!valor.materiasPuladas || typeof valor.materiasPuladas !== 'object' || Array.isArray(valor.materiasPuladas)) {
            valor.materiasPuladas = {};
        }
        if (typeof valor.reparoCriacaoConcluido !== 'boolean') valor.reparoCriacaoConcluido = false;
        if (!valor.reparoCriacao || typeof valor.reparoCriacao !== 'object' ||
            !Array.isArray(valor.reparoCriacao.indices) || !Number.isFinite(Number(valor.reparoCriacao.posicao))) {
            valor.reparoCriacao = null;
        }
        if (typeof normalizarControleResolucoesDiarias === 'function') {
            normalizarControleResolucoesDiarias(valor);
        }
        if (!valor.cronometriaCriacao || typeof valor.cronometriaCriacao !== 'object') {
            valor.cronometriaCriacao = { amostras: [], atual: null };
        } else {
            if (!Array.isArray(valor.cronometriaCriacao.amostras)) valor.cronometriaCriacao.amostras = [];
            if (valor.cronometriaCriacao.amostras.length > 40) valor.cronometriaCriacao.amostras = valor.cronometriaCriacao.amostras.slice(-40);
            if (valor.cronometriaCriacao.atual && typeof valor.cronometriaCriacao.atual !== 'object') valor.cronometriaCriacao.atual = null;
        }
        if (!Array.isArray(valor.logs)) valor.logs = [];
        if (valor.logs.length > 600) valor.logs = valor.logs.slice(-600);
        valor.logs.forEach(function (item) {
            if (typeof logSequencia !== 'undefined' && item && Number.isFinite(Number(item.id)) && Number(item.id) > logSequencia) logSequencia = Number(item.id);
        });
        return valor;
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
        return validarEstado(agregado) ? normalizarEstadoPersistido(agregado) : null;
    }

    function parseLegadoV1(json) {
        var legado;
        try { legado = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
        return validarEstado(legado) ? normalizarEstadoPersistido(legado) : null;
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
            var cadernoBase = {};
            Object.keys(original).forEach(function (campo) {
                if (campo !== 'questoes') cadernoBase[campo] = original[campo];
            });
            var caderno = sanitizarParaPersistencia(cadernoBase);
            var lista = Array.isArray(original.questoes) ? original.questoes : [];
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

    function prepararSnapshot(valor) {
        valor = typeof valor === 'string' ? JSON.parse(valor) : valor;
        if (!validarEstado(valor)) throw new Error('estado inválido para persistência');
        var normal = registrosNormalizados(valor);
        return {
            meta: estadoBaseParaMeta(valor),
            cadernos: normal.cadernos,
            questoes: normal.questoes
        };
    }

    function persistirSnapshot(snapshot) {
        return idbTransacao([IDB_META_STORE, IDB_CADERNOS_STORE, IDB_QUESTOES_STORE], 'readwrite', function (tx) {
            var meta = tx.objectStore(IDB_META_STORE);
            var cs = tx.objectStore(IDB_CADERNOS_STORE);
            var qs = tx.objectStore(IDB_QUESTOES_STORE);
            meta.put(snapshot.meta);
            // Reconciliação dentro da mesma transação: registros atuais são
            // upsertados e somente IDs que desapareceram são removidos.
            var novosCadernos = new Map();
            var novasQuestoes = new Map();
            snapshot.cadernos.forEach(function (c) { novosCadernos.set(String(c.id), c); cs.put(c); });
            snapshot.questoes.forEach(function (q) { novasQuestoes.set(String(q.id), q); qs.put(q); });
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

    function salvarSnapshot(valor) {
        var snapshot;
        try {
            snapshot = prepararSnapshot(valor);
        } catch (e) {
            return Promise.reject(e);
        }
        return persistirSnapshot(snapshot);
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
                        resolve({ failed: true, reason: 'legado v1 inválido' }); return;
                    }
                    salvarSnapshot(legado).then(function () {
                        return idbTransacao([IDB_META_STORE, IDB_LEGACY_STORE], 'readwrite', function (t) {
                            t.objectStore(IDB_META_STORE).put({ key: 'legacy-v1-archive', schema: 2, archivedAt: Date.now(), json: rec.json });
                            t.objectStore(IDB_LEGACY_STORE).delete(CONFIG.storageKey);
                        });
                    }).then(function () { resolve(legado); }).catch(function (e) {
                        migrationFailed = true;
                        resolve({ failed: true, reason: 'falha na migração v1' });
                    });
                };
                req.onerror = function () { resolve(null); };
            });
        });
    }

    function abrirBancoAntigoSeExistir() {
        var factory = window.indexedDB;
        function abrir() {
            return new Promise(function (resolve) {
                var req;
                var inexistente = false;
                try { req = factory.open('tec_fabrica_db'); } catch (e) { resolve(null); return; }
                req.onupgradeneeded = function (evento) {
                    if (evento.oldVersion === 0) {
                        inexistente = true;
                        try { req.transaction.abort(); } catch (e) {}
                    }
                };
                req.onerror = function () { resolve(null); };
                req.onsuccess = function () {
                    if (inexistente) {
                        try { req.result.close(); } catch (e) {}
                        resolve(null);
                        return;
                    }
                    resolve(req.result || null);
                };
            });
        }
        if (typeof factory.databases !== 'function') return abrir();
        return factory.databases().then(function (lista) {
            var existe = (lista || []).some(function (item) { return item && item.name === 'tec_fabrica_db'; });
            return existe ? abrir() : null;
        }).catch(abrir);
    }

    function lerStoresDoBanco(db, stores) {
        if (!stores.length) return Promise.resolve([]);
        return new Promise(function (resolve, reject) {
            var tx;
            var resultados = stores.map(function () { return []; });
            try { tx = db.transaction(stores, 'readonly'); } catch (e) { reject(e); return; }
            stores.forEach(function (store, i) {
                var reqGet;
                try { reqGet = tx.objectStore(store).getAll(); } catch (e) { try { tx.abort(); } catch (e2) {} reject(e); return; }
                reqGet.onsuccess = function () { resultados[i] = reqGet.result || []; };
                reqGet.onerror = function () { try { tx.abort(); } catch (e) {} };
            });
            tx.oncomplete = function () { resolve(resultados); };
            tx.onerror = function () { reject(tx.error || new Error('falha ao ler banco antigo')); };
            tx.onabort = function () { reject(tx.error || new Error('leitura do banco antigo abortada')); };
        });
    }

    function lerLegadoDoBanco(db) {
        if (!db.objectStoreNames.contains(IDB_LEGACY_STORE)) return Promise.resolve(null);
        return new Promise(function (resolve, reject) {
            var tx;
            var legado = null;
            var erroLeitura = null;
            try { tx = db.transaction(IDB_LEGACY_STORE, 'readonly'); } catch (e) { reject(e); return; }
            var reqLeg = tx.objectStore(IDB_LEGACY_STORE).get(CONFIG.storageKey);
            reqLeg.onsuccess = function () {
                var rec = reqLeg.result;
                if (!rec || !rec.json) return;
                legado = parseLegadoV1(rec.json);
                if (!legado) {
                    erroLeitura = new Error('legado antigo inválido');
                    try { tx.abort(); } catch (e) {}
                }
            };
            reqLeg.onerror = function () {
                erroLeitura = reqLeg.error || new Error('falha ao ler legado antigo');
                try { tx.abort(); } catch (e) {}
            };
            tx.oncomplete = function () { resolve(legado); };
            tx.onerror = function () { reject(erroLeitura || tx.error || new Error('falha ao ler legado antigo')); };
            tx.onabort = function () { reject(erroLeitura || tx.error || new Error('leitura do legado antigo abortada')); };
        });
    }

    function copiarStoresParaBancoNovo(stores, resultados) {
        if (!stores.length) return Promise.resolve();
        return abrirIdb().then(function (dbNovo) {
            return new Promise(function (resolve, reject) {
                var txNovo;
                try { txNovo = dbNovo.transaction(stores, 'readwrite'); } catch (e) { reject(e); return; }
                txNovo.oncomplete = function () { resolve(); };
                txNovo.onerror = function () { reject(txNovo.error || new Error('falha ao copiar banco antigo')); };
                txNovo.onabort = function () { reject(txNovo.error || new Error('cópia do banco antigo abortada')); };
                try {
                    resultados.forEach(function (registros, i) {
                        var alvo = txNovo.objectStore(stores[i]);
                        registros.forEach(function (registro) { alvo.put(registro); });
                    });
                } catch (e) {
                    try { txNovo.abort(); } catch (e2) {}
                    reject(e);
                }
            });
        });
    }

    function apagarBancoAntigo() {
        return new Promise(function (resolve) {
            var req;
            try { req = window.indexedDB.deleteDatabase('tec_fabrica_db'); } catch (e) { resolve(false); return; }
            req.onsuccess = function () { resolve(true); };
            req.onerror = function () { resolve(false); };
            req.onblocked = function () { resolve(false); };
        });
    }

    // Migra de forma fail-safe: qualquer erro de leitura/escrita preserva o
    // banco antigo. A exclusão só é solicitada após a cópia ser confirmada.
    function migrarBancoAntigo() {
        if (!idInstalacao || typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(false);
        var dbAntigo = null;
        return abrirBancoAntigoSeExistir().then(function (db) {
            dbAntigo = db;
            if (!dbAntigo) return false;
            var conhecidos = [IDB_META_STORE, IDB_CADERNOS_STORE, IDB_QUESTOES_STORE, IDB_LEGACY_STORE];
            var nomes = [];
            for (var i = 0; i < dbAntigo.objectStoreNames.length; i += 1) nomes.push(dbAntigo.objectStoreNames[i]);
            if (nomes.some(function (nome) { return conhecidos.indexOf(nome) < 0; })) {
                try { dbAntigo.close(); } catch (e) {}
                dbAntigo = null;
                return false;
            }
            var stores = [IDB_META_STORE, IDB_CADERNOS_STORE, IDB_QUESTOES_STORE].filter(function (nome) {
                return dbAntigo.objectStoreNames.contains(nome);
            });
            return Promise.all([lerStoresDoBanco(dbAntigo, stores), lerLegadoDoBanco(dbAntigo)]).then(function (dados) {
                var resultados = dados[0];
                var legado = dados[1];
                var temRegistros = resultados.some(function (lista) { return lista.length > 0; });
                if (!temRegistros && !legado) {
                    try { dbAntigo.close(); } catch (e) {}
                    dbAntigo = null;
                    return false;
                }
                var escrita = legado ? salvarSnapshot(legado) : Promise.resolve();
                return escrita.then(function () { return copiarStoresParaBancoNovo(stores, resultados); }).then(function () {
                    try { dbAntigo.close(); } catch (e) {}
                    dbAntigo = null;
                    return apagarBancoAntigo();
                });
            });
        }).catch(function () {
            if (dbAntigo) { try { dbAntigo.close(); } catch (e) {} }
            return false;
        });
    }

    function carregarEstadoIdb() {
        if (!idInstalacao) return carregarV2().then(function (v2) { return v2 || migrarV1(); });
        // Um banco novo já válido sempre vence. Isso evita que uma origem
        // antiga, cuja exclusão ficou bloqueada, sobrescreva dados mais novos
        // em boots seguintes.
        return carregarV2().then(function (v2Existente) {
            if (v2Existente) return v2Existente;
            return migrarBancoAntigo().then(function () {
                return carregarV2().then(function (v2) { return v2 || migrarV1(); });
            });
        });
    }

    function salvarEstadoIdb(valor) {
        if (!window.indexedDB) return Promise.resolve();
        var snapshot;
        try {
            snapshot = prepararSnapshot(valor);
        } catch (e) {
            return Promise.reject(e);
        }
        // Serializa as transações e devolve a promessa da gravação. Isso é
        // essencial para irPara(): uma navegação completa pode descarregar a
        // página antes de um setTimeout(0) ou de uma transação solta terminar.
        var anterior = saveChain.catch(function () { return false; });
        var transacao = anterior.then(function () {
            return persistirSnapshot(snapshot);
        });
        saveChain = transacao.then(function () {
            return true;
        }, function () {
            return false;
        });
        return transacao;
    }

    function carregarEstado() {
        return carregarEstadoIdb().then(function (parsed) {
            var logsDoBoot = Array.isArray(estado.logs) ? estado.logs.slice() : [];
            if (parsed && parsed.failed) {
                estado = estadoVazio();
                estado.logs = logsDoBoot.slice(-600);
                estado.status = 'erro';
                estado.erro = parsed.reason;
                estado.mensagem = parsed.reason + '. O legado foi preservado.';
                indexarEstado(estado);
                return estado;
            }
            if (parsed && validarEstado(parsed)) {
                parsed.logs = (Array.isArray(parsed.logs) ? parsed.logs : []).concat(logsDoBoot).slice(-600);
                normalizarEstadoPersistido(parsed);
                estado = parsed; indexarEstado(estado); log('Estado restaurado do IndexedDB v2.'); return parsed;
            }
            indexarEstado(estado); return null;
        }).catch(function (e) {
            migrationFailed = true;
            estado.status = 'erro';
            estado.erro = e && e.message || String(e);
            estado.mensagem = 'Falha ao carregar o estado; dados legados foram preservados.';
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
        return new Promise(function (resolve, reject) {
            saveTimer = setTimeout(function () {
                saveTimer = null; saveCritical = false;
                salvarEstadoIdb(estado).then(resolve, function (e) {
                    if (checkpointCritico === true) { reject(e); return; }
                    resolve();
                });
            }, atraso);
        });
    }

    function estatisticasIndices() {
        return {
            cadernos: cadernosPorId.size,
            questoes: questoesPorId.size,
            porCaderno: questaoIdsPorCaderno.size
        };
    }

    if (typeof window !== 'undefined') {
        window.__TecFabricaPersistence = {
            estadoVazio: estadoVazio,
            sanitizarParaPersistencia: sanitizarParaPersistencia,
            validarEstado: validarEstado,
            indexarEstado: indexarEstado,
            salvarSnapshot: salvarSnapshot,
            estatisticasIndices: estatisticasIndices
            ,validarMetaV2: validarMetaV2,
            reconstruirEstadoV2: reconstruirEstadoV2,
            parseLegadoV1: parseLegadoV1
            ,criarDebounce: criarDebounce
        };
        if (typeof ocultarGlobal === 'function') ocultarGlobal('__TecFabricaPersistence', window.__TecFabricaPersistence);
    }
