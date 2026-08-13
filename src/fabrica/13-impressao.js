    /* =====================================================================
     * ENGINE — IMPRESSÃO (réplica do projeto: partes de até 200 questões,
     * extração da página de saída + gabarito oficial do bloco #gabarito)
     * O site tem um saldo diário de impressão (/api/cadernos/impressoes/restantes).
     * Imprimimos até min(saldo, limite configurado). Quando o saldo acaba,
     * a captura por clique assume do ponto em que a impressão parou.
     * =================================================================== */
    function hojeStr() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function saldoImpressaoLocal() {
        if (estado.impressao.data !== hojeStr()) {
            estado.impressao = { data: hojeStr(), usadas: 0 };
        }
        var teto = (estado.config && estado.config.impressaoLimiteDia) ? Number(estado.config.impressaoLimiteDia) : CONFIG.impressaoLimiteDia;
        var usadas = Number(estado.impressao.usadas) || 0;
        return Math.max(0, (teto || 1000) - usadas);
    }

    async function consultarSaldoSite() {
        try {
            var r = await fetch('/api/cadernos/impressoes/restantes', {
                credentials: 'include',
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!r.ok) return -1;
            var d = await r.json();
            return d && typeof d.int === 'number' ? d.int : -1;
        } catch (e) { return -1; }
    }

    function maxNumberColetado(caderno) {
        var max = 0;
        (caderno.questoes || []).forEach(function (q) { if (Number(q.number) > max) max = Number(q.number); });
        return max;
    }

    function htmlAbsoluto(node) {
        // clona e resolve URLs de imagens (mesma ideia do projeto;
        // respeita data-tec-original-src, usado quando imagens são adiadas)
        var clone = node.cloneNode(true);
        Array.from(clone.querySelectorAll('img')).forEach(function (img) {
            var src = img.getAttribute('data-tec-original-src') || img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '';
            if (src && !/^data:/i.test(src)) img.setAttribute('src', new URL(src, location.href).href);
            else if (src) img.setAttribute('src', src);
            var srcset = img.getAttribute('data-tec-original-srcset') || img.getAttribute('srcset') || '';
            if (srcset) {
                img.setAttribute('srcset', srcset.split(',').map(function (c) {
                    var p = c.trim().split(/\s+/);
                    p[0] = new URL(p[0], location.href).href;
                    return p.join(' ');
                }).join(', '));
            }
        });
        clone.querySelectorAll('script, style').forEach(function (n) { n.remove(); });
        return clone.innerHTML.trim();
    }

    /* Bloqueia o window.print() automático que o site dispara na página de saída
       (mesmo comportamento do print-blocker do projeto). Sem isso, o diálogo
       nativo de impressão abriria e interromperia a extração. */
    function bloquearPrintAutomatico() {
        if (!/\/questoes\/cadernos\/\d+\/imprimir/i.test(location.pathname || '')) return;
        try {
            window.print = function () { return undefined; };
        } catch (e) { /* ignorado */ }
    }

    function extrairQuestoesImpressas() {
        // parsePrintedQuestion do projeto, adaptado ao formato da nossa biblioteca
        var saida = [];
        Array.from(document.querySelectorAll('.questao')).forEach(function (source, index) {
            var link = source.querySelector("a[href*='/questoes/']");
            var url = link ? String(link.href || '') : '';
            var idMatch = url.match(/\/questoes\/(\d+)/);
            var info = source.querySelector('.cabecalho .informacoes');
            var blocks = info ? Array.from(info.children || []) : [];
            var headerBlock = blocks.filter(function (b) {
                return !/(linkQuestao|classificacao)/.test(String(b.className || ''));
            })[0];
            var classificacao = source.querySelector('.classificacao');
            var classText = clean(classificacao && (classificacao.innerText || classificacao.textContent));
            var classParts = classText.split(/\s+-\s+/);
            var meta = parseCabecalho(headerBlock && (headerBlock.innerText || headerBlock.textContent));
            var enunciado = source.querySelector('.enunciado');
            var numNode = enunciado ? enunciado.querySelector('strong') : null;
            var numMatch = clean(numNode && (numNode.innerText || numNode.textContent)).match(/^(\d+)\)/);
            var alternativas = Array.from(source.querySelectorAll('.alternativa')).map(function (alt) {
                var raw = clean(alt && (alt.innerText || alt.textContent));
                var lm = raw.match(/^([a-e])\)\s*/i);
                return {
                    letter: lm ? lm[1].toUpperCase() : '',
                    text: raw.replace(/^([a-e])\)\s*/i, ''),
                    html: htmlAbsoluto(alt)
                };
            }).filter(function (o) { return o.letter && o.text; });
            var answerNode = source.querySelector('.gabarito, .resposta-correta');
            var answer = clean(answerNode && (answerNode.innerText || answerNode.textContent));
            var gab = (answer.match(/(?:GABARITO|RESPOSTA|ALTERNATIVA)\s*[:.)-]?\s*([A-E])\b/i) || answer.match(/^([A-E])\s*[:.)-]/i) || []);
            saida.push({
                id: idMatch ? idMatch[1] : 'print-' + (index + 1),
                number: numMatch ? Number(numMatch[1]) : index + 1,
                url: url || (location.origin + '/questoes/' + (idMatch ? idMatch[1] : '')),
                header: meta.raw,
                bank: meta.bank,
                year: meta.year,
                vacancy: meta.vacancy,
                organization: meta.organization,
                role: meta.role,
                subject: clean(classParts.shift()),
                topic: clean(classParts.join(' - ')),
                statement: clean(enunciado && (enunciado.innerText || enunciado.textContent)),
                statementHtml: enunciado ? htmlAbsoluto(enunciado) : '',
                options: alternativas,
                answer: gab[1] ? gab[1].toUpperCase() : '',
                answerSource: gab[1] ? 'print-page' : ''
            });
        });
        return saida;
    }

    function parseGabaritoBloco() {
        // bloco #gabarito no final da página de impressão (#gabarito .resposta)
        var entries = [];
        var nodes = document.querySelectorAll('#gabarito .resposta');
        nodes.forEach(function (node) {
            var numberNode = node.querySelector('strong');
            var rawNumber = numberNode ? String(numberNode.textContent || '') : '';
            var index = Number(rawNumber.replace(/[^\d]/g, ''));
            var answer = String(node.textContent || '').replace(/^\s*\d+\s*\)\s*/, '').trim();
            var gab = (answer.match(/(?:GABARITO|RESPOSTA|ALTERNATIVA)\s*[:.)-]?\s*([A-E])\b/i) || answer.match(/^([A-E])(?:\s*[:.)-]|\s*$)/i) || answer.match(/^[A-E]$/i) || []);
            if (index > 0 && gab[1]) entries.push({ index: index, answer: gab[1].toUpperCase() });
        });
        return entries;
    }

    function aplicarGabaritoBloco(questoes, entries) {
        var byIndex = {};
        entries.forEach(function (e) { if (e.index > 0 && e.answer) byIndex[e.index] = e.answer; });
        return questoes.map(function (q) {
            if (q.answer) return q;
            var a = byIndex[Number(q.number)];
            if (!a) return q;
            q.answer = a;
            q.answerSource = 'print-page';
            return q;
        });
    }

    function consolidarImpressas(caderno, extraidas) {
        var colecao = caderno.questoes || (caderno.questoes = []);
        var porId = {};
        colecao.forEach(function (q) { porId[q.id] = true; });
        var novas = 0;
        extraidas.forEach(function (q) {
            if (porId[q.id]) return;
            porId[q.id] = true;
            colecao.push(q);
            novas += 1;
        });
        caderno.questoes = colecao;
        caderno.coletadas = colecao.length;
        return novas;
    }

    function scopeDoInput(sel) {
        var el = document.querySelector(sel);
        if (!el) return null;
        var angEl = angular.element(el);
        return (typeof angEl.isolateScope === 'function' && angEl.isolateScope()) || (typeof angEl.scope === 'function' && angEl.scope());
    }

    async function submeterParteImpressao(caderno) {
        // página esperada: o caderno. Abre a aba Imprimir e submete a próxima parte.
        var aba = visiveis("div[role=button]").find(function (n) { return mesmoTexto(n.innerText, 'Imprimir'); });
        if (!aba) throw new Error('Aba Imprimir não encontrada no caderno.');
        aba.click();
        await esperar(function () { return !!document.querySelector('#questaoInicialInput'); }, 12000, 'A tela de impressão não abriu.');
        await workerSleep(600);
        var scope = scopeDoInput('#questaoInicialInput');
        if (!scope || !scope.vm) throw new Error('Controller de impressão não encontrado.');
        var primeira = maxNumberColetado(caderno) + 1;
        var total = Number(caderno.total) || (scope.vm.caderno && scope.vm.caderno.numeroTotalQuestoes) || primeira;
        var saldoSite = await consultarSaldoSite();
        var tetoLocal = saldoImpressaoLocal();
        var disponivel = saldoSite >= 0 ? Math.min(saldoSite, tetoLocal) : tetoLocal;
        var count = Math.min(200, Math.max(0, total - primeira + 1), disponivel);
        if (count <= 0) throw new Error('Sem saldo de impressão disponível para esta parte.');
        scope.$apply(function () {
            scope.vm.questaoInicial = primeira;
            scope.vm.calcularQuantidadeMaxima(primeira);
            scope.vm.quantidadeQuestoesGetterSetter(count);
        });
        await workerSleep(600);
        // aguarda o Angular habilitar o botão (totalQuestoesSelecionadas > 0 e saldo > 0)
        await esperar(function () {
            var btn = document.querySelector('#confirmar-button');
            return btn && !btn.disabled;
        }, 8000, 'O botão "Imprimir Caderno" não habilitou.');
        var form = document.querySelector('#configurar-impressao form, form[action*="imprimir"]');
        if (!form) throw new Error('Formulário de impressão não encontrado.');
        form.setAttribute('target', '_self'); // mantém a aba atual (retomável)
        estado.fase = 'impr-saida';
        estado.impressaoParte = { start: primeira, count: count };
        estado.mensagem = 'Imprimindo parte: questões ' + primeira + ' a ' + (primeira + count - 1) + ' (' + count + ').';
        salvarEstado();
        UI.setStatus(estado.mensagem);
        log(estado.mensagem);
        form.submit(); // POST → navega para a página de saída (auto-resume retoma)
    }

    async function processarSaidaImpressao(caderno) {
        // página esperada: /questoes/cadernos/{id}/imprimir (saída)
        var parte = estado.impressaoParte || { start: 1, count: 0 };
        var esperadas = Number(parte.count) || 0;
        await esperar(function () {
            var n = document.querySelectorAll('.questao').length;
            return n > 0 && (!esperadas || n >= esperadas);
        }, 60000, 'A página de impressão não montou as questões esperadas (' + esperadas + ').');
        await workerSleep(400);
        var extraidas = extrairQuestoesImpressas();
        var comGabarito = aplicarGabaritoBloco(extraidas, parseGabaritoBloco());
        var novas = consolidarImpressas(caderno, comGabarito);
        estado.impressao.usadas += comGabarito.length;
        estado.impressaoParte = null;
        caderno.total = caderno.total || (parte.start + comGabarito.length - 1);
        salvarEstado();
        UI.renderBiblioteca();
        UI.renderProgresso();
        log('Impressão: parte salva (' + comGabarito.length + ' questões, ' + novas + ' novas). Acumulado: ' + estado.impressao.usadas + ' hoje.');
        var faltam = (caderno.total || 0) - (caderno.questoes || []).length;
        if (faltam > 0 && saldoImpressaoLocal() > 0) {
            estado.fase = 'impr-caderno';
            estado.mensagem = 'Próxima parte de impressão do caderno ' + caderno.titulo + '.';
            salvarEstado();
            irPara(location.origin + '/questoes/cadernos/' + caderno.id); // navega → auto-resume
            return;
        }
        estado.fase = 'coletando';
        estado.mensagem = 'Impressão concluída/encerrada para "' + caderno.titulo + '". Continuando com captura por clique se faltarem questões.';
        salvarEstado();
    }

