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
        var indices = {};
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
                return '<details class="tf-tree-node tf-tree-subject"><summary class="tf-tree-label">' + label + '</summary>' + renderAssuntos(node.children) + '</details>';
            }
            return '<div class="tf-tree-leaf" data-code="' + escaparHtml(node.code) + '">' + label + '</div>';
        }).join('');
    }

    function renderArvore(plano) {
        return agruparPorCategoria(plano).map(function (categoria) {
            var matters = categoria.matters.map(function (matter) {
                return '<details class="tf-tree-node tf-tree-matter"><summary class="tf-tree-label">' + escaparHtml(matter && matter.title) + '</summary>' + renderAssuntos(construirAssuntos(matter)) + '</details>';
            }).join('');
            return '<details class="tf-tree-node tf-tree-category"><summary class="tf-tree-label">' + escaparHtml(categoria.name) + '</summary>' + matters + '</details>';
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
