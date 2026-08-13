    /* =====================================================================
     * INICIALIZAÇÃO
     * =================================================================== */
    // linha distintiva de inicialização: permite conferir no Console qual
    // versão do script está em execução (combina com o título da UI).
    log('SCRIPT_VERSION=' + SCRIPT_VERSION);
    // instala o hook de interceptação o quanto antes (questões carregadas via XHR)
    GabaritoInterceptor.instalar();
    // página de saída da impressão: bloqueia o print nativo automático do site
    bloquearPrintAutomatico();

    function iniciarUI() {
        criarUI();
        if (estado.plano) {
            UI.setStatus(estado.plano.matters.length + ' matérias carregadas' + (estado.status === 'pausado' ? ' — retome de onde parou' : ''));
        } else {
            UI.setStatus('Cole seu plano de matérias (JSON) na aba Plano.');
        }
        UI.renderProgresso();
        UI.renderBiblioteca();
    }

    function autoResumir() {
        if (estado.status !== 'rodando') return;
        setTimeout(function () {
            log('Auto-resume: retomando execução interrompida pela navegação (fase ' + estado.fase + ').');
            if (estado.fase === 'coletando' && estado.cadernoAtual && estado.modo === 'sob-demanda') {
                // coleta sob demanda (botão Copiar) — retoma direto, sem mexer no plano
                retomarColetaSobDemanda(estado.cadernoAtual);
            } else {
                processarLote().catch(function (err) {
                    estado.status = 'erro';
                    estado.erro = String(err && err.message || err);
                    estado.fase = 'nenhuma';
                    salvarEstado();
                    log('ERRO: ' + estado.erro);
                    UI.setStatus('Erro: ' + estado.erro);
                    UI.renderProgresso();
                });
            }
        }, 1500);
    }

    /* Boot: lê o estado do IndexedDB ANTES de criar a UI, renderizar o
     * status e disparar o auto-resume — uma única fonte, sem duplicação. */
    carregarEstado().then(function () {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', iniciarUI);
        } else {
            iniciarUI();
        }
        autoResumir();
    });

    window.__TecFabricaUI = UI;
})();
