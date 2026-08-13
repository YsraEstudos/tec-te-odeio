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
                return txt.toLocaleLowerCase('pt-BR') === alvo;
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
        if (!plano || !config) {
            log('Execução não iniciada: plano ou configuração ausente.', {
                tipo: 'decisao', nivel: 'warn', fase: 'nenhuma', contexto: { temPlano: !!plano, temConfig: !!config }
            });
            return;
        }
        if (estado.status !== 'rodando') {
            log('Execução não avançou porque está pausada ou parada.', {
                tipo: 'decisao', fase: estado.fase || 'nenhuma', contexto: { status: estado.status, planIndex: estado.planIndex }
            });
            return;
        }
        if (estado.planIndex >= plano.matters.length) { terminarCompleto(); return; }

        var materia = plano.matters[estado.planIndex];
        var existente = acharCadernoPorTitulo(materia.title);
        log('Avaliando próxima matéria do plano.', {
            tipo: 'observacao', fase: estado.fase || 'nenhuma',
            contexto: { planIndex: estado.planIndex, materias: plano.matters.length, materia: materia.title, cadernoRegistrado: !!existente, pagina: paginaAtual() }
        });

        /* ---- matéria com caderno registrado: coleta sequencial ---- */
        if (existente) {
            if (existente.completo && existente.questoes && existente.questoes.length) {
                log('decisão: caderno já completo; avançando matéria.', {
                    tipo: 'decisao', nivel: 'ok', fase: 'coletando',
                    contexto: { cadernoId: existente.id, titulo: existente.titulo, questoes: existente.questoes.length }
                });
                avancarMateria();
                return;
            }
            if (paginaAtual() !== 'caderno' || cadernoIdDaUrl() !== existente.id) {
                estado.fase = 'coletando';
                estado.cadernoAtual = existente;
                estado.mensagem = 'Abrindo caderno ' + existente.id + '...';
                log('decisão: caderno incompleto; abrindo a página para coleta questão a questão.', {
                    tipo: 'decisao', fase: 'coletando',
                    contexto: { cadernoId: existente.id, titulo: existente.titulo, coletadas: (existente.questoes || []).length, total: existente.total || null }
                });
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
                log('Falha durante a coleta do caderno.', {
                    tipo: 'erro', nivel: 'erro', fase: 'coletando',
                    contexto: { cadernoId: existente.id, materia: materia.title, motivo: estado.erro }
                });
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
                        log('Decisão: caderno encontrado na pasta; usando o existente.', {
                            tipo: 'decisao', nivel: 'ok', fase: 'pasta-check',
                            contexto: { materia: materia.title, cadernoId: mId[1], origem: 'pasta' }
                        });
                        estado.biblioteca[mId[1]] = { id: mId[1], titulo: materia.title, categoria: materia.group || 'Plano', total: 0, coletadas: 0, completo: false, questoes: [] };
                        estado.fase = 'nenhuma';
                        salvarEstado();
                        UI.renderBiblioteca();
                        processarLote();
                        return;
                    }
                }
                log('Decisão: caderno não encontrado; iniciando criação.', {
                    tipo: 'decisao', fase: 'pasta-check', contexto: { materia: materia.title, proximaFase: 'criar-novo' }
                });
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
                        log('Controles de criação não carregaram na página de filtros.', {
                            tipo: 'erro', nivel: 'erro', fase: 'criar-novo', contexto: { materia: materia.title, pagina: paginaAtual() }
                        });
                        UI.setStatus('Erro: ' + estado.erro);
                        return;
                    }
                }
                try {
                    UI.setStatus('Aplicando filtros: ' + materia.title);
                    await aplicarFiltros(materia, plano);
                    var contagem = lerContagem();
                    if (!contagem) {
                        log('Decisão: filtros não retornaram questões; pulando matéria.', {
                            tipo: 'decisao', nivel: 'warn', fase: 'filtros', contexto: { materia: materia.title, questoes: 0 }
                        });
                        estado.planIndex += 1;
                        estado.fase = 'nenhuma';
                        salvarEstado();
                        processarLote();
                        return;
                    }
                    estado.fase = 'criando';
                    estado.pendenciaContagem = contagem;
                    estado.mensagem = 'Criando caderno: ' + materia.title + ' (' + contagem + ' questões)';
                    log('Decisão: filtros confirmados; criando caderno.', {
                        tipo: 'decisao', nivel: 'ok', fase: 'criando', contexto: { materia: materia.title, questoes: contagem }
                    });
                    salvarEstado();
                    UI.setStatus(estado.mensagem);
                    await criarCaderno(materia, config); // clique → navega → próximo boot retoma em 'criando'
                } catch (e) {
                    estado.status = 'erro';
                    estado.erro = String(e && e.message || e);
                    estado.fase = 'nenhuma';
                    salvarEstado();
                    log('Falha durante filtros ou criação do caderno.', {
                        tipo: 'erro', nivel: 'erro', fase: 'criar-novo', contexto: { materia: materia.title, motivo: estado.erro }
                    });
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
                    log('Decisão: caderno recém-criado registrado; iniciando coleta.', {
                        tipo: 'decisao', nivel: 'ok', fase: 'criando',
                        contexto: { materia: materia.title, cadernoId: novoId, questoes: contagemSalva, proximaFase: 'coletando' }
                    });
                    processarLote();
                    return;
                }
                // crash entre o clique e a navegação: página ainda é filtros → re-verifica a pasta
                estado.fase = 'pasta-check';
                log('Navegação de criação não concluiu; voltando à verificação da pasta.', {
                    tipo: 'decisao', nivel: 'warn', fase: 'criando', contexto: { materia: materia.title, pagina: paginaAtual(), proximaFase: 'pasta-check' }
                });
                salvarEstado();
                irPara(urlPasta());
                return;
            }
            default: {
                // fase 'nenhuma' (início/retomada): sempre verifica a pasta antes de criar
                estado.fase = 'pasta-check';
                estado.mensagem = 'Verificando se "' + materia.title + '" já existe na pasta...';
                log('Iniciando matéria pela verificação da pasta.', {
                    tipo: 'decisao', fase: 'nenhuma', contexto: { materia: materia.title, proximaFase: 'pasta-check' }
                });
                salvarEstado();
                UI.setStatus(estado.mensagem);
                irPara(urlPasta()); // navega → próximo boot retoma em pasta-check
                return;
            }
        }
    }

    function iniciar() {
        if (estado.status === 'rodando') {
            log('Comando iniciar ignorado: a execução já está rodando.', { tipo: 'decisao', fase: estado.fase || 'nenhuma' });
            return;
        }
        if (!estado.plano || !estado.config) {
            log('Comando iniciar recusado: falta plano ou configuração.', {
                tipo: 'decisao', nivel: 'warn', fase: 'nenhuma', contexto: { temPlano: !!estado.plano, temConfig: !!estado.config }
            });
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
        log('Execução do plano iniciada.', {
            tipo: 'resultado', nivel: 'ok', fase: 'nenhuma',
            contexto: { planIndex: estado.planIndex, loteInicio: estado.loteInicio, loteFim: estado.loteFim, materias: estado.plano.matters.length }
        });
        processarLote();
    }

    function parar() {
        estado.status = 'pausado';
        salvarEstado();
        UI.renderProgresso();
        log('Execução pausada pelo usuário.', {
            tipo: 'resultado', fase: estado.fase || 'nenhuma', contexto: { planIndex: estado.planIndex, cadernoId: estado.cadernoAtual ? estado.cadernoAtual.id : null }
        });
        UI.setStatus('Pausado em ' + (estado.planIndex + 1) + ' de ' + (estado.plano ? estado.plano.matters.length : '?') + ' matérias. Dados preservados.');
    }

    function continuar() {
        if (estado.status === 'rodando') {
            log('Comando continuar ignorado: a execução já está rodando.', { tipo: 'decisao', fase: estado.fase || 'nenhuma' });
            return;
        }
        if (!estado.plano || !estado.config) {
            log('Comando continuar recusado: falta plano ou configuração.', { tipo: 'decisao', nivel: 'warn', fase: 'nenhuma' });
            UI.setStatus('Carregue o plano e configure primeiro.');
            return;
        }
        estado.status = 'rodando';
        estado.modo = 'lote';
        estado.erro = null;
        estado.loteInicio = Math.max(0, estado.planIndex);
        estado.loteFim = Math.min(estado.planIndex + estado.config.batchSize, estado.plano.matters.length);
        salvarEstado();
        UI.renderProgresso();
        log('Execução retomada pelo usuário.', {
            tipo: 'resultado', nivel: 'ok', fase: estado.fase || 'nenhuma', contexto: { planIndex: estado.planIndex, loteFim: estado.loteFim }
        });
        processarLote();
    }

