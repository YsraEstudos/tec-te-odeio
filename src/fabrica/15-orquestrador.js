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

