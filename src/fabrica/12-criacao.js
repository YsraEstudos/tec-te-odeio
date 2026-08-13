    /* =====================================================================
     * ENGINE — CRIAÇÃO DO CADERNO
     * =================================================================== */
    async function criarCaderno(materia, config) {
        var inicioCriacao = Date.now();
        log('Tentando criar caderno para a matéria.', {
            tipo: 'tentativa', fase: 'criando',
            contexto: { materia: materia.title, pastaId: config.folderId }
        });
        try {
        var nomeInput = document.querySelector('#nomeCadernoId');
        var pastaSelect = document.querySelector('#pastaCadernosId');
        var gerar = visiveis('button').find(function (b) { return /Gerar Caderno/i.test(b.innerText || ''); });
        if (!nomeInput || !pastaSelect || !gerar) {
            log('Controles de criação do caderno ausentes.', {
                tipo: 'erro', nivel: 'erro', fase: 'criando',
                contexto: { materia: materia.title, nomeInput: !!nomeInput, pastaSelect: !!pastaSelect, botaoGerar: !!gerar }
            });
            throw new Error('Controles de geração do caderno não encontrados.');
        }

        // nome (sincroniza ng-model no blur)
        setInput(nomeInput, materia.title);
        nomeInput.dispatchEvent(new Event('blur', { bubbles: true }));
        await workerSleep(600);

        // pasta
        var opt = Array.from(pastaSelect.options).find(function (o) { return String(o.value) === String(config.folderId); });
        if (!opt) {
            log('Pasta configurada não está disponível no seletor.', {
                tipo: 'erro', nivel: 'erro', fase: 'criando',
                contexto: { materia: materia.title, pastaId: config.folderId }
            });
            throw new Error('A pasta ' + config.folderId + ' não está no seletor. Abra a página de filtros da pasta correta.');
        }
        pastaSelect.value = opt.value;
        pastaSelect.dispatchEvent(new Event('change', { bubbles: true }));

        await esperar(function () { return !gerar.disabled; }, 12000, 'O botão "Gerar Caderno" permaneceu desabilitado.');
        await pausaAleatoria();
        log('Executando criação do caderno pelo botão do site.', {
            tipo: 'tentativa', fase: 'criando',
            contexto: { materia: materia.title, pastaId: config.folderId }
        });
        gerar.click();

        // aguarda navegação para o caderno criado
        await esperar(function () { return paginaAtual() === 'caderno'; }, 20000, 'O caderno não foi criado (a página não navegou).');
        var id = cadernoIdDaUrl();
        log('Caderno criado e página carregada.', {
            tipo: 'resultado', nivel: 'ok', fase: 'criando',
            contexto: { materia: materia.title, cadernoId: id, duracaoMs: Date.now() - inicioCriacao }
        });
        return id;
        } catch (e) {
            log('Falha na criação do caderno.', {
                tipo: 'erro', nivel: 'erro', fase: 'criando',
                contexto: { materia: materia.title, duracaoMs: Date.now() - inicioCriacao, motivo: String(e && e.message || e) }
            });
            throw e;
        }
    }

