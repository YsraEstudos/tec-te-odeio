# Plano Persistente e Navegável — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preservar o plano colado até uma substituição válida e exibir categorias, matérias e submatérias em uma árvore compacta, totalmente recolhida por padrão.

**Architecture:** A nova camada pura `18-ui-model.js` prepara texto, agrupamento, árvore e HTML seguro sem depender do DOM. `18-ui.js` usa esse modelo para renderizar e para aplicar um novo plano somente depois da normalização; `05-estado.js` acrescenta o texto original ao estado persistido e `salvarEstado(true)` cria o checkpoint imediato. O manifest inclui o fragmento antes da UI, e o build continua gerando o artefato userscript existente.

**Tech Stack:** JavaScript ES5 compatível com userscript, IndexedDB existente, HTML semântico (`details`/`summary`), CSS inline do painel, Node.js built-in test runner.

## Global Constraints

- Não adicionar dependências externas.
- Não alterar o parser de planos nem o orquestrador de execução.
- O texto original será armazenado em `estado.planoTexto`.
- Um estado antigo sem `planoTexto` usará `JSON.stringify(estado.plano, null, 2)` como fallback de edição.
- Categorias, matérias e nós expansíveis devem iniciar sem atributo `open`.
- O carregamento válido deve chamar `salvarEstado(true)`; erro de parsing não pode substituir o plano anterior.
- A largura do painel deve caber em `min(400px, calc(100vw - 20px))` e não pode criar rolagem horizontal.
- Animações de UI devem ficar entre 150 e 300 ms e ser desativadas por `prefers-reduced-motion: reduce`.
- Antes de enviar código, conferir o comprimento completo dos caminhos Windows; os caminhos previstos nesta implementação têm no máximo 123 caracteres.
- O monólito `tec_fabrica_cadernos.user.js` não será editado manualmente; `dist/tec_fabrica_cadernos.user.js` será regenerado pelo build e incluído somente se mudar.

---

### Task 1: Criar o modelo puro da árvore do plano

**Files:**
- Create: `src/fabrica/18-ui-model.js`
- Modify: `src/fabrica/manifest.json` — inserir o fragmento `18-ui-model.js` imediatamente antes de `18-ui.js`
- Create: `test/ui-model.test.mjs`

**Interfaces:**
- Produces `PLANO_UI_MODEL.textoParaEdicao(estado) -> string`.
- Produces `PLANO_UI_MODEL.carregarPlano(texto, normalizar, estado) -> plano`.
- Produces `PLANO_UI_MODEL.agruparPorCategoria(plano) -> Array<{name: string, matters: Array, subjectCount: number}>`.
- Produces `PLANO_UI_MODEL.construirAssuntos(materia) -> Array<{label: string, code: string, children: Array}>`.
- Produces `PLANO_UI_MODEL.renderArvore(plano) -> string` contendo HTML escapado, `<details>` e `<summary>` sem atributo `open`.
- Consumes somente objetos JavaScript e uma função de normalização injetada; não consome `document`, `estado` global ou IndexedDB além do objeto recebido.

- [ ] **Step 1: Escrever os testes vermelhos do modelo**

Criar `test/ui-model.test.mjs` com um carregador VM do novo fragmento e estes comportamentos:

```js
test('mantém o texto colado e usa fallback para estados antigos', () => {
  const model = loadModel();
  const original = '{\n  "materias": []\n}';
  assert.equal(model.textoParaEdicao({ planoTexto: original, plano: { matters: [] } }), original);
  assert.match(model.textoParaEdicao({ plano: { name: 'Plano antigo', matters: [] } }), /Plano antigo/);
  assert.equal(model.textoParaEdicao({ plano: null }), '');
});

test('só substitui o plano depois que a normalização termina', () => {
  const model = loadModel();
  const anterior = { planoTexto: 'anterior', plano: { name: 'Anterior' } };
  assert.throws(() => model.carregarPlano('novo inválido', () => { throw new Error('inválido'); }, anterior), /inválido/);
  assert.deepEqual(anterior, { planoTexto: 'anterior', plano: { name: 'Anterior' } });

  const novo = { name: 'Novo', matters: [] };
  assert.equal(model.carregarPlano('novo válido', () => novo, anterior), novo);
  assert.equal(anterior.planoTexto, 'novo válido');
  assert.equal(anterior.plano, novo);
});

test('agrupa matérias por categoria e cria níveis deduplicados de submatérias', () => {
  const model = loadModel();
  const categorias = model.agruparPorCategoria({ matters: [
    { title: 'Português', group: 'Base', subjectIds: ['1', '2'], subjectPaths: ['Língua > Morfologia', 'Língua > Morfologia > Classes'] },
    { title: 'Direito', group: 'Específica', subjectIds: ['3'], subjectPaths: ['Constitucional'] },
    { title: 'Redação', group: 'Base', subjectIds: ['4'], subjectPaths: ['Língua > Morfologia'] }
  ] });
  assert.deepEqual(categorias.map((item) => item.name), ['Base', 'Específica']);
  assert.equal(categorias[0].matters.length, 2);
  assert.equal(model.construirAssuntos(categorias[0].matters[0]).length, 1);
  assert.equal(model.construirAssuntos(categorias[0].matters[0])[0].children.length, 1);
  assert.equal(model.construirAssuntos(categorias[0].matters[0])[0].children[0].label, 'Morfologia');
});

test('renderiza a árvore recolhida e escapa nomes fornecidos pelo plano', () => {
  const model = loadModel();
  const html = model.renderArvore({ matters: [{ title: '<Português>', group: 'Base', subjectIds: ['1'], subjectPaths: ['Língua > Classes'] }] });
  assert.match(html, /&lt;Português&gt;/);
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.doesNotMatch(html, /<details[^>]+open/);
});
```

