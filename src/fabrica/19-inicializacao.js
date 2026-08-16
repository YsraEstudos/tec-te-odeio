/* =====================================================================
     * INICIALIZAÇÃO
     * =================================================================== */
    var autoResumeTimer = null;

    // Discreção antes de qualquer outra coisa: bloqueia trackers de terceiros
    // e oculta sinais de automação do navegador.
    if (typeof bloquearTelemetria === 'function') bloquearTelemetria();
    if (typeof mascararFingerprint === 'function') mascararFingerprint();

    function instalarAtalhoPainel() {
        try {
            document.addEventListener('keydown', function (e) {
                if (e.altKey && e.shiftKey && e.code === 'KeyF') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof alternarPainel === 'function') alternarPainel();
                }
            });
        } catch (e) {}
    }

    function cancelarAutoResumir() {
        if (autoResumeTimer === null) return;
        clearTimeout(autoResumeTimer);
        autoResumeTimer = null;
        log('Auto-retomada pendente cancelada.', {
            tipo: 'decisao', nivel: 'info', fase: estado.fase || 'nenhuma',
            contexto: { motivo: 'pausa-ou-nova-acao-do-usuario' }
        });
    }

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
        instalarAtalhoPainel();
        if (estado.plano) {
            UI.setStatus(estado.plano.matters.length + ' matérias carregadas' + (estado.status === 'pausado' ? ' — retome de onde parou' : ''));
        } else {
            UI.setStatus('Cole seu plano de matérias (JSON) na aba Plano.');
        }
        UI.renderProgresso();
        UI.renderBiblioteca();
    }

    function autoResumir() {
        if (estado.status === 'pausado' && estado.fase === 'pasta-check' && estado.pausaManual !== true) {
            estado.status = 'rodando';
            estado.pausaManual = false;
            estado.erro = null;
            salvarEstado(true);
            UI.renderProgresso();
            log('Auto-retomada de pausa legada acionada para destravar a verificação da pasta.', {
                tipo: 'decisao', nivel: 'ok', fase: 'pasta-check',
                contexto: { planIndex: estado.planIndex, motivo: 'pausa-legada-sem-marcador-manual' }
            });
        }
        if (estado.status !== 'rodando') {
            log('Auto-retomada não acionada porque o estado não está rodando.', {
                tipo: 'decisao', fase: 'inicializando', contexto: { status: estado.status, fase: estado.fase }
            });
            return;
        }
        log('Auto-retomada agendada após o boot.', {
            tipo: 'decisao', fase: 'inicializando', contexto: { fase: estado.fase, modo: estado.modo, cadernoId: estado.cadernoAtual ? estado.cadernoAtual.id : null }
        });
        cancelarAutoResumir();
        autoResumeTimer = setTimeout(function () {
            autoResumeTimer = null;
            if (estado.status !== 'rodando') {
                log('Auto-retomada ignorada porque a execução foi pausada antes do timer.', {
                    tipo: 'decisao', nivel: 'info', fase: estado.fase || 'nenhuma',
                    contexto: { status: estado.status }
                });
                return;
            }
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
    if (typeof ocultarGlobal === 'function') ocultarGlobal('__TecFabricaUI', window.__TecFabricaUI);
})();
