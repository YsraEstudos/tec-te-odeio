    /* =====================================================================
     * ORQUESTRADOR — máquina de fases retomável por navegação
     * ---------------------------------------------------------------------
     * Regra de ouro: NENHUM await cruza uma navegação completa. Toda
     * navegação (irPara) salva o estado com a fase e encerra a execução;
     * o próximo carregamento da página (auto-resume) continua pela fase.
     * Fases por matéria (monotônicas, sem reentrada):
     *   pasta-check → criar-novo → criando → coletando
     * =================================================================== */
    function normalizarTituloCaderno(titulo) {
        var texto = clean(titulo).toLocaleLowerCase('pt-BR');
        return typeof texto.normalize === 'function' ? texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : texto;
    }

    function modoCriarTudoAtivo() {
        return !!(estado.config && estado.config.modoCriacao === 'criar-tudo');
    }

    function passadaCriacao() {
        return modoCriarTudoAtivo() && estado.passada !== 'coleta';
    }

    function iniciarPassadaColeta() {
        var plano = estado.plano || { matters: [] };
        var config = estado.config || {};
        estado.passada = 'coleta';
        estado.planIndex = 0;
        estado.loteInicio = 0;
        estado.loteFim = Math.min(config.batchSize || CONFIG.batchSize || 20, plano.matters.length);
        estado.cadernoAtual = null;
        estado.fase = 'nenhuma';
        estado.mensagem = 'Todos os cadernos do plano foram criados; iniciando a coleta das questões...';
        salvarEstado(true);
        UI.renderProgresso();
        log('Passada de criação concluída; iniciando a coleta de todas as questões.', {
            tipo: 'decisao', nivel: 'ok', fase: 'nenhuma',
            contexto: { passada: 'coleta', materias: plano.matters.length, loteFim: estado.loteFim }
        });
        processarLote();
    }

    function acharCadernoPorTitulo(titulo) {
        var alvo = normalizarTituloCaderno(titulo);
        return Object.keys(estado.biblioteca).map(function (k) { return estado.biblioteca[k]; })
            .find(function (b) { return normalizarTituloCaderno(b.titulo) === alvo; }) || null;
    }

    function urlFiltros() { return location.origin + '/questoes/filtrar?idPasta=' + (estado.config ? estado.config.folderId : ''); }
    function urlPasta() { return location.origin + '/questoes/pastas/' + (estado.config ? estado.config.folderId : ''); }
    function urlCaderno(id) { return location.origin + '/questoes/cadernos/' + id; }

    function registrarTransicaoPastaCaderno(idCaderno) {
        var agora = Date.now();
        var chave = String(estado.planIndex) + ':' + String(idCaderno || 'desconhecido');
        var ciclo = estado.transicaoPastaCaderno;
        if (!ciclo || ciclo.chave !== chave || agora - Number(ciclo.inicio || 0) > 60000) {
            ciclo = { chave: chave, inicio: agora, tentativas: 1 };
        } else {
            ciclo.tentativas = Number(ciclo.tentativas || 0) + 1;
        }
        estado.transicaoPastaCaderno = ciclo;
        if (ciclo.tentativas >= 3) {
            estado.status = 'erro';
            estado.pausaManual = false;
            estado.fase = 'nenhuma';
            estado.erro = 'Loop de navegação detectado entre a pasta e o caderno ' + String(idCaderno || '') + '.';
            estado.mensagem = estado.erro + ' A execução foi interrompida para preservar o estado.';
            salvarEstado(true);
            UI.setStatus(estado.mensagem);
            UI.renderProgresso();
            log('Loop de navegação detectado; execução interrompida.', {
                tipo: 'erro', nivel: 'erro', fase: 'pasta-check',
                contexto: { cadernoId: String(idCaderno || ''), planIndex: estado.planIndex, tentativas: ciclo.tentativas }
            });
            return false;
        }
        salvarEstado(true);
        return true;
    }

    function limparTransicaoPastaCaderno() {
        if (!estado.transicaoPastaCaderno) return;
        estado.transicaoPastaCaderno = null;
        salvarEstado(true);
    }

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
        var alvo = normalizarTituloCaderno(titulo);
        var links = Array.from(document.querySelectorAll("a[href*='/questoes/cadernos/']"));
        var correspondentes = links.filter(function (a) {
                var linha = typeof a.closest === 'function' ? a.closest('.list-item-caderno') : null;
                var textos = [
                    a.getAttribute && a.getAttribute('title'),
                    a.innerText,
                    a.textContent,
                    linha && (linha.innerText || linha.textContent)
                ].filter(Boolean).map(function (txt) { return normalizarTituloCaderno(clean(txt)); });
                return textos.some(function (txt) {
                    return txt === alvo || (txt.length > alvo.length && txt.indexOf(alvo) !== -1);
                });
            });
        return correspondentes.find(function (a) {
            var linha = typeof a.closest === 'function' ? a.closest('.list-item-caderno') : null;
            return (a.offsetParent !== null) || (linha && linha.offsetParent !== null);
        }) || correspondentes[0] || null;
    }

    function clicarCadernoNaPasta(link) {
        if (!link) return false;
        var alvo = typeof link.closest === 'function' ? link.closest('.list-item-caderno') : (link.parentElement || link);
        try {
            if (typeof alvo.click === 'function') {
                alvo.click();
                return true;
            }
        } catch (e) {
            log('Clique na linha do caderno falhou; tentando o link interno.', {
                tipo: 'tentativa', nivel: 'warn', fase: 'pasta-check',
                contexto: { motivo: String(e && e.message || e) }
            });
        }
        try {
            if (typeof link.click === 'function') {
                link.click();
                return true;
            }
        } catch (e2) {
            log('Clique no link do caderno também falhou.', {
                tipo: 'resultado', nivel: 'warn', fase: 'pasta-check',
                contexto: { motivo: String(e2 && e2.message || e2) }
            });
        }
        return false;
    }

    function abrirCadernoEncontradoNaPasta(link, idCaderno) {
        var url = urlCaderno(idCaderno);
        if (!registrarTransicaoPastaCaderno(idCaderno)) return;
        log('Abertura do caderno existente solicitada.', {
            tipo: 'resultado', nivel: 'ok', fase: 'pasta-check',
            contexto: { cadernoId: String(idCaderno), metodo: 'irPara' }
        });
        irPara(url);
    }

    function avancarMateria() {
        estado.planIndex += 1;
        estado.cadernoAtual = null;
        estado.fase = 'nenhuma';
        salvarEstado();
        UI.renderBiblioteca();
        UI.renderProgresso();
        if (passadaCriacao() && estado.plano && estado.planIndex >= estado.plano.matters.length) {
            iniciarPassadaColeta();
            return;
        }
        if (estado.loteFim > 0 && estado.planIndex >= estado.loteFim) {
            terminarLote();
        } else {
            processarLote();
        }
    }

    function registrarCadernoCriadoNaRota(materia) {
        var id = String(cadernoIdDaUrl() || '');
        if (!id) return false;
        var caderno = estado.biblioteca[id] || {
            id: id,
            titulo: materia.title,
            categoria: materia.group || 'Plano',
            total: 0,
            coletadas: 0,
            completo: false,
            questoes: []
        };
        caderno.id = id;
        caderno.titulo = caderno.titulo || materia.title;
        caderno.categoria = caderno.categoria || materia.group || 'Plano';
        caderno.total = caderno.total || estado.pendenciaContagem || 0;
        caderno.questoes = Array.isArray(caderno.questoes) ? caderno.questoes : [];
        caderno.coletadas = caderno.questoes.length;
        caderno.completo = caderno.completo === true && caderno.questoes.length > 0;
        estado.biblioteca[id] = caderno;
        delete estado.pendenciaContagem;
        estado.fase = 'nenhuma';
        var deveAvancarSemColetar = passadaCriacao();
        estado.cadernoAtual = deveAvancarSemColetar ? null : caderno;
        salvarEstado(true);
        UI.renderBiblioteca();
        log('Recuperação: caderno criado encontrado na rota; registro concluído.' +
            (deveAvancarSemColetar ? ' Avançando sem coletar nesta passada.' : ' Iniciando coleta.'), {
                tipo: 'decisao', nivel: 'ok', fase: 'criando',
                contexto: { materia: materia.title, cadernoId: id, origem: 'rota-pos-criacao', passada: deveAvancarSemColetar ? 'criacao' : 'coleta' }
            });
        if (deveAvancarSemColetar) avancarMateria();
        else processarLote();
        return true;
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
        if (passadaCriacao() && estado.planIndex >= plano.matters.length) {
            iniciarPassadaColeta();
            return;
        }
        if (estado.planIndex >= plano.matters.length) { terminarCompleto(); return; }

        var materia = plano.matters[estado.planIndex];
        var idCadernoRota = paginaAtual() === 'caderno' ? cadernoIdDaUrl() : '';
        var existente = null;
        var cadernoDaRota = idCadernoRota ? estado.biblioteca[idCadernoRota] : null;
        var rotaPertenceAoPlanoAtual = cadernoDaRota &&
            normalizarTituloCaderno(cadernoDaRota.titulo) === normalizarTituloCaderno(materia.title);
        var rotaEhCadernoAtual = idCadernoRota && estado.cadernoAtual &&
            String(estado.cadernoAtual.id) === String(idCadernoRota);
        if (rotaPertenceAoPlanoAtual) {
            existente = cadernoDaRota;
        } else if (rotaEhCadernoAtual) {
            existente = estado.cadernoAtual;
        } else {
            existente = acharCadernoPorTitulo(materia.title);
        }

        log('Avaliando próxima matéria do plano.', {
            tipo: 'observacao', fase: estado.fase || 'nenhuma',
            contexto: { planIndex: estado.planIndex, materias: plano.matters.length, materia: materia.title, cadernoRegistrado: !!existente, pagina: paginaAtual() }
        });

        // Se a navegação para o caderno terminou antes do checkpoint de
        // "criando", a rota é a prova de que a criação foi concluída. Não
        // volte aos filtros para gerar o mesmo caderno novamente.
        if (!existente && paginaAtual() === 'caderno' && estado.fase === 'criar-novo') {
            registrarCadernoCriadoNaRota(materia);
            return;
        }

        if (modoCriarTudoAtivo() && estado.passada === 'coleta' && !existente) {
            log('decisão: matéria sem caderno na passada de coleta; avançando (a passada de criação já rodou).', {
                tipo: 'decisao', nivel: 'warn', fase: 'coletando',
                contexto: { materia: materia.title, motivo: 'sem-caderno-registrado' }
            });
            avancarMateria();
            return;
        }

        /* ---- matéria com caderno registrado ---- */
        if (existente) {
            if (passadaCriacao()) {
                log('decisão: caderno já registrado; avançando matéria (passada de criação).', {
                    tipo: 'decisao', nivel: 'ok', fase: 'pasta-check',
                    contexto: { cadernoId: existente.id, titulo: existente.titulo, materia: materia.title }
                });
                avancarMateria();
                return;
            }
            if (existente.completo && existente.totalConfirmado === true && existente.questoes && existente.questoes.length) {
                log('decisão: caderno já completo; avançando matéria.', {
                    tipo: 'decisao', nivel: 'ok', fase: 'coletando',
                    contexto: { cadernoId: existente.id, titulo: existente.titulo, questoes: existente.questoes.length, totalConfirmado: true }
                });
                avancarMateria();
                return;
            }
            if (paginaAtual() !== 'caderno' || String(cadernoIdDaUrl()) !== String(existente.id)) {
                estado.fase = 'coletando';
                estado.cadernoAtual = existente;
                estado.mensagem = 'Abrindo caderno ' + existente.id + '...';
                log('decisão: caderno incompleto ou com total ainda não validado; abrindo a página para coleta questão a questão.', {
                    tipo: 'decisao', fase: 'coletando',
                    contexto: { cadernoId: existente.id, titulo: existente.titulo, coletadas: (existente.questoes || []).length, total: existente.total || null, totalConfirmado: existente.totalConfirmado === true }
                });
                salvarEstado();
                UI.setStatus(estado.mensagem);
                irPara(urlCaderno(existente.id)); // navega → próximo boot retoma
                return;
            }
            estado.cadernoAtual = existente;
            estado.fase = 'coletando';
            limparTransicaoPastaCaderno();
            salvarEstado(true);
            UI.renderProgresso();
            try {
                await coletarCaderno(existente); // SPA: sem navegação completa
                if (estado.status === 'rodando' && existente.completo) {
                    avancarMateria();
                }
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
                    if (paginaAtual() === 'caderno' && !registrarTransicaoPastaCaderno(cadernoIdDaUrl())) return;
                    irPara(urlPasta()); // navega → próximo boot retoma em pasta-check
                    return;
                }
                var link = encontrarLinkCadernoNaPasta(materia.title);
                for (var tentativaPasta = 0; !link && tentativaPasta < 4; tentativaPasta += 1) {
                    await workerSleep(tentativaPasta === 0 ? 1200 : 1000);
                    link = encontrarLinkCadernoNaPasta(materia.title);
                }
                if (link) {
                    var mId = (link.href || '').match(/cadernos\/(\d+)/);
                    if (mId) {
                        var idCaderno = String(mId[1]);
                        var salvo = estado.biblioteca[idCaderno];
                        log('Decisão: caderno encontrado na pasta; usando o existente.', {
                            tipo: 'decisao', nivel: 'ok', fase: 'pasta-check',
                            contexto: { materia: materia.title, cadernoId: idCaderno, origem: 'pasta', preservado: !!salvo, questoesPreservadas: salvo && salvo.questoes ? salvo.questoes.length : 0 }
                        });
                        if (salvo) {
                            salvo.id = idCaderno;
                            salvo.titulo = salvo.titulo || materia.title;
                            salvo.categoria = salvo.categoria || materia.group || 'Plano';
                            salvo.questoes = Array.isArray(salvo.questoes) ? salvo.questoes : [];
                            salvo.coletadas = salvo.questoes.length;
                            salvo.completo = salvo.completo === true && salvo.questoes.length > 0;
                        } else {
                            estado.biblioteca[idCaderno] = { id: idCaderno, titulo: materia.title, categoria: materia.group || 'Plano', total: 0, coletadas: 0, completo: false, questoes: [] };
                        }
                        if (passadaCriacao()) {
                            log('decisão: caderno registrado sem coletar (passada de criação); avançando matéria.', {
                                tipo: 'decisao', nivel: 'ok', fase: 'pasta-check',
                                contexto: { materia: materia.title, cadernoId: idCaderno, proximaPassada: 'coleta' }
                            });
                            estado.fase = 'nenhuma';
                            estado.cadernoAtual = null;
                            salvarEstado(true);
                            UI.renderBiblioteca();
                            avancarMateria();
                            return;
                        }
                        estado.fase = 'coletando';
                        estado.cadernoAtual = estado.biblioteca[idCaderno];
                        estado.mensagem = 'Abrindo caderno ' + idCaderno + ' para retomar a coleta...';
                        salvarEstado(true);
                        UI.renderBiblioteca();
                        UI.setStatus(estado.mensagem);
                        abrirCadernoEncontradoNaPasta(link, idCaderno);
                        return;
                    }
                }
                log('Decisão: caderno não encontrado; iniciando criação.', {
                    tipo: 'decisao', fase: 'pasta-check', contexto: { materia: materia.title, proximaFase: 'criar-novo' }
                });
                estado.fase = 'criar-novo';
                salvarEstado();
                if (paginaAtual() === 'filtros') {
                    processarLote();
                } else {
                    irPara(urlFiltros()); // navega → próximo boot retoma em criar-novo
                }
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
                    // O site pode mudar a rota por SPA sem recarregar o userscript.
                    // Nesse caso, processa imediatamente a fase 'criando' em vez
                    // de depender de um novo boot para registrar o caderno.
                    if (paginaAtual() === 'caderno') processarLote();
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
                    var deveAvancarSemColetar = passadaCriacao();
                    estado.biblioteca[novoId] = { id: novoId, titulo: materia.title, categoria: materia.group || 'Plano', total: contagemSalva, coletadas: 0, completo: false, questoes: [] };
                    delete estado.pendenciaContagem;
                    estado.fase = 'nenhuma';
                    estado.cadernoAtual = deveAvancarSemColetar ? null : estado.biblioteca[novoId];
                    salvarEstado(deveAvancarSemColetar);
                    UI.renderBiblioteca();
                    log('Decisão: caderno recém-criado registrado.' + (deveAvancarSemColetar ? ' Passada de criação: avançando matéria sem coletar.' : ' Iniciando coleta.'), {
                        tipo: 'decisao', nivel: 'ok', fase: 'criando',
                        contexto: { materia: materia.title, cadernoId: novoId, questoes: contagemSalva, passada: deveAvancarSemColetar ? 'criacao' : 'coleta' }
                    });
                    if (deveAvancarSemColetar) {
                        avancarMateria();
                        return;
                    }
                    processarLote();
                    return;
                }
                // crash entre o clique e a navegação: página ainda é filtros → re-verifica a pasta
                estado.fase = 'pasta-check';
                log('Navegação de criação não concluiu; voltando à verificação da pasta.', {
                    tipo: 'decisao', nivel: 'warn', fase: 'criando', contexto: { materia: materia.title, pagina: paginaAtual(), proximaFase: 'pasta-check' }
                });
                salvarEstado();
                if (paginaAtual() === 'pasta') {
                    processarLote();
                } else {
                    irPara(urlPasta());
                }
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
                if (paginaAtual() === 'pasta') {
                    processarLote();
                } else {
                    irPara(urlPasta()); // navega → próximo boot retoma em pasta-check
                }
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
        cancelarAutoResumir();
        cicloExecucaoId += 1;
        if (typeof Scheduler !== 'undefined' && typeof Scheduler.limpar === 'function') {
            Scheduler.limpar();
        }
        estado.status = 'rodando';
        estado.modo = 'lote';
        estado.pausaManual = false;
        estado.erro = null;
        estado.loteInicio = Math.max(0, estado.planIndex);
        estado.loteFim = Math.min(estado.planIndex + estado.config.batchSize, estado.plano.matters.length);
        salvarEstado(true);
        UI.renderProgresso();
        log('Execução do plano iniciada.', {
            tipo: 'resultado', nivel: 'ok', fase: 'nenhuma',
            contexto: { planIndex: estado.planIndex, loteInicio: estado.loteInicio, loteFim: estado.loteFim, materias: estado.plano.matters.length, fluxoCriacao: estado.config.modoCriacao || 'padrao', passada: estado.passada || 'criacao' }
        });
        processarLote();
    }

    function parar() {
        cancelarAutoResumir();
        cicloExecucaoId += 1;
        if (typeof Scheduler !== 'undefined' && typeof Scheduler.limpar === 'function') {
            Scheduler.limpar();
        }
        estado.status = 'pausado';
        estado.pausaManual = true;
        salvarEstado(true);
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
        cancelarAutoResumir();
        cicloExecucaoId += 1;
        if (typeof Scheduler !== 'undefined' && typeof Scheduler.limpar === 'function') {
            Scheduler.limpar();
        }
        estado.status = 'rodando';
        estado.modo = 'lote';
        estado.pausaManual = false;
        estado.erro = null;
        estado.loteInicio = Math.max(0, estado.planIndex);
        estado.loteFim = Math.min(estado.planIndex + estado.config.batchSize, estado.plano.matters.length);
        salvarEstado(true);
        UI.renderProgresso();
        log('Execução retomada pelo usuário.', {
            tipo: 'resultado', nivel: 'ok', fase: estado.fase || 'nenhuma', contexto: { planIndex: estado.planIndex, loteFim: estado.loteFim, passada: estado.passada || 'criacao' }
        });
        processarLote();
    }
