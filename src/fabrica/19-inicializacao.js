    /* =====================================================================
     * INICIALIZAÇÃO
     * =================================================================== */
    // linha distintiva de inicialização: permite conferir no Console qual
    // versão do script está em execução (combina com o título da UI).
    log('SCRIPT_VERSION=' + SCRIPT_VERSION);
    log('Boot do script iniciado.', {
        tipo: 'observacao', fase: 'inicializando',
        contexto: { pagina: paginaAtual(), status: estado.status, faseAnterior: estado.fase, logsPersistidos: Array.isArray(estado.logs) ? estado.logs.length : 0 }
    });
    // instala o hook de interceptação o quanto antes (questões carregadas via XHR)
    GabaritoInterceptor.instalar();
    log('Interceptação de gabarito instalada.', {
        tipo: 'resultado', nivel: 'ok', fase: 'inicializando', contexto: { instalado: GabaritoInterceptor.instalado }
    });

    function iniciarUI() {
        log('Interface iniciada com o estado carregado.', {
            tipo: 'resultado', nivel: 'ok', fase: 'inicializando',
            contexto: { temPlano: !!estado.plano, materias: estado.plano ? estado.plano.matters.length : 0, status: estado.status }
        });
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
        if (estado.status !== 'rodando') {
            log('Auto-retomada não acionada porque o estado não está rodando.', {
                tipo: 'decisao', fase: 'inicializando', contexto: { status: estado.status, fase: estado.fase }
            });
            return;
        }
        log('Auto-retomada agendada após o boot.', {
            tipo: 'decisao', fase: 'inicializando', contexto: { fase: estado.fase, modo: estado.modo, cadernoId: estado.cadernoAtual ? estado.cadernoAtual.id : null }
        });
        setTimeout(function () {
            log('Auto-retomada executando a fase persistida.', {
                tipo: 'tentativa', fase: estado.fase || 'nenhuma', contexto: { modo: estado.modo, cadernoId: estado.cadernoAtual ? estado.cadernoAtual.id : null }
            });
            if (estado.fase === 'coletando' && estado.cadernoAtual && estado.modo === 'sob-demanda') {
                // coleta sob demanda (botão Copiar) — retoma direto, sem mexer no plano
                retomarColetaSobDemanda(estado.cadernoAtual);
            } else {
                processarLote().catch(function (err) {
                    estado.status = 'erro';
                    estado.erro = String(err && err.message || err);
                    estado.fase = 'nenhuma';
                    salvarEstado();
                    log('Auto-retomada terminou com erro.', {
                        tipo: 'erro', nivel: 'erro', fase: 'inicializando', contexto: { motivo: estado.erro, faseAnterior: estado.fase }
                    });
                    UI.setStatus('Erro: ' + estado.erro);
                    UI.renderProgresso();
                });
            }
        }, 1500);
    }

    /* Boot: lê o estado do IndexedDB ANTES de criar a UI, renderizar o
     * status e disparar o auto-resume — uma única fonte, sem duplicação. */
    carregarEstado().then(function () {
        log('Estado persistido carregado; preparando a interface e a retomada.', {
            tipo: 'resultado', nivel: 'ok', fase: 'inicializando',
            contexto: { status: estado.status, fase: estado.fase, planIndex: estado.planIndex, logsPersistidos: Array.isArray(estado.logs) ? estado.logs.length : 0 }
        });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', iniciarUI);
        } else {
            iniciarUI();
        }
        autoResumir();
    });

    window.__TecFabricaUI = UI;
})();
