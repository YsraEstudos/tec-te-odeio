# Task 2 — Persistir o texto original do plano no estado

## Status

Implementação concluída em `src/fabrica/06-persistencia.js`, com regressão em `test/persistence.test.mjs`.

## TDD

### RED

Teste adicionado:

```text
estado vazio inicializa texto do plano e v2 preserva texto original
```

Comando executado:

```powershell
node --test test/persistence.test.mjs
```

Saída relevante:

```text
✔ 7 testes
✖ estado vazio inicializa texto do plano e v2 preserva texto original
TypeError: hooks.estadoVazio is not a function
ℹ tests 8
ℹ pass 7
ℹ fail 1
```

A falha foi a esperada: o hook de teste ainda não expunha `estadoVazio`.

### GREEN

Implementação mínima:

- `estadoVazio()` agora inclui `planoTexto: ''` antes de `config`.
- `window.__TecFabricaPersistence` agora expõe `estadoVazio`.
- `reconstruirEstadoV2` não precisou de alteração: já copia metadados v2 não reservados, preservando `meta.planoTexto` e aceitando metas antigas sem o campo.

Comando executado:

```powershell
node --test test/persistence.test.mjs
```

Saída:

```text
ℹ tests 8
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

## Arquivos

- `src/fabrica/06-persistencia.js`: contrato do estado vazio e hook de teste.
- `test/persistence.test.mjs`: cobertura do estado novo e da reconstrução v2.
- Este relatório.

Não foram alterados `05-estado.js`, parser, UI, monólito, `dist` ou diagnóstico.

## Validação focada

Comandos executados:

```powershell
node --check src/fabrica/06-persistencia.js
git diff --check
```

Resultado: ambos terminaram com código de saída `0`. O teste focado terminou com `8/8` aprovados.

## Self-review

- O campo foi adicionado somente ao estado vazio; não foi criada store nova nem alterado `IDB_VERSION`.
- A preservação v2 usa o caminho já existente de cópia de metadados.
- O teste cobre texto vazio inicial e texto original não vazio na reconstrução.
- O teste existente de reconstrução sem `planoTexto` continua passando, cobrindo compatibilidade com estado v2 antigo.
- O worktree já continha modificações em `diagnostico/relatorio-instrumentado.json` e `diagnostico/tec_fabrica_cadernos.diagnostico.user.js`; elas foram preservadas e não fazem parte desta implementação.

## Preocupações

- Não foi executado build, validação de UI ou teste de IndexedDB real, pois o brief restringe a validação à suíte de persistência e não solicita alteração nesses caminhos.
- O relatório está no caminho longo solicitado; o caminho completo tem 160 caracteres e não atingiu limite do Windows durante a criação.
