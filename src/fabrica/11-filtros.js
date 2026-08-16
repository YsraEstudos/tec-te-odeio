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
        log('Tentando abrir aba de filtro.', {
            tipo: 'tentativa', fase: 'filtros', contexto: { aba: titulo }
        });
        var tab = visiveis('.menu-alternador-opcao').find(function (n) { return mesmoTexto(n.innerText, titulo); });
        if (!tab) {
            log('Aba de filtro não encontrada.', {
                tipo: 'erro', nivel: 'erro', fase: 'filtros', contexto: { aba: titulo }
            });
            throw new Error('Aba de filtro "' + titulo + '" não encontrada.');
        }
        tab.click();
        try {
            await esperar(function () { return !!boxDaAba(titulo); }, 10000, 'A aba "' + titulo + '" não abriu.');
            log('Aba de filtro pronta.', {
                tipo: 'resultado', nivel: 'ok', fase: 'filtros', contexto: { aba: titulo }
            });
        } catch (e) {
            log('Aba de filtro não ficou pronta.', {
                tipo: 'resultado', nivel: 'erro', fase: 'filtros', contexto: { aba: titulo, motivo: String(e && e.message || e) }
            });
            throw e;
        }
    }

    function itemEhPasta(item) {
        return !!item && item.classList.contains('arvore-item-pasta');
    }

    function rotuloItemArvore(item) {
        var nome = item && item.querySelector('.arvore-item-conteudo .arvore-item-nome');
        return clean(nome ? nome.textContent : (item && item.innerText));
    }

    function itemCorresponde(item, texto) {
        var rotulo = rotuloItemArvore(item);
        var titulo = item && item.getAttribute('title');
        return mesmoTexto(rotulo, texto) || mesmoTexto(titulo, texto);
    }

    function itemDaArvore(box, texto) {
        return visiveis('.arvore-item').filter(function (n) {
            return (!box || box.contains(n)) && itemCorresponde(n, texto);
        }).sort(function (a, b) {
            return Number(itemEhPasta(a)) - Number(itemEhPasta(b));
        })[0] || null;
    }

    function itemSelecionavelDaPasta(pasta, texto) {
        var descendentes = visiveis('.arvore-item').filter(function (n) {
            return n !== pasta && pasta.contains(n);
        });
        return descendentes.find(function (n) {
            return n.classList.contains('arvore-item-selecionar-tudo') &&
                (clean(n.getAttribute('title')).toLocaleLowerCase('pt-BR').indexOf(clean(texto).toLocaleLowerCase('pt-BR')) >= 0);
        }) || descendentes.find(function (n) {
            return !itemEhPasta(n) && itemCorresponde(n, texto);
        }) || null;
    }

    async function itemSelecionavel(box, texto) {
        var item = itemDaArvore(box, texto);
        if (!item || !itemEhPasta(item)) return item;

        if (item.getAttribute('aria-expanded') !== 'true') {
            (item.querySelector('.arvore-item-conteudo') || item).click();
        }
        await esperar(function () {
            var pastaAtual = itemDaArvore(box, texto) || item;
            return itemSelecionavelDaPasta(pastaAtual, texto);
        }, 3500, 'A pasta de filtro "' + texto + '" não abriu.');
        item = itemDaArvore(box, texto) || item;
        return itemSelecionavelDaPasta(item, texto) || item;
    }

    function itemSelecionado(box, texto) {
        return visiveis('.arvore-item').some(function (n) {
            return box.contains(n) && n.classList.contains('arvore-item-selecionado') &&
                (itemCorresponde(n, texto) || (n.classList.contains('arvore-item-selecionar-tudo') &&
                    clean(n.getAttribute('title')).toLocaleLowerCase('pt-BR').indexOf(clean(texto).toLocaleLowerCase('pt-BR')) >= 0));
        });
    }

    async function selecionarValor(titulo, valor) {
        log('Tentando selecionar valor de filtro.', {
            tipo: 'tentativa', fase: 'filtros', contexto: { aba: titulo, valor: valor }
        });
        await clicarAba(titulo);
        var box = boxDaAba(titulo);
        if (titulo === 'Ano') {
            var anoItem = itemDaArvore(box, valor);
            if (!anoItem) {
                log('Ano não encontrado na árvore de filtros.', {
                    tipo: 'resultado', nivel: 'erro', fase: 'filtros', contexto: { aba: titulo, valor: valor }
                });
                throw new Error('Ano ' + valor + ' não encontrado na lista.');
            }
            await pausaAleatoria();
            (anoItem.querySelector('.arvore-item-conteudo') || anoItem).click();
            await esperar(function () { return itemSelecionado(box, valor); }, 6000, 'Seleção do ano ' + valor + ' não confirmada.');
            log('Valor de filtro selecionado.', {
                tipo: 'resultado', nivel: 'ok', fase: 'filtros', contexto: { aba: titulo, valor: valor }
            });
            return;
        }
        // Demais abas: busca por nome
        var link = Array.from(box.querySelectorAll('a')).find(function (a) { return clean(a.innerText) === 'Pesquisar por nome'; });
        if (link) { link.click(); await workerSleep(600); }
        var search = box.querySelector("input[ng-model='vm.textoBusca']");
        if (!search) {
            log('Campo de busca do filtro não encontrado.', {
                tipo: 'erro', nivel: 'erro', fase: 'filtros', contexto: { aba: titulo }
            });
            throw new Error('Campo de busca da aba "' + titulo + '" não encontrado.');
        }
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
        if (!item) {
            log('Valor não encontrado no filtro.', {
                tipo: 'resultado', nivel: 'erro', fase: 'filtros', contexto: { aba: titulo, valor: valor }
            });
            throw new Error('"' + valor + '" não encontrado no filtro ' + titulo + '.');
        }
        await pausaAleatoria();
        // Pastas não são selecionáveis: abre a pasta e usa "Todo o conteúdo".
        item = await itemSelecionavel(box, candidatoAchado);
        // a lista pode ter sido re-renderizada pelo Angular após a busca: re-obtém o nó fresco
        if (!item || !item.isConnected) item = await itemSelecionavel(box, candidatoAchado) || item;
        (item.querySelector('.arvore-item-conteudo') || item).click();
        try {
            await esperar(function () { return itemSelecionado(box, candidatoAchado); }, 2500, '');
            log('Valor de filtro selecionado.', {
                tipo: 'resultado', nivel: 'ok', fase: 'filtros', contexto: { aba: titulo, valor: valor, candidato: candidatoAchado }
            });
            return;
        } catch (e) {
            // fallback Angular (mesmo do projeto): dispara vm.notificarClick no escopo do item
            await workerSleep(400);
            if (!item || !item.isConnected) item = await itemSelecionavel(box, candidatoAchado) || item;
            var clickable = item.querySelector('.arvore-item-conteudo') || item;
            var angEl = angular.element(clickable);
            var scope = angEl && ((typeof angEl.isolateScope === 'function' && angEl.isolateScope()) || (typeof angEl.scope === 'function' && angEl.scope()));
            if (scope && scope.vm && typeof scope.vm.notificarClick === 'function') {
                var notify = function () { scope.vm.notificarClick(); };
                if (scope.$root && scope.$root.$$phase) notify();
                else if (typeof scope.$apply === 'function') scope.$apply(notify);
                else notify();
                await esperar(function () { return itemSelecionado(box, candidatoAchado); }, 6000, 'O TecConcursos ignorou a seleção de "' + valor + '".');
                log('Valor de filtro selecionado pelo fallback Angular.', {
                    tipo: 'resultado', nivel: 'ok', fase: 'filtros', contexto: { aba: titulo, valor: valor, candidato: candidatoAchado, metodo: 'angular-fallback' }
                });
                return;
            }
            log('Site ignorou a seleção do filtro.', {
                tipo: 'resultado', nivel: 'erro', fase: 'filtros', contexto: { aba: titulo, valor: valor }
            });
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
        var ativosAntes = contarFiltrosAtivos();
        if (!ativosAntes) {
            log('Nenhum filtro ativo para limpar.', {
                tipo: 'decisao', fase: 'filtros', contexto: { ativos: 0 }
            });
            return;
        }
        log('Tentando limpar filtros existentes.', {
            tipo: 'tentativa', fase: 'filtros', contexto: { ativos: ativosAntes }
        });
        var limpar = visiveis('.gerador-filtrador-cabecalho-limpar, [class*="limpar"]').find(function (n) { return /Limpar/i.test(n.innerText || ''); });
        if (!limpar) throw new Error('Há filtros ativos, mas não encontrei o controle "Limpar".');
        await pausaAleatoria();
        limpar.click();
        await esperar(function () { return contarFiltrosAtivos() === 0; }, 8000, 'A limpeza dos filtros não foi confirmada.');
        log('Filtros anteriores limpos.', {
            tipo: 'resultado', nivel: 'ok', fase: 'filtros', contexto: { antes: ativosAntes, depois: contarFiltrosAtivos() }
        });
    }

    function lerContagem() {
        var el = document.querySelector('.gerador-filtrador strong.ng-binding');
        return el ? parseInt(clean(el.textContent).replace(/\D/g, ''), 10) || 0 : 0;
    }

    async function aguardarFiltrosProntos() {
        await esperar(function () {
            var nome = document.querySelector('#nomeCadernoId');
            var abas = visiveis('.menu-alternador-opcao');
            var abaMateria = abas.some(function (aba) { return mesmoTexto(aba.innerText, 'Matéria e assunto'); });
            return !!nome && abaMateria;
        }, (CONFIG.loadTimeout || 20000) + 10000, 'Os controles da página de filtros não terminaram de carregar.');
    }

    async function aplicarFiltros(materia, plano) {
        log('Iniciando aplicação dos filtros da matéria.', {
            tipo: 'observacao', fase: 'filtros',
            contexto: { materia: materia.title, assuntos: materia.subjectPaths.length, bancas: plano.banks.length, anos: plano.years.length, removerAnuladas: plano.removeCancelled, removerDesatualizadas: plano.removeOutdated }
        });
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
        log('Filtros aplicados e contador de questões confirmado.', {
            tipo: 'resultado', nivel: 'ok', fase: 'filtros',
            contexto: { materia: materia.title, questoes: lerContagem(), filtrosAtivos: contarFiltrosAtivos() }
        });
    }

