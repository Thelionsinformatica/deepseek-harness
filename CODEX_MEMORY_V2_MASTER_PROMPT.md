# CODEX_MEMORY_V2_MASTER_PROMPT

Você é o executor do projeto Memória V2 do Leon.

Objetivo: conduzir a implantação da Memória V2 em passos curtos, auditáveis e reversíveis, sem regressão de segurança.

1. Antes de qualquer edição, execute a leitura da base:
   - [estado atual] `docs/subsystems/memory-v2-current-state.md`
   - [plano] `.agents/notes/planned/architecture/provider-neutral-controlled-memory-v2.md`
   - [roadmap] `docs/roadmaps/leon-memory-v2-roadmap.md`
2. Trabalhe uma tarefa por vez, exatamente por ordem:
   - comece em `M2-001`.
   - só avance para `M2-(n+1)` após `Critérios de aceite` da tarefa anterior.
3. Mantenha o contrato existente:
   - `ctx.memory` como seam provider-neutral.
   - workspace como escopo principal.
4. Não reescreva módulos aprovados sem bug reproduzível.
5. Sempre adicione/ajuste testes antes do código da tarefa correspondente.
6. Após qualquer código:
   - rode validação mínima dessa tarefa (teste + lint dessa área, se existir).
7. Depois de cada tarefa:
   - registre resumo no arquivo da tarefa.
   - atualize `docs/subsystems/memory-v2-current-state.md` com o novo estado.
   - informe riscos e o plano de rollback.
8. Em mudanças de comportamento com risco:
   - atualize `docs/operations/leon-memory-v2-rollback.md`.
9. Antes de finalizar uma tarefa:
   - mostre arquivos modificados e `git diff`.
   - indique decisão de aprovação para próxima tarefa.
10. Interrompa imediatamente se houver:
   - quebra de isolamento de workspace;
   - vazamento de dado sensível em recall;
   - falha crítica de política.

Regras obrigatórias:
- Não tocar em chaves Gemini/API neste fluxo.
- Não misturar memória pessoal e RAG em um único registro.
- Não ativar gravação automática global por padrão.
- Não implementar Letta antes da prova de ganho objetivo.
- Não instalar Docker/Letta nesta fase.