- [ ] **Step 2: Rodar os testes para confirmar a falha correta**

Run: `node --test test/ui-model.test.mjs`

Expected: FAIL porque `src/fabrica/18-ui-model.js` ainda não existe; nenhum teste deve ser omitido ou marcado como falso positivo.

- [ ] **Step 3: Implementar o modelo mínimo**

Criar o fragmento com estas regras:

```js
var PLANO_UI_MODEL = {
    textoParaEdicao: function (estado) {
        if (estado && typeof estado.planoTexto === 'string' && estado.planoTexto.trim()) return estado.planoTexto;
        return estado && estado.plano ? JSON.stringify(estado.plano, null, 2) : '';
    },
    carregarPlano: function (texto, normalizar, estado) {
        var plano = normalizar(texto);
        estado.planoTexto = String(texto == null ? '' : texto);
        estado.plano = plano;
        return plano;
    }
};
```

Completar o objeto com `agruparPorCategoria`, `construirAssuntos` e `renderArvore`: agrupar pela chave `matter.group || 'Sem categoria'`, preservar a ordem da primeira ocorrência, dividir cada `subjectPaths` por `>`, reutilizar nós com o mesmo rótulo no mesmo nível, associar `subjectIds[index]` à folha e criar uma folha “Assunto sem caminho” quando existir código sem caminho. Escapar `&`, `<`, `>`, `"` e `'` antes de inserir qualquer valor no HTML. Os nós de categoria e matéria devem usar `<details class="tf-tree-node ..."><summary ...>` sem `open`.

Adicionar ao manifest a entrada:

```json
{
  "id": "18-model",
  "file": "18-ui-model.js",
  "section": "UI — modelo puro da árvore do plano",
  "lines": ""
}
```

O campo `lines` pode permanecer vazio porque o build não o utiliza; não alterar a ordem dos outros fragmentos.

- [ ] **Step 4: Rodar os testes do modelo em verde**

Run: `node --test test/ui-model.test.mjs`

Expected: todos os testes deste arquivo PASS, incluindo a ausência de `open` no HTML e a preservação do objeto anterior quando a normalização lança erro.

- [ ] **Step 5: Commitar a unidade isolada**

```powershell
git add -- src/fabrica/18-ui-model.js src/fabrica/manifest.json test/ui-model.test.mjs
git commit -m "feat: adiciona modelo da arvore do plano"
```

### Task 2: Persistir o texto original do plano no estado

**Files:**
- Modify: `src/fabrica/06-persistencia.js` — incluir `planoTexto: ''` em `estadoVazio()` e expor a função no hook de teste existente
- Modify: `test/persistence.test.mjs` — cobrir estado novo e reconstrução v2

**Interfaces:**
- `estadoVazio()` passa a produzir `planoTexto: ''`.
- `reconstruirEstadoV2(meta, cadernos, questoes)` preserva `meta.planoTexto` quando presente.
- Estados v2 antigos continuam válidos mesmo sem `planoTexto`; o fallback de texto fica no modelo da Task 1.

- [ ] **Step 1: Escrever os testes vermelhos de persistência**

Adicionar ao teste existente:

```js
test('estado vazio inicializa texto do plano e v2 preserva texto original', () => {
  const hooks = loadHooks();
  assert.equal(hooks.estadoVazio().planoTexto, '');
  const restored = hooks.reconstruirEstadoV2(
    { key: 'state', schema: 2, planoTexto: '{"materias":[]}' },
    [],
    []
  );
  assert.equal(restored.planoTexto, '{"materias":[]}');
});
```

