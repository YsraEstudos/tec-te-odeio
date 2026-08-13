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

