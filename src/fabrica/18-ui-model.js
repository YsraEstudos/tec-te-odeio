/* =====================================================================
 * UI — modelo puro da árvore do plano
 * =================================================================== */
(function (root) {
    'use strict';

    function texto(value) {
        return String(value == null ? '' : value);
    }

    function escaparHtml(value) {
        return texto(value).replace(/[&<>"']/g, function (caractere) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[caractere];
        });
    }

    function chevronSvg() {
        return '<svg class="tf-tree-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    }

    function quantidadeTexto(count, singular, plural) {
        return texto(count) + ' ' + (count === 1 ? singular : plural);
    }

    function codigoHtml(code) {
        if (code == null || texto(code) === '') return '';
        return '<span class="tf-tree-code">' + escaparHtml(code) + '</span>';
    }

    function metaCodigoHtml(code) {
        var codigo = codigoHtml(code);
        return codigo ? '<span class="tf-tree-meta">Código ' + codigo + '</span>' : '';
    }

    function resumoHtml(label, meta) {
        return '<summary class="tf-tree-label">' + chevronSvg() + '<span class="tf-tree-label-text">' + escaparHtml(label) + '</span>' + (meta || '') + '</summary>';
    }

    function quantidadeAssuntos(matter) {
        return Math.max(lista(matter && matter.subjectIds).length, lista(matter && matter.subjectPaths).length);
    }

    function lista(value) {
        return Array.isArray(value) ? value : new Array();
    }

    function encontrarOuCriar(nodes, label) {
        var i;
        for (i = 0; i < nodes.length; i += 1) {
            if (nodes[i].label === label) return nodes[i];
        }
        var node = { label: label, code: '', children: new Array() };
        nodes.push(node);
        return node;
    }

    function construirAssuntos(materia) {
        var roots = new Array();
        var paths = lista(materia && materia.subjectPaths);
        var ids = lista(materia && materia.subjectIds);
        var i;

        for (i = 0; i < paths.length; i += 1) {
            var partes = texto(paths[i]).split('>').map(function (parte) { return parte.trim(); }).filter(Boolean);
            if (!partes.length) {
                if (ids[i] != null && texto(ids[i]) !== '') roots.push({ label: 'Assunto sem caminho', code: texto(ids[i]), children: new Array() });
                continue;
            }
            var nivel = roots;
            var node = null;
            var j;
            for (j = 0; j < partes.length; j += 1) {
                node = encontrarOuCriar(nivel, partes[j]);
                nivel = node.children;
            }
            if (node && ids[i] != null) node.code = texto(ids[i]);
        }

        for (i = paths.length; i < ids.length; i += 1) {
            if (ids[i] == null || texto(ids[i]) === '') continue;
            roots.push({ label: 'Assunto sem caminho', code: texto(ids[i]), children: new Array() });
        }
        return roots;
    }

    function agruparPorCategoria(plano) {
        var categorias = new Array();
        var matters = lista(plano && plano.matters);
        var indices = Object.create(null);
        matters.forEach(function (matter) {
            var name = matter && matter.group ? texto(matter.group) : 'Sem categoria';
            var categoria = indices[name];
            if (!categoria) {
                categoria = { name: name, matters: [], subjectCount: 0 };
                indices[name] = categoria;
                categorias.push(categoria);
            }
            categoria.matters.push(matter);
            categoria.subjectCount += lista(matter && matter.subjectIds).length;
        });
        return categorias;
    }

    function renderAssuntos(nodes) {
        return nodes.map(function (node) {
            var label = escaparHtml(node.label);
            if (node.children.length) {
                return '<details class="tf-tree-node tf-tree-subject">' + resumoHtml(node.label, metaCodigoHtml(node.code)) + '<div class="tf-tree-children">' + renderAssuntos(node.children) + '</div></details>';
            }
            return '<div class="tf-tree-leaf" data-code="' + escaparHtml(node.code) + '"><span class="tf-tree-label-text">' + label + '</span>' + metaCodigoHtml(node.code) + '</div>';
        }).join('');
    }

    function badgeStatusHtml(status) {
        if (!status) return '';
        return '<span class="tf-tree-badge tf-tree-badge-' + escaparHtml(status.tipo) + '">' + escaparHtml(status.rotulo) + '</span>';
    }

    function acoesMateriaHtml(status, indice) {
        if (!status) return '';
        var acoes = '<button type="button" class="tf-tree-acao" data-acao="executar-materia" data-indice="' + indice + '" title="Executar a partir desta matéria">▶</button>';
        if (status.temCaderno) {
            acoes += '<button type="button" class="tf-tree-acao" data-acao="refazer-materia" data-indice="' + indice + '" title="Refazer esta matéria (recolhe as questões)">↺</button>';
        }
        return acoes;
    }

    function renderArvore(plano, statusMap) {
        var indice = 0;
        return agruparPorCategoria(plano).map(function (categoria) {
            var matters = categoria.matters.map(function (matter) {
                var status = statusMap ? statusMap[indice] : null;
                var meta = '<span class="tf-tree-meta">' + codigoHtml(matter && matter.code) + '<span class="tf-tree-subject-count">' + quantidadeTexto(quantidadeAssuntos(matter), 'assunto', 'assuntos') + '</span>' + badgeStatusHtml(status) + acoesMateriaHtml(status, indice) + '</span>';
                indice += 1;
                return '<details class="tf-tree-node tf-tree-matter">' + resumoHtml(matter && matter.title, meta) + '<div class="tf-tree-children">' + renderAssuntos(construirAssuntos(matter)) + '</div></details>';
            }).join('');
            return '<details class="tf-tree-node tf-tree-category">' + resumoHtml(categoria.name, '<span class="tf-tree-count">' + quantidadeTexto(categoria.matters.length, 'matéria', 'matérias') + '</span>') + '<div class="tf-tree-children">' + matters + '</div></details>';
        }).join('');
    }

    var PLANO_UI_MODEL = {
        textoParaEdicao: function (estado) {
            if (estado && typeof estado.planoTexto === 'string' && estado.planoTexto.trim()) return estado.planoTexto;
            return estado && estado.plano ? JSON.stringify(estado.plano, null, 2) : '';
        },
        carregarPlano: function (textoColado, normalizar, estado) {
            var plano = normalizar(textoColado);
            estado.planoTexto = String(textoColado == null ? '' : textoColado);
            estado.plano = plano;
            return plano;
        },
        agruparPorCategoria: agruparPorCategoria,
        construirAssuntos: construirAssuntos,
        renderArvore: renderArvore
    };

    if (root) root.PLANO_UI_MODEL = PLANO_UI_MODEL;
    if (typeof module !== 'undefined' && module.exports) module.exports = PLANO_UI_MODEL;
}(typeof window !== 'undefined' ? window : this));