- [ ] **Step 2: Rodar o teste para confirmar a falha**

Run: `node --test test/persistence.test.mjs`

Expected: FAIL porque `estadoVazio` ainda não está exposto e o campo ainda não faz parte do estado inicial.

- [ ] **Step 3: Implementar o contrato persistente**

Adicionar `planoTexto: ''` ao retorno de `estadoVazio()` em `06-persistencia.js`, antes de `config`. O reconstrutor v2 já copia campos de metadados que não sejam `key`/`schema`, portanto não criar uma nova store nem elevar `IDB_VERSION`; apenas expor `estadoVazio: estadoVazio` em `window.__TecFabricaPersistence` para a regressão unitária.

- [ ] **Step 4: Rodar a suíte de persistência em verde**

Run: `node --test test/persistence.test.mjs`

Expected: todos os testes PASS, incluindo os casos existentes de sanitização, índices, migração e debounce.

- [ ] **Step 5: Commitar a persistência**

```powershell
git add -- src/fabrica/06-persistencia.js test/persistence.test.mjs
git commit -m "fix: persiste texto original do plano"
```

### Task 3: Integrar o carregamento e o re-render da aba Plano

**Files:**
- Modify: `src/fabrica/18-ui.js` — texto persistido, árvore, checkpoint crítico e CSS responsivo
- Create: `test/ui-integration.test.mjs` — contratos estáticos de integração do fragmento
- Create: `test/plano-persistente-flow.test.mjs` — ciclo comportamental de normalização, persistência e re-render em VM

**Interfaces:**
- `htmlPlano()` chama `PLANO_UI_MODEL.textoParaEdicao(estado)` e `PLANO_UI_MODEL.renderArvore(estado.plano)`.
- O handler de `#tf-carregar` chama `PLANO_UI_MODEL.carregarPlano(texto, normalizarPlano, estado)` e depois `salvarEstado(true)`.
- O `catch` do handler não altera `estado.plano` nem `estado.planoTexto`.

- [ ] **Step 1: Escrever os testes vermelhos de integração**

Criar `test/ui-integration.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/fabrica/18-ui.js'), 'utf8');

test('aba Plano reutiliza texto persistido e renderiza a árvore', () => {
  assert.match(source, /PLANO_UI_MODEL\.textoParaEdicao\(estado\)/);
  assert.match(source, /PLANO_UI_MODEL\.renderArvore\(p\)/);
  assert.match(source, /escapeHtml\(texto\)/);
});

test('carregar plano usa atualização atômica e checkpoint imediato', () => {
  assert.match(source, /PLANO_UI_MODEL\.carregarPlano\(texto, normalizarPlano, estado\)/);
  assert.match(source, /salvarEstado\(true\)/);
});

test('painel é responsivo e respeita movimento reduzido', () => {
  assert.match(source, /min\(400px,calc\(100vw - 20px\)\)/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /tf-tree-node/);
});
```

- [ ] **Step 2: Rodar os testes para confirmar a falha**

Run: `node --test test/ui-integration.test.mjs`

Expected: FAIL porque a UI ainda deixa o textarea vazio, não usa o modelo e não contém os estilos da árvore.

- [ ] **Step 3: Integrar o estado persistido no HTML e no handler**

Em `htmlPlano()`, calcular `texto` com `PLANO_UI_MODEL.textoParaEdicao(estado)`, escapar seu conteúdo dentro do `<textarea>` e inserir `PLANO_UI_MODEL.renderArvore(p)` após o resumo. Usar um `<label for="tf-plano-texto">` para o editor e manter a área de aviso existente.

No listener de `#tf-carregar`, substituir as atribuições diretas por:

```js
var plano = PLANO_UI_MODEL.carregarPlano(texto, normalizarPlano, estado);
if (!estado.config) {
    // preservar exatamente a configuração padrão já existente
}
salvarEstado(true);
```

Não limpar o textarea no `catch`; como `carregarPlano` normaliza antes de mutar, o estado anterior permanece intacto quando o JSON é inválido. O segundo carregamento válido substitui `planoTexto` e `plano` normalmente.

- [ ] **Step 4: Aplicar a direção visual compacta**

Atualizar somente os estilos do painel em `UI_CSS`:

