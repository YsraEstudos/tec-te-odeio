    /* =====================================================================
     * EXTRAÇÃO DA QUESTÃO (DOM, HTML limpo + metadados)
     * =================================================================== */
    var ATRIBUTOS_PERMITIDOS = new Set(['style', 'src', 'alt', 'href', 'colspan', 'rowspan', 'width', 'height', 'align', 'valign', 'border', 'cellpadding', 'cellspacing', 'title']);

    function limparHtml(el) {
        var clone = el.cloneNode(true);
        clone.querySelectorAll('script, style, iframe, button, input, select, textarea, form, noscript, .questao-enunciado-resolucao')
            .forEach(function (n) { n.remove(); });
        clone.querySelectorAll('*').forEach(function (n) {
            Array.prototype.slice.call(n.attributes || []).forEach(function (a) {
                if (!ATRIBUTOS_PERMITIDOS.has(a.name)) n.removeAttribute(a.name);
            });
            if (n.tagName === 'IMG') {
                var src = n.getAttribute('src');
                if (src) n.setAttribute('src', new URL(src, location.href).href);
            }
            if (n.tagName === 'A') {
                var href = n.getAttribute('href');
                if (href && !/^https?:/i.test(href)) n.removeAttribute('href');
            }
        });
        return clone.innerHTML.trim();
    }

    function textoDe(el) {
        return el ? clean(el.innerText || el.textContent) : '';
    }

    function parseCabecalho(valor) {
        // "#1646838 FCC - 2024 - Técnico Judiciário (TRT 11ª)/Administrativa/Cargo" →
        // bank=FCC, year=2024, vacancy=..., organization=..., role=...
        var header = clean(valor).replace(/^#?\s*\d{4,10}\s*/, '');
        var pieces = header.split('/').map(clean).filter(Boolean);
        var first = pieces.shift() || '';
        var firstSplit = first.split(/\s+-\s+/);
        var bank = clean(firstSplit.shift());
        var vacancy = clean(firstSplit.join(' - '));
        var year = null;
        var firstYear = vacancy.match(/\b(19|20)\d{2}\b/);
        if (firstYear) {
            year = Number(firstYear[0]);
            vacancy = clean(vacancy.replace(firstYear[0], '').replace(/^\s*-\s*|\s*-\s*$/g, ''));
        }
        var last = pieces.length ? pieces[pieces.length - 1] : '';
        var lastYear = last.match(/\b(19|20)\d{2}\b/);
        if (lastYear && year == null) year = Number(lastYear[0]);
        if (lastYear) pieces[pieces.length - 1] = clean(last.replace(lastYear[0], '').replace(/^\s*-\s*|\s*-\s*$/g, ''));
        pieces = pieces.filter(Boolean);
        return {
            raw: header,
            bank: bank,
            vacancy: vacancy,
            organization: pieces.shift() || '',
            role: pieces.join(' / '),
            year: year
        };
    }

    function extrairQuestaoAtual() {
        var art = document.querySelector('article.questao-enunciado');
        if (!art) {
            log('Questão ainda não disponível no DOM.', {
                tipo: 'observacao', nivel: 'warn', fase: 'coletando',
                contexto: { resultado: 'sem-artigo' }
            });
            return null;
        }

        var h1 = document.querySelector('h1');
        var idm = h1 ? h1.textContent.match(/#(\d+)/) : null;
        var pos = lerPosicao();

        var headerEl = art.querySelector('.questao-enunciado-concurso') || document.querySelector('.questao-cabecalho h1, h1');
        var meta = parseCabecalho(textoDe(headerEl));

        var materiaEl = document.querySelector('.questao-cabecalho-informacoes-materia');
        var assuntoEl = document.querySelector('.questao-cabecalho-informacoes-assunto');

        var txt = art.querySelector('.questao-enunciado-texto');
        var alternativas = Array.prototype.map.call(
            art.querySelectorAll('.questao-enunciado-alternativa'),
            function (li) {
                var letraEl = li.querySelector('.questao-enunciado-alternativa-opcao');
                var textoEl = li.querySelector('.questao-enunciado-alternativa-texto');
                var letra = letraEl ? textoDe(letraEl).replace(/[.):]\s*$/, '') : '';
                return {
                    letter: letra,
                    text: textoEl ? clean(textoEl.innerText || textoEl.textContent) : '',
                    html: textoEl ? limparHtml(textoEl) : ''
                };
            }
        ).filter(function (o) { return o.letter; });

        // URL da questão (link no h1)
        var linkQ = h1 ? h1.querySelector("a[href*='/questoes/']") : null;
        var urlQ = linkQ ? linkQ.href : (location.origin + '/questoes/' + (idm ? idm[1] : ''));

        var questao = {
            id: idm ? idm[1] : null,
            number: pos ? pos.posicao : null,
            total: pos ? pos.total : null,
            url: urlQ,
            header: meta.raw,
            bank: meta.bank,
            year: meta.year,
            vacancy: meta.vacancy,
            organization: meta.organization,
            role: meta.role,
            subject: clean((materiaEl ? materiaEl.innerText : '').replace(/^Mat[ée]ria:\s*/i, '')),
            topic: clean((assuntoEl ? assuntoEl.innerText : '').replace(/^Assunto:\s*/i, '')),
            statement: txt ? clean(txt.innerText || txt.textContent) : '',
            statementHtml: txt ? limparHtml(txt) : '',
            options: alternativas
        };
        log('Questão extraída do DOM.', {
            tipo: 'observacao', fase: 'coletando',
            contexto: {
                questaoId: questao.id,
                numero: questao.number,
                total: questao.total,
                opcoes: questao.options.length,
                materia: questao.subject,
                assunto: questao.topic,
                enunciadoCaracteres: questao.statement.length
            }
        });
        return questao;
    }

