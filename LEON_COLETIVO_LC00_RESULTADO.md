# Leon Coletivo — baseline e primeira alteração

Data: 06/09/2026. Entrega parcial: LC-00 inspecionado; LC-01 iniciado, ainda não aceito como missão funcional.

## Base efetivamente encontrada

- Checkout: `D:\Leon\app`.
- Branch: `leon/estabilizacao-2026-09`.
- HEAD: `67ca70e150d4b99ce9f829bafe5826d0bfd098fa`, não o commit de referência do documento.
- 148 entradas de alterações locais no início desta execução. Nenhum reset, merge, commit ou push realizado.
- Node 24.19.0; pnpm 11.7.0.
- Os dois documentos mestre fornecidos são idênticos: SHA-256 `0368521299D240EE99B8CA88D11346E44BEBE8066FC9E0FD9B9FC44A0C2AD89E`. Documento mestre lido integralmente. Fontes lidas diretamente do ZIP, sem alterar os originais.
- Serviços em loopback: Leon 3080 (PID 30872), Ollama 11434 (PID 7708), gateway 31415 (PID 25468). Nenhum desses serviços foi reiniciado.
- Qwen 9B e variantes presentes no catálogo Ollama; `qwen3.5:4b` ausente. Não houve download ou inferência paga nesta etapa.

## Implementado, habilitado, validado e faltante

| Área | Implementado | Habilitado | Validado nesta execução | Faltante |
|---|---|---|---|---|
| Equipes | `packages/experimental/agent-team` e `tool-agent-team` | Exemplo headless de teste; zero entradas Team no dump do perfil Web normal | 78 testes de baseline; snapshot com três sessões, mensagens e tarefas dependentes | Composição Leon Coletivo própria |
| Tarefas | Jornal nativo, revisões, dependências | Serviço Team experimental | Baseline e regressões de revisão | Integração com critérios e evidências da missão |
| Conclusão revisada | Nova opção `completionRequiresReview` e registro de verificador do host | Apenas cenário de teste opt-in | 81 testes focados e dois cenários Loader aprovados | Verificador de evidências real; a interface não constitui prova por si só |
| Auditor e memória | Preset normal declara auditor `spawn` e recall de memória; host tem persistência JSONL | Configuração normal preservada | Inspeção de configuração; não foi executado auditor ou promoção de memória | Integração experimental sem ampliar permissões |
| Execução local | Ollama acessível; adaptador `llm-pi-ai` na composição normal | Perfil normal preservado | Consulta de modelos, sem inferência no novo coletivo | Qwen 4B no laboratório e teste pelo adaptador real |
| Segurança da missão | Ainda não composta | Não habilitada | Não validada | STOP persistente, orçamento persistente, slot de inferência, restrição final de rota, executor único e bloqueio de caminhos alternativos |

O dump efetivo foi obtido com `DSH_HOME=D:\Leon\data` e `node apps/cli/lib/bin.js web --dump-config`, sem iniciar outro servidor. Foram exibidos apenas identificadores de plugins e presença das capacidades pertinentes; nenhuma credencial foi registrada. Gateway em localhost não foi classificado como inferência local.

## Alteração aplicada

`completionRequiresReview` é desativada por padrão. Quando ativada, o serviço nativo recusa conclusão sem aprovação do único revisor registrado pelo host. A verificação ocorre dentro da mesma transação que valida a revisão da tarefa. Rejeição, erro e revogação não alteram a tarefa nem liberam dependentes. A ferramenta de tarefas não expõe registro de revisores.

Essa alteração não cria banco de tarefas, não instala modelo, não implementa um verificador por conta própria e não equivale ao Leon Coletivo completo. O registro do revisor não é persistente; a futura composição deve registrá-lo novamente e verificar suas evidências persistentes ao retomar.

Arquivos principais: `packages/experimental/agent-team/src/{index,types,task-board}.ts`, `packages/experimental/agent-team/tests/team.spec.ts`, `examples/headless-agent/team.cordis.snapshot.yml`, `examples/headless-agent/tests/fixtures/team-llm.mjs`, `examples/headless-agent/tests/headless.snapshot.ts`. README, nota de arquitetura, referência do subsistema e catálogos foram atualizados junto ao código. A nota está em `.agents/notes/proposed/architecture/2026-09-06-leon-collective-runtime.md` porque a missão completa permanece incompleta.

## Reprodução dos testes

Na pasta `D:\Leon\app`:

```powershell
pnpm exec vitest run packages/experimental/agent-team/tests packages/experimental/tool-agent-team/tests
pnpm exec vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/headless.snapshot.ts -t 'host review|keyless Agent Team'
```

Os snapshots usam aplicação real e adaptador determinístico, sem chamadas pagas. Resultado observado: 81 testes em cinco arquivos; dois snapshots aprovados, 14 cenários fora do filtro. O cenário novo comprova recusa de uma conclusão sem revisão, não uma missão revisada concluída. TypeScript do pacote e build filtrado do pacote experimental passaram. Lint focado passou após corrigir a tipagem de uma fixture. A primeira execução de doc-sync falhou em quatro catálogos; os geradores foram atualizados e a verificação foi repetida.

Resultado final da repetição: `doc-sync` aprovado, 28/28 verificações, exit code 0. Lint focado e `git diff --check` também aprovados, exit code 0. O lint global inicial apontou a tipagem corrigida da fixture; após a correção foi repetido apenas o lint focado, não o global inteiro.

## Inicialização, parada e perfil normal

Ainda não há comando de inicialização de uma missão Leon Coletivo segura. Não usar o exemplo Team existente como se ele incluísse STOP persistente, orçamento ou isolamento de escrita. Os comandos acima executam somente testes temporários; Ctrl+C interrompe o processo de teste, não representa o STOP persistente ainda pendente.

O perfil normal não foi trocado: o Leon continua na porta 3080 e na home original. Não é necessário rollback de perfil ou reinício para continuar usando-o. As alterações de fonte ficam disponíveis para revisão, sem publicação.

## Continuação necessária do LC-01

Implementar o proprietário persistente da missão, os controles de recursos e STOP, a composição local isolada e o verificador de evidências. Depois executar a primeira missão com dois trabalhadores e Qwen 4B pelo adaptador real. Não ampliar interface ou promover memórias antes desse marco. Desempenho na RTX 4070 e qualidade do coletivo ainda não foram medidos.
