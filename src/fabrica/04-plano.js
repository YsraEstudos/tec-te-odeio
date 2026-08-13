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

