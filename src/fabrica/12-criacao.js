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