```css
#tec-fabrica {
  width: min(400px,calc(100vw - 20px));
  right: 10px;
  max-height: min(88vh,720px);
  font-family: "Fira Sans", "Segoe UI", sans-serif;
}
#tec-fabrica .tf-plano-arvore { display:flex; flex-direction:column; gap:6px; margin-top:10px; }
#tec-fabrica .tf-tree-node { border:1px solid #1e293b; border-radius:9px; background:#0f172a; overflow:hidden; }
#tec-fabrica .tf-tree-node > summary { display:flex; align-items:center; gap:7px; min-height:38px; padding:8px 9px; color:#e2e8f0; cursor:pointer; list-style:none; user-select:none; }
#tec-fabrica .tf-tree-node > summary::-webkit-details-marker { display:none; }
#tec-fabrica .tf-tree-node > summary:focus-visible { outline:2px solid #60a5fa; outline-offset:-2px; }
#tec-fabrica .tf-tree-node[open] > summary { background:#172554; }
#tec-fabrica .tf-tree-children { padding:0 7px 7px 16px; animation:tf-tree-in 220ms ease-out both; }
@keyframes tf-tree-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  #tec-fabrica *, #tec-fabrica *::before, #tec-fabrica *::after { animation-duration:.01ms !important; transition-duration:.01ms !important; }
}
```

Adicionar também classes para chevron SVG, contagens, metadados de matéria e folhas de assunto; limitar `overflow-x` no corpo e usar `word-break:break-word` nos títulos longos. Não usar emojis como ícones novos.

- [ ] **Step 5: Rodar os testes de integração em verde**

Run: `node --test test/ui-integration.test.mjs`

Expected: todos os testes PASS, confirmando persistência no re-render, checkpoint imediato, largura responsiva e suporte a movimento reduzido.

Rodar também `node --test test/plano-persistente-flow.test.mjs` para validar o fluxo com o normalizador e modelo reais: primeiro plano válido, restauração do estado, segundo plano válido e plano inválido sem apagar o estado nem o texto do último plano válido.

- [ ] **Step 6: Commitar a integração visual e funcional**

```powershell
git add -- src/fabrica/18-ui.js test/ui-integration.test.mjs
git commit -m "feat: exibe plano em arvore compacta e persistente"
```

### Task 4: Gerar o artefato e validar o comportamento completo

**Files:**
- Modify: `dist/tec_fabrica_cadernos.user.js` — gerado por `scripts/build.mjs` se o conteúdo mudar
- Verify: `src/fabrica/manifest.json`, todos os testes existentes e novos testes

**Interfaces:**
- O artefato final mantém `@version 2.0.0`, `SCRIPT_VERSION`, `window.__TecFabrica`, `window.__TecFabricaExport` e `window.__TecFabricaUI`.
- Nenhum diagnóstico é incluído no build limpo.

- [ ] **Step 1: Gerar o dist**

Run: `node scripts/build.mjs`

Expected: exit code 0, validação dos fragmentos e escrita de `dist/tec_fabrica_cadernos.user.js`.

- [ ] **Step 2: Verificar sintaxe do artefato**

Run: `node --check dist/tec_fabrica_cadernos.user.js`

Expected: exit code 0 e nenhuma mensagem de erro de sintaxe.

- [ ] **Step 3: Rodar todos os testes**

Run: `node --test test/*.test.mjs scripts/*.test.mjs`

Expected: todos os testes existentes e novos PASS, inclusive build, persistência, diagnósticos e exportação.

- [ ] **Step 4: Conferir o diff e os artefatos gerados**

Run: `git diff --check`

Run: `git status --short`

Expected: sem erro de whitespace; somente os fragmentos, testes, documentação/manifest e `dist` gerado pela tarefa aparecem como modificados. `tec_fabrica_cadernos.user.js` permanece sem alteração manual.

- [ ] **Step 5: Fazer a verificação manual disponível**

No ambiente autenticado do Tec Concursos, instalar/recarregar o userscript `dist/tec_fabrica_cadernos.user.js` e verificar nesta sequência: colar plano válido e carregar; confirmar resumo e árvore toda fechada; abrir uma categoria e uma matéria; trocar para Config e voltar para Plano; recarregar a página; confirmar que texto, resumo e árvore continuam presentes; colar um segundo plano válido e confirmar substituição; tentar um JSON inválido e confirmar que o plano anterior permanece.

- [ ] **Step 6: Commitar o artefato final após evidência**

```powershell
git add -- dist/tec_fabrica_cadernos.user.js
git commit -m "chore: gera userscript com plano persistente"
```

Não incluir arquivos de `.superpowers/sdd` neste commit.

Só marcar a implementação como concluída se os comandos de build, sintaxe, suíte completa e `git diff --check` tiverem saída bem-sucedida; se a verificação manual não estiver disponível, relatar essa limitação separadamente.
