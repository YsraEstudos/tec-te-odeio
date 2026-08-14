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
            planIndex: 0, loteInicio: 0, loteFim: 0, cadernoAtual: null,
            biblioteca: {}, logs: [], controleResolucoesDiarias: { data: null, total: 0 },
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
        if (valor.config.modoColeta !== 'sem-gabarito-manual') valor.config.modoColeta = 'com-gabarito';
        if (typeof normalizarControleResolucoesDiarias === 'function') {
            normalizarControleResolucoesDiarias(valor);
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
        if (!window.indexedDB) return Promise.resolve();
        // Serializa as transações e devolve a promessa da gravação. Isso é
        // essencial para irPara(): uma navegação completa pode descarregar a
        // página antes de um setTimeout(0) ou de uma transação solta terminar.
        var anterior = saveChain.catch(function () { return false; });
        var transacao = anterior.then(function () {
            return salvarSnapshot(json);
        });
        saveChain = transacao.then(function () {
            return true;
        }, function (e) {
            console.warn('[TecFabrica] aviso: falha ao salvar no IndexedDB (' + (e && e.name || e) + ').');
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
        return new Promise(function (resolve, reject) {
            saveTimer = setTimeout(function () {
                saveTimer = null; saveCritical = false;
                var snapshot;
                try { snapshot = JSON.stringify(sanitizarParaPersistencia(estado)); }
                catch (e) {
                    log('ERRO: falha ao serializar o estado (' + (e && e.name || e) + ').', {
                        tipo: 'erro', nivel: 'erro', persist: false
                    });
                    estado.status = 'pausado';
                    if (checkpointCritico === true) { reject(e); return; }
                    resolve(); return;
                }
                salvarEstadoIdb(snapshot).then(resolve, function (e) {
                    if (checkpointCritico === true) { reject(e); return; }
                    resolve();
                });
            }, atraso);
        });
    }

    if (typeof window !== 'undefined') {
        window.__TecFabricaPersistence = {
            estadoVazio: estadoVazio,
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
