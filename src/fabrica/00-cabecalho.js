// ==UserScript==
// @name         Tec Concursos — Fábrica de Cadernos
// @namespace    tec-fabrica-cadernos-v2
// @version      1.1.0
// @description  Cria cadernos em lote a partir de um plano de matérias (com bancas e anos), coleta cada questão com o gabarito oficial e exporta HTML interativo + Excel completos.
// @author       voce
// @match        https://www.tecconcursos.com.br/questoes/*
// @match        https://www.google.com/recaptcha/api2/anchor*
// @match        https://www.recaptcha.net/recaptcha/api2/anchor*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* =========================================================================
 * TEC CONCURSOS — FÁBRICA DE CADERNOS
 * -------------------------------------------------------------------------
 * Mecanismos validados ao vivo (12/08/2026):
 *  - Filtros: abas .menu-alternador-opcao; busca "Pesquisar por nome";
 *    itens .arvore-item (.arvore-item-conteudo é o alvo do clique);
 *    atalhos [role=button].link-atalho ("Remover anuladas"/"Remover desatualizadas");
 *    contador .gerador-filtrador strong.ng-binding.
 *  - Criação: #nomeCadernoId (ng-model sincroniza no blur), #pastaCadernosId,
 *    botão "Gerar Caderno" (vm.gerarCaderno()).
 *  - Coleta: article.questao-enunciado → .questao-enunciado-texto (HTML),
 *    ul.questao-enunciado-alternativas > label.questao-enunciado-alternativa
 *    (.questao-enunciado-alternativa-opcao = letra, -texto = conteúdo);
 *    navegação via $rootScope.$broadcast('abrir-questao', N);
 *    contador .questao-cabecalho-informacoes-numero ("Questão X de Y").
 *  - Gabarito: marcar alternativa (radio) → clicar "RESOLVER QUESTÃO" →
 *    ler "a correta é: X" / "Gabarito: X" em .questao-enunciado-resolucao.
 *  - Exportação: HTML interativo escuro e XLSX com imagens embutidas,
 *    réplica fiel dos templates do projeto "Tecconcursos" do usuário.
 * ========================================================================= */
(function () {
    'use strict';

    /* =====================================================================
     * AUTO-CLIQUE NO reCAPTCHA (quando executado no iframe do Google)
     * =================================================================== */
    if (/(google\.com|recaptcha\.net)$/i.test(location.hostname) && /\/recaptcha\/api2\/anchor/i.test(location.pathname)) {
        (function autoClicarRecaptcha() {
            var tentativas = 0;
            var maxTentativas = 60;
            var iv = setInterval(function () {
                tentativas += 1;
                var anchor = document.getElementById('recaptcha-anchor');
                var border = document.querySelector('.recaptcha-checkbox-border');
                var checkbox = border || anchor;
                if (checkbox) {
                    var marcado = (anchor && anchor.getAttribute('aria-checked') === 'true') ||
                                  (anchor && anchor.classList.contains('recaptcha-checkbox-checked'));
                    var desabilitado = anchor && anchor.getAttribute('aria-disabled') === 'true';
                    if (marcado) {
                        clearInterval(iv);
                        return;
                    }
                    if (!desabilitado) {
                        clearInterval(iv);
                        setTimeout(function () {
                            try {
                                checkbox.click();
                                console.log('[TecFabrica] Checkbox do reCAPTCHA (.recaptcha-checkbox-border) clicado automaticamente.');
                            } catch (e) {
                                try {
                                    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                } catch (e2) {}
                            }
                        }, 350 + Math.floor(Math.random() * 350));
                    }
                }
                if (tentativas >= maxTentativas) {
                    clearInterval(iv);
                }
            }, 100);
        })();
        return;
    }

    // Nunca inicializa a máquina de estado em login, conta ou outras áreas.
    // Isso evita retomadas e navegações enquanto a sessão está inválida.
    if (location.hostname === 'www.tecconcursos.com.br' && !/^\/questoes(?:\/|$)/i.test(location.pathname)) return;

    // Versão do script — espelha @version no cabeçalho do userscript; logada
    // no Console na inicialização para conferir a cópia em execução.
    var SCRIPT_VERSION = '1.1.0';
