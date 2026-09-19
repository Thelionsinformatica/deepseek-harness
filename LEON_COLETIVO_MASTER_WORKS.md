# LEON COLETIVO — Documento mestre de execução para o Works

**Versão:** 1.0 · **Data:** 06/09/2026
**Produto:** Leon — The Lions Informática
**Repositório inspecionado:** `Thelionsinformatica/deepseek-harness`
**Branch de referência:** `leon/identity-pt-br`
**Commit remoto observado:** `529df9719f80da06c561d942310b8582c692ac67`
**Natureza desta entrega:** especificação de implementação, não código aplicado nem certificação do ambiente local.

## 0. Mandato para o agente de desenvolvimento

Você é responsável por evoluir o Leon real para executar missões por meio de um pequeno coletivo colaborativo de agentes. Trabalhe no repositório existente. Leia este documento integralmente e confronte suas premissas com o checkout antes de alterar código.

A direção está definida: **manter TypeScript/DSH/Cordis; reaproveitar Agent Teams; acrescentar coordenação por missão, mural de evidências, verificação, controle de recursos e integração com a memória existente**. Não substitua o produto por um protótipo paralelo.

Entregue primeiro uma fatia funcional pequena, com testes e caminho de execução reproduzível. Não encerre apenas com um novo plano quando houver acesso e autorização para implementar. Se o ambiente estiver em modo de planejamento, respeite o mecanismo de aprovação: esta especificação não autoriza contorná-lo. Solicite decisões somente quando forem necessárias ao usuário; descubra caminhos, símbolos, configurações e versões por inspeção.

É permitido implementar e testar em checkout/branch de trabalho com dados de laboratório, conforme as permissões da sessão. Não publique, faça push, abra serviços para a internet, modifique produção, execute migrações destrutivas ou gaste créditos sem autorização específica. Preserve arquivos não commitados. Não execute `reset --hard`, limpeza destrutiva ou atualização indiscriminada do upstream.

**Ordem de evidência:** código e configuração efetivamente carregada; testes executados; documentação vigente; este documento; histórico da conversa. Uma nota marcada como implementada não comprova que o recurso está habilitado nem que seus testes passaram nesta execução. Havendo divergência, registre-a e adapte o trabalho sem eliminar as restrições do usuário.

## 1. Resultado esperado do produto

O usuário entrega uma demanda ao Leon. Leon identifica o resultado desejado e os critérios de conclusão, decide se há vantagem em delegar, cria os especialistas necessários e permite que compartilhem descobertas e solicitem ajuda. A equipe adapta seu plano quando a evidência muda. Leon valida e consolida a entrega; o trabalho fica recuperável e experiências selecionadas podem ser propostas à memória.

O comportamento desejado é **coordenação central com iniciativa distribuída**, não um roteiro fixo em que cada agente responde isoladamente à mesma pergunta. Um participante pode propor uma tarefa nova, descartar uma hipótese ou aproveitar um resultado de outro. O software preserva limites, autoria, escopo e estado.

JAN é apenas a inspiração para colaboração por mural. Não há requisito de reproduzir um incidente de segurança, equivaler ao modelo interno envolvido ou criar 1.200 agentes. O número de agentes não é indicador de sucesso. Memória e procedimentos reutilizados também não significam retreinamento automático dos pesos.

**Exemplo de aceitação:** em um projeto de demonstração, dois agentes investigam uma falha de importação. Um descarta a hipótese de arquivo duplicado; outro reproduz o erro em uma repetição da operação. Leon usa esse achado, prepara uma correção isolada, solicita verificação independente e apresenta o resultado com testes reais. O diagnóstico de um agente deve alterar comprovadamente a ação seguinte de outro.

## 2. O que foi encontrado no repositório

Esta leitura foi direcionada, não uma auditoria integral. A revisão local é obrigatória. As referências `Rxx` estão no arquivo `LEON_COLETIVO_FONTES.md`.

| Componente observado | Evidência e consequência |
|---|---|
| Arquitetura modular | `AGENTS.md` e `docs/architecture.md` orientam plugins, eventos tipados, separação host/agente e reconstrução do contexto pelo log. Não reescrever o loop por conveniência. [R02, R03] |
| Agent Teams | `packages/experimental/agent-team` implementa roster, mailbox durável e tarefas versionadas com dependências. Deve ser reaproveitado. [R05, R06] |
| Ferramentas de equipe | `packages/experimental/tool-agent-team/src/index.ts` instala colaboração no escopo de cada membro. No commit inspecionado há `send_message` silencioso e `followup_task` que desperta o destinatário. [R07] |
| Composição experimental | Pacotes experimentais são privados e excluídos das distribuições; dependências de runtime a partir de apps/pacotes de release são proibidas. Usar composição experimental admitida pelas regras. [R04] |
| Subagentes | O provider `spawn` cria contexto novo e herda modelo/workspace por padrão; o serviço subjacente admite opções, mas o schema de `spawn_teammate` consultado não expõe seleção livre de modelo por participante. [R07, R08] |
| Rotas locais atuais | O YAML base declara Qwen3.5 9B e Ornith 1.5 9B, além de outras rotas. O modelo de 4B será uma adição experimental, não uma característica já comprovada da instalação. [R09] |
| Persistência atual | A composição base contém persistência JSONL de sessões e serviços de storage local. Não introduzir PostgreSQL/Redis somente para guardar o mural. [R09] |
| Auditor de conclusão | O preset Leon configura `completionRequiresCompletedTodos` e `completionAuditorProvider: spawn`. Integrar, em vez de criar validadores redundantes. [R10] |
| Memória | O preset configura recall por projeto e memória pessoal com identificador de proprietário local. Não presumir isolamento multiusuário pronto para produção. [R10] |
| Revisão da memória | A nota de escrita controlada exige aceitação humana, escopos exatos e tratamento de gravação incerta. Não promover conteúdo por mera concordância dos agentes. [R11] |
| Procedimentos | `ProcedureLearningService` é descrito como domínio separado, com evidências de ferramentas, verificador, precondições e aprovação humana exata. Verificar implementação e composição antes de integrá-lo. [R12] |
| Qualidade | Há scripts de testes, snapshots, aceitação Leon, build e gates. Executar verificações pertinentes, não inventar comandos nem declarar a suíte inteira aprovada. [R02, R13] |

### Restrições específicas que não podem ser ignoradas

Agent Teams usa uma sessão raiz como Lead; `TeamId` corresponde à identidade dessa sessão. Participantes são filhos diretos, sem equipes aninhadas. Nomes são imutáveis e não reutilizados; o limite de membros conta também provisionamentos que falharam, não apenas agentes simultâneos. Uma conversa raiz usada indefinidamente pode esgotar esses slots. [R05]

O quadro aceita atualizações por revisão esperada, evitando sobrescrita silenciosa. `writeScopes`, porém, são apenas avisos: não bloqueiam escrita de arquivo. Os participantes compartilham processo e checkout. Não há coordenação suportada entre múltiplos processos sobre uma equipe. [R05]

Mensagens já persistidas com resposta `queued` não devem ser reenviadas. O mecanismo fornece recuperação local e deduplicação no destinatário, não execução de ações externas exatamente uma vez. Interromper o turno de um agente não libera automaticamente a tarefa nem apaga a caixa de mensagens. [R05]

Há divergência entre a nota de roteamento local e a descrição/configuração base quanto aos fallbacks externos. Use o YAML, o código do roteador e a composição resolvida como referência; não copie uma cadeia antiga da conversa. **Um gateway em localhost pode encaminhar conteúdo à nuvem.** [R09, R14]

## 3. Escopo, preservação e exclusões

### Preservar

Preservar identidade Leon/PT-BR, interface existente, memória e credenciais locais, provider-neutralidade, permissões, persistência, ferramentas, roteamento e preferência manual do usuário. Manter os modelos de 9B e o perfil normal funcionando. Não renomear namespaces herdados em massa.

Considerar como ambiente-alvo informado pelo usuário Windows, RTX 4070 12 GB, RAM de 32 GB e Ollama; confirmar a máquina real. O código cita `E:/computador` como fallback de workspace, mas isso não autoriza assumir onde fica o checkout. Resolver o workspace por serviço/configuração e respeitar overrides.

### Implementar no ciclo inicial

Implementar composição de laboratório, missão raiz com equipe pequena, mural nativo de tarefas e mensagens, registro mínimo de evidências, critério de aceitação congelado por revisão, bloqueio de conclusão sem verificação, limites de execução, interrupção persistente e teste ponta a ponta. Depois acrescentar interface, integração completa de memória e comparação de modelos.

### Fora do primeiro ciclo

Não migrar para LangGraph, CrewAI, AutoGen, Python/FastAPI ou outro framework. Não introduzir Docker, Kubernetes, Redis, NATS, PostgreSQL, MinIO, Vault ou Letta sem uma necessidade demonstrada que o armazenamento atual não resolva. Não adicionar retreinamento/LoRA, agentes recursivos, autoalteração de permissões, execução distribuída, aprendizado sem revisão, revisão por votação ou acesso irrestrito à máquina.

Não implementar um novo protocolo de transporte completo só por causa do nome LAP. Reutilizar APIs, eventos e schemas DSH. Contratos de missão e evidência podem ser Leon-específicos, mas não duplicar mensagens e tarefas já existentes.

## 4. Arquitetura a implementar

### 4.1 Composição experimental e identidade da missão

Criar uma composição chamada conceitualmente `leon-collective-lab`, isolada do perfil normal e carregada por um caminho permitido para exemplos/pacotes experimentais. O nome final e os arquivos devem seguir as convenções locais. Não adicionar dependências experimentais de runtime aos apps de release nem desativar o gate para conseguir compilar.

Usar home de laboratório e workspace de demonstração separados para desenvolvimento, testes de falha e recuperação. Não apontar um experimento de formato de sessão para o banco pessoal real. Pode ser necessária uma pequena composição de exemplo; resolver a forma pela documentação e pelos exemplos existentes, sem inventar uma CLI.

No MVP, cada missão nova ocupa uma **sessão raiz nova**, que atua como Lead e recebe apenas o contexto autorizado. Não criar o coordenador como um subagente comum e presumir que ele pode se tornar Lead de equipe aninhada. Continuar uma missão existente reutiliza sua raiz; iniciar outra não recicla seus slots.

A futura interface pode abrir essa sessão automaticamente e registrar a referência à conversa de origem. Essa referência é metadado de produto, não autorização para modificar as regras de parentesco do DSH.

### 4.2 Uma única autoridade para cada estado

`ctx.agentTeams` continua sendo a autoridade do roster, mailbox e quadro de tarefas. A interface e o resumo do mural são projeções, não um segundo banco de tarefas.

Criar ou estender um plugin Leon para o ciclo de missão, os critérios de aceitação e as evidências. Evitar um pacote por conceito quando um único módulo experimental bem dividido for suficiente. Nomes sugeridos neste documento não são APIs já existentes.

Manter a persistência das novas entidades no mecanismo nativo adequado: eventos de sessão para fatos do ciclo e contexto reconstituível; domínio de storage existente quando houver registro independente com mutação atômica. Definir uma fonte canônica por entidade e reconstrução de projeções. Não gravar o mesmo estado autoritativo independentemente em JSONL e banco, sem protocolo de reconciliação.

Se um dado novo entra no prompt, deve ser reconstruível pelo log, respeitando `model-visible ⟺ logged`. Referências a artefatos não substituem a retenção autorizada do conteúdo necessário ao replay.

### 4.3 Contratos mínimos propostos

Os campos abaixo são requisitos de projeto, não um schema pronto para colar no YAML DSH. Tipar IDs conforme as regras de branded ids, validar entradas de ferramentas/persistência e implementar revisões atômicas.

**Missão:** identidade, raiz Lead, workspace, proprietário resolvido pelo host, objetivo, revisão dos critérios de aceitação, estado, modo autorizado, orçamento, versão da política, motivo de bloqueio/parada e evidências de encerramento.

**Evidência:** identidade, missão/tarefa, tipo (`hypothesis`, `observation`, `test_result`, `decision`, `blocker`), autor obtido do chamador real, referência de origem, revisão do artefato ou digest, resumo, estado de verificação e referência do verificador. O modelo não escolhe sua própria identidade ou marca algo como verificado unilateralmente.

**Resultado submetido:** tarefa, revisão observada, resumo, artefatos, evidências, testes/limitações e proposta de próximo passo. Um resultado é uma submissão para avaliação; não é uma aprovação.

**Atestação:** tarefa/critério exato, revisão, artefato exato, executor da verificação, chamada/resultado verificáveis, resultado e momento. Modificações posteriores nos critérios ou artefatos invalidam a atestação anterior.

Não guardar segredos no mural. Resultados grandes permanecem em artefatos autorizados; o mural contém extratos e referências. Digests demonstram correlação, não provam que um resultado está correto.

### 4.4 Estados e propriedade da execução

Estados de missão propostos: `draft`, `running`, `awaiting_review`, `blocked`, `paused`, `completed`, `failed`, `cancelled`. Definir as transições e seus autores em testes. Não inserir estados novos no enum nativo de tarefa por improviso; revisão é uma camada explícita sobre a tarefa.

Evitar dois motores de continuação ao mesmo tempo. Inspecionar `ctx.goals`, o driver de goals, workflows e Ralph. Integrar o ciclo de missão a um único dono de continuação; os outros caminhos não podem reiniciar turnos, disparar revisores ou consumir recursos por fora desse dono.

`completed` exige critérios satisfeitos e atestação válida. `blocked` exige motivo e próximo requisito, não uma resposta genérica. `cancelled` permanece cancelado depois de reiniciar. `paused` só retoma após ação de origem autorizada. As políticas de recuperação não podem desfazer STOP.

## 5. Delegação e colaboração reais

No perfil normal, conservar a política existente. No laboratório, o comando/ação de iniciar missão coletiva registra a autorização humana daquela missão. Isso satisfaz a política opt-in atual sem fingir que uma mensagem de outro agente é um pedido do usuário.

Dentro dessa autorização, Leon decide papéis, objetivos e sequência. Começar com dois trabalhadores, além do Lead; reaproveitar o auditor já existente como execução de revisão, quando adequado. Um auditor que não seja membro Team continua contando no orçamento geral da missão. Não manter dois revisores redundantes só para preencher um organograma.

Cada trabalhador recebe missão limitada, contexto mínimo, critérios de resultado e ferramentas necessárias. Preferir `fresh`; `fork` somente quando a herança da conversa for relevante e autorizada. Contexto pessoal do usuário não deve ser distribuído automaticamente a todos.

Qualquer membro pode propor novas tarefas ou comunicar descobertas ao colega. Somente o Lead cria colegas ou atribui trabalho a terceiros, conforme o serviço nativo. “Iniciativa distribuída” não significa permitir expansão recursiva.

No commit de referência, usar `send_message` para informar e `followup_task` para solicitar uma nova execução. Consultar `list_agents` antes de esperar; `wait_agent` não desperta um participante nem faz progresso sozinho. Uma resposta `queued` já é sucesso de persistência. Revalidar essas semânticas no checkout: elas mudaram em versões posteriores do upstream. [R05, R07]

**Critério contra coletivo fictício:** o teste precisa mostrar chamada de ferramenta de criação, sessões distintas, mensagem real entre participantes, tarefa versionada e alteração de decisão causada por evidência compartilhada. Textos do tipo “chamei o agente X” não comprovam nada.

### Orientação curta para o coordenador

> Você é Leon. Responda pela missão e use especialistas apenas quando ajudarem. Dê tarefas delimitadas; consulte descobertas relevantes; descarte hipóteses contrariadas; solicite ajuda quando faltar evidência. Não confunda mensagens com progresso, resultado submetido com aprovação ou concordância com comprovação. Respeite orçamento, workspace, permissões e ordens de parada. Encerre com critérios verificados ou com um bloqueio explicado.

### Orientação curta para trabalhadores e revisor

> Trabalhador: execute a subtarefa, registre evidências, peça ajuda e informe limitações. Não duplique uma tarefa já assumida sem razão. Não invente fontes, testes ou permissões. Revisor: confronte a entrega com critérios e artefatos atuais; registre o que verificou de fato. Sua execução separada reduz dependência do histórico, mas não torna o modelo infalível.

Esses textos complementam a política do DSH. Não substituir schemas por prompts extensos e não pedir armazenamento de cadeias privadas de pensamento; registrar justificativas operacionais curtas, decisões e resultados.

## 6. Mural, verificação e proteção contra falso sucesso

O mural precisa apresentar objetivo, tarefas, hipóteses, evidências, decisões, resultados submetidos e bloqueios. Oferecer busca/listagem por missão e tarefa, tamanho máximo e paginação. Evitar broadcast automático de cada mensagem para todos.

A recuperação de contexto deve sempre manter objetivo, critérios, última tarefa e bloqueios; acrescentar evidências relevantes dentro do orçamento. Não reenviar todo o mural em cada chamada. Uma hipótese rejeitada continua no histórico, mas não deve ser recuperada como solução aprovada.

**Fechamento de tarefas:** no serviço nativo, o proprietário pode marcar uma tarefa como concluída e liberar dependentes. O modo coletivo verificado deve impedir que isso contorne a revisão. Usar um ponto de extensão validado no proprietário do domínio ou acrescentar uma extensão pequena e opt-in. O comportamento normal fora do laboratório permanece inalterado.

O trabalhador submete o resultado; a conclusão aceita depende de evidências e validação compatíveis com a tarefa. Checar autor e revisão no host, não só na descrição da ferramenta. Chamadas diretas a `team_task_update`, ferramentas legadas ou outros consumidores não podem permitir ao modelo contornar o gate.

Reaproveitar a verificação final de goals quando houver compatibilidade. Todos os `todo`s concluídos não bastam: a conclusão da missão também precisa considerar o quadro Team e os critérios. Não permitir que o agente mude o critério para aprovar seu próprio resultado; mudanças materiais exigem nova revisão e, quando alteram a demanda, aprovação do usuário.

Sucesso de ferramenta isolada não é sucesso do usuário. Código exige testes/artefatos correspondentes; documentos exigem critérios verificáveis; pesquisas exigem evidência rastreável. Onde não existir verificação automática suficiente, informar a limitação e exigir revisão humana para a decisão final pertinente.

## 7. Modelos e inferência local

### Decisão inicial

Adicionar `qwen3.5:4b` como candidato **apenas no perfil experimental**. O catálogo Ollama consultado informa pacote de aproximadamente 3,4 GB; verificar tag, digest, licença, quantização e tamanho real no momento da instalação. O limite solicitado é preferência de até 4 GB por arquivo/pacote de modelo, não 4 GB de VRAM para o sistema inteiro. [W01]

Começar com o mesmo modelo para Lead e trabalhadores, em sessões separadas. Deixar `ministral-3:3b` como candidato opcional de comparação, não dependência de boot. Não baixar vários modelos ou remover os modelos de 9B. Ausência de modelo impede o smoke local e deve ser relatada; não acionar nuvem silenciosamente. [W04]

O provider spawn suporta herança/override, mas a ferramenta Team inspecionada não expõe uma chave arbitrária de modelo. Não inventar `model:` no pedido atual. Caso a comparação por papel seja implementada depois, mapear perfis aprovados para rotas existentes pelo host e testar todos os caminhos de criação/retomada. [R07, R08]

### Preflight do provider

Confirmar modelo instalado, uso de GPU, contexto efetivo, parser de ferramentas, JSON inválido, múltiplas chamadas, resultado de ferramenta, streaming e cancelamento. Testar pelo adaptador que o Leon realmente utiliza, não apenas por uma chamada avulsa à API nativa.

Ollama documenta tool calling e compatibilidade parcial com a interface OpenAI. Isso não garante que cada parâmetro de raciocínio atravesse corretamente o adaptador DSH. Verificar o request efetivo de forma redigida e comparar comportamento com raciocínio ligado/desligado; não presumir que omitir o parâmetro o desliga. [W02, W03]

### Parâmetros iniciais propostos, todos configuráveis

| Parâmetro | Valor inicial | Observação |
|---|---:|---|
| Trabalhadores planejados | 2 | Lead é separado; auditor pode ser transitório. |
| `maxMembers` nativo | 4 | Slots Team ao longo da raiz, incluindo falhas; não limite de inferência. |
| Filhos criados por missão | 6 | Proposta de teto geral, incluindo auditor/retries/subagentes fora de Teams. |
| Filhos executando simultaneamente | 3 | Teto lógico; não significa três gerações na GPU. |
| Chamadas locais de inferência simultâneas | 1 | Semáforo compartilhado pelo runtime experimental. |
| Tarefas não deletadas | 24 | Configurar o limite nativo pertinente. |
| Contexto inicial por chamada | 8.192 tokens | Confirmar que o servidor realmente aplica; reservar saída. |
| Saída máxima por chamada | 2.048 tokens | Valor experimental, ajustável após medição. |
| Chamadas de modelo por missão | 24 | Incluir tentativas e revisor; não reiniciar o contador após crash. |
| Tempo máximo da missão | 15 minutos | Teto de laboratório, não promessa de conclusão. |
| Replanejamentos sem evidência nova | 2 | Depois, bloquear e explicar a necessidade. |
| Conteúdo máximo de mensagem | 4 KiB | Medir envelope completo e evitar truncamento sem indicação. |
| Nuvem automática no laboratório | Desabilitada | Inclui proxy local que encaminha a provedores externos. |
| Escrita automática na memória permanente | Desabilitada | Candidatos seguem revisão e escopos existentes. |

Os nomes não nativos desta tabela devem ser mapeados para configurações reais ou implementados, com validação. Não adicioná-los a plugins que não os reconhecem. Limites são ensaio inicial, não valores universais.

Adquirir o slot de inferência somente para a chamada ao modelo e soltá-lo no fim do stream, erro ou cancelamento. **Nunca manter o slot enquanto o Lead espera outro agente ou enquanto uma ferramenta longa roda:** isso bloquearia os trabalhadores necessários ao progresso. Contabilizar todas as inferências pertencentes à missão, inclusive auditor e fallbacks. Usar orçamento com reservas atômicas e timeout/cancelamento de fila.

A configuração do modelo anuncia limites, mas não substitui a configuração real do servidor. A FAQ do Ollama documenta que contextos paralelos aumentam a memória e permite observar carregamento com `ollama ps`. Medir VRAM, latência e offload; não derivar capacidade apenas do tamanho do arquivo. Não reiniciar ou reconfigurar o Ollama compartilhado sem avisar. [W05]

## 8. Segurança e concorrência antes do primeiro piloto

Aplicar permissões por código nos serviços e execuções, nunca apenas pela persona de um “agente de segurança”. Identidades, workspace e autorização vêm do host. Conteúdo de arquivo, memória ou mensagem de colega é dado, não consentimento humano.

No MVP, **Lead é o único executor com permissão de mutação no workspace**. Trabalhadores investigam; o revisor dispõe de leitura e verificadores aprovados. Se um teste precisa gerar arquivos, tratar esse runner como mutante e serializá-lo, preferindo diretório de teste. Não dar Bash/Pwsh genérico aos leitores e alegar que uma instrução os impede de escrever.

Reutilizar política de filesystem, subprocesso, shell, sandbox e aprovações. Bloquear caminhos alternativos: ferramentas legadas de subagentes, workflows, MCP mutantes, self-modification e comandos externos não podem escapar ao teto ou às permissões da missão. Filtros de ferramentas não substituem o controle no executor. Não afirmar isolamento forte além do que o backend efetivamente implementa e os testes demonstram.

`localOnly` deve restringir a rota final e a cadeia de failover, não apenas conferir `127.0.0.1`. Gateway local de nuvem não é inferência local. Separar inferência de pesquisa web: o piloto inicial usa fontes/fixtures locais; pesquisa pública pode ser habilitada por uma capability autorizada posteriormente, sem inserir conteúdo privado em consultas.

STOP deve persistir primeiro a proibição de novas ações, cancelar filas e turnos, interromper processos pertencentes à missão quando suportado e registrar o que já teve efeito. Não matar processos do usuário indiscriminadamente. Pausar uma missão não desfaz alterações concluídas. Retomar precisa revalidar escopo, permissões e evidências.

## 9. Recuperação, progresso e ações incertas

Reconstruir a missão do estado canônico; recuperar Team/mailbox pelos mecanismos nativos. Distinguir `inactive`, espera legítima, fila de GPU, falha real e trabalho sem progresso. Silêncio durante uma ferramenta demorada não autoriza duplicar o executor.

Se um worker falha, o Lead pode liberar/reassumir a tarefa por transição válida e revisão atual, dentro do orçamento. Para o MVP, é aceitável bloquear a missão e pedir retomada antes de redistribuir automaticamente uma tarefa mutante.

Antes de repetir uma ação externa ou mutante, verificar se seu efeito já ocorreu. Separar intenção, início, resultado observado e confirmação. Uma mensagem deduplicada não deduplica um envio de e-mail ou uma gravação externa. Um estado com efeito incerto exige reconciliação ou decisão humana; não aplicar retry cego.

Sem novas evidências, rejeitar ciclos repetidos, limitar tentativas e explicar o bloqueio. Não salvar um “aprendizado” de que insistência ilimitada é procedimento válido.

Manter apenas um processo dono de cada Team. Prevenir abertura concorrente da mesma home/missão quando não houver garantia, ou falhar explicitamente. Não promover o runtime local a sistema distribuído com uma pasta de rede.

## 10. Memória e aprendizado institucional

Separar histórico operacional, mural da missão, memória de fatos e domínio de procedimentos. Conversas de agentes e hipóteses não entram automaticamente na memória permanente.

Para fatos selecionados, reutilizar candidatos e revisão existentes. Preservar `automaticWrite: false`, allowlists por usuário/workspace e exigência de aceitação humana. Não converter o sucesso do revisor em consentimento de armazenamento. Gravações incertas não podem ser duplicadas por retry. [R11]

Para procedimentos, preservar precondições, validade, revisão exata, verificador, revogação e estados do domínio atual. Na implementação descrita, evidências precisam pertencer à mesma sessão e revisão humana é um comando direto exato. **Não misturar chamadas de subagentes de sessões diferentes para forçar a criação de um procedimento.** [R12]

No primeiro ciclo, permitir registrar uma proposta de lição no mural e encaminhá-la ao caminho existente apenas quando compatível. Para um procedimento novo, o Lead pode executar e verificar uma reprodução controlada na própria sessão, com permissão e evidências reais; outra alternativa é deixar a proposta pendente. Não afrouxar a validação de origem para entregar a funcionalidade mais rápido.

Recuperar experiências apenas do workspace/proprietário autorizados. Memória pessoal não precisa ser compartilhada com cada trabalhador. A separação prepara evolução multiusuário, mas não certifica o produto como multi-tenant.

Não executar código armazenado em memória automaticamente. Conhecimento recuperado orienta uma nova ação, que passa pelas permissões e pela verificação normais. O teste de aprendizado deve comprovar persistência, recuperação pertinente e reutilização validada, não mudança de pesos.

## 11. Plano incremental e entregas

### LC-00 — Inspeção e baseline

Ler `AGENTS.md` aplicáveis, arquitetura, regras experimentais e testes. Identificar branch/HEAD, alterações locais, serviços, composição resolvida, memória e modelos presentes. Confirmar o estado de Agent Teams e diferenças de versão. Registrar um inventário curto `implementado / composto / validado / faltante` com caminhos e evidências.

Executar baseline focado. Falhas anteriores devem ser registradas separadamente das introduzidas. Não sincronizar com master/upstream automaticamente. Não copiar secrets para relatórios ou dumps.

**Aceite:** base identificada; dados originais intactos; plano local curto com arquivos reais e gates pertinentes.

### LC-01 — Primeira missão coletiva funcional

Compor laboratório, autorização explícita por missão, raiz Lead, dois workers e provider local aprovado. Implementar limites antes de executar agentes reais. Integrar tarefas/mailbox, evidência mínima e submissão/verificação do resultado. Tratar conclusão nativa para não contornar o gate. Reaproveitar auditor quando compatível.

Entregar um exemplo que rode pelo runtime DSH real e um snapshot keyless reproduzível. Adicionar smoke com Ollama quando disponível. Confirmar mensagens reais entre participantes e resultado consolidado. O modelo de teste determinístico verifica a infraestrutura; somente smoke local verifica integração com o modelo real.

**Aceite:** inicia, cria, comunica, registra tarefa, verifica, conclui ou bloqueia; sem saída externa, expansão indevida ou alteração do perfil normal. Esta é a primeira entrega executável obrigatória.

### LC-02 — Robustez do mural e recuperação

Completar tipos de evidência, referências/digests, revisão de critérios, invalidação de atestação, paginação, supervisão de progresso e testes de crash/STOP. Testar corrupção/versão desconhecida conforme contratos do repositório; não descartar histórico para “consertar” leitura.

**Aceite:** resultado antigo não aprova arquivo novo; retomada não duplica mensagens/ações conhecidas; estados incertos bloqueiam; STOP sobrevive a reinício.

### LC-03 — Memória e procedimentos

Integrar propostas do coletivo à revisão existente. Provar isolamento por workspace, nenhuma promoção automática e caminho válido de reprodução/verificação na mesma sessão para procedimentos, quando habilitado.

**Aceite:** missão seguinte consulta experiência aprovada e aplicável; rejeitados/expirados/não aprovados não se tornam instruções executáveis.

### LC-04 — Interface e diagnóstico

Acrescentar no mecanismo de extensão Web permitido: missão, integrantes/modelos, fila de inferência, tarefas, evidências, bloqueios, orçamento e ações humanas de pausa/parada/retomada. A UI projeta estado real; não inventa progresso. Consultar previamente as regras de pacotes experimentais e de componentes client/host.

Pode começar por um relatório textual/JSONL de diagnóstico, mas só declarar interface entregue após testes no navegador. Não importar código de host/secrets no bundle client. Estados de carregamento, conflito, cancelamento e erro precisam aparecer.

**Aceite:** o usuário identifica quem está trabalhando, qual evidência sustenta a resposta e por que houve bloqueio; controles agem no runtime.

### LC-05 — Avaliação e decisão de expansão

Comparar: A) Qwen sozinho com ferramentas; B) Qwen e auditor; C) coletivo com mural. Usar mesmas tarefas, dados e orçamento agregado, incluindo custos de coordenação. Medir acerto, tempo total, tokens, chamadas, erros de ferramentas, intervenção, memória e VRAM quando disponíveis.

Primeiro piloto: três demandas de demonstração, duas execuções por configuração, dentro do orçamento autorizado. Amostra pequena serve para diagnóstico, não para declarar superioridade estatística. Só depois avaliar segunda família/modelo, concorrência maior e seleção por papel.

**Aceite:** relatório reproduzível com dados reais e falhas visíveis. Não afirmar que coletivo vence sempre; manter modo individual quando for melhor.

## 12. Testes de aceitação obrigatórios

Executar testes relevantes ao estágio; os de segurança, estado e privacidade aplicáveis são bloqueadores, não médias que podem ser compensadas por qualidade textual.

| ID | Teste | Resultado exigido |
|---|---|---|
| T01 | Boot do perfil normal | Comportamento anterior preservado; nenhum Team/modelo novo imposto. |
| T02 | Boot experimental | Persistência e ambos plugins presentes; composição inválida falha explicitamente. |
| T03 | Opt-in | Pedido comum fora da missão não cria equipe; missão autorizada permite delegação limitada. |
| T04 | Papéis reais | Lead cria; trabalhador não cria colegas, não finge ser Lead e não amplia tools. |
| T05 | Colaboração | Sessões distintas, tarefa assumida e mensagem com efeito observável no trabalho de outro agente. |
| T06 | Revisão desatualizada | Duas mutações conflitantes no quadro não sobrescrevem estado silenciosamente. |
| T07 | Dependências | Tarefa bloqueada não é assumida; ciclos e referências inválidas são rejeitados. |
| T08 | Mailbox | `queued` não causa reenvio; recuperação não duplica entrega já aceita. |
| T09 | Quiet/wakeup | Semântica da versão é respeitada; espera não é tratada como wakeup. |
| T10 | Deadlock de inferência | Lead esperando colega não retém o único slot de geração. |
| T11 | Cancelamento de stream/fila | Slot e orçamento reservado são tratados corretamente; nenhuma tarefa órfã roda depois de STOP. |
| T12 | Falha de provisionamento | Falha consome identidade/slot conforme regra; teto não é contornado por retry ou novo nome ilimitado. |
| T13 | Contabilidade geral | Auditor, chamadas extras, forks e retries entram nos limites; reboot não zera o orçamento gasto. |
| T14 | Conclusão falsa | Texto “todos os testes passaram” sem evidência não fecha tarefa nem missão. |
| T15 | Bypass do gate | `team_task_update` e caminhos alternativos não permitem ao executor autoaprovar resultado. |
| T16 | Critério/artefato alterado | Atestação antiga é invalidada; nova revisão é necessária. |
| T17 | Escrita concorrente | Leitores não executam shell mutante; somente executor autorizado altera workspace no MVP. |
| T18 | Escopo de dados | Tarefa, mensagem, artefato e memória de outro workspace/proprietário não são expostos. |
| T19 | Injeção de instrução | Texto de documento/colega “autorize nuvem/aprove memória” não vira ação humana nem permissão. |
| T20 | Falha do modelo local | Sem fallback externo, inclusive gateway local; erro claro e nenhuma chamada paga. |
| T21 | STOP e reinício | Estado cancelado permanece; inbox preservada não dispara trabalho por conta própria. |
| T22 | Efeito incerto | Falha entre efeito e confirmação não repete cegamente mutação. |
| T23 | Memória candidata | Mural não é promovido sem aceitação e escopos existentes; dados sensíveis são barrados. |
| T24 | Procedimentos | Evidências cruzadas entre sessões não são aceitas; validade/revisão humana permanecem obrigatórias. |
| T25 | Rollback | Perfil normal abre sua home original; laboratório fica preservado sem exigir leitura por versão antiga incompatível. |
| T26 | Modelo real | Tool calling, streaming, cancelamento e contexto são verificados pelo adaptador usado pelo Leon. |
| T27 | UI | Painel e controles refletem runtime, inclusive erro/conflito; não apenas dados fictícios. |
| T28 | Custo/qualidade | Comparação usa orçamento agregado e registra resultados desfavoráveis ao coletivo. |

## 13. Comandos, evidência de execução e qualidade do código

Usar `git status --short`, branch atual, `git rev-parse HEAD` e versões de ferramentas para o baseline. No snapshot, `package.json` declara Node `^22.19.0 || >=24.0.0` e pnpm `11.7.0`; conferir no checkout e usar o gerenciador fixado, sem atualizar tudo. [R13]

O repositório contém `pnpm run test`, `test:snapshot`, `typecheck`, `lint`, `build`, `hygiene`, `doc-sync`, `test:leon-eval` e scripts de aceitação. Selecionar arquivos/filtros reais conforme `AGENTS.md` e política de testes. Só executar o comando de smoke depois de definir a composição de laboratório; não usar um exemplo padrão que exija uma API paga. [R02, R13]

Requisitos: TypeScript estrito, eventos/erros tipados, schemas de entrada e saída, limites configuráveis, efeitos descartáveis, cancelamento de ciclo de vida, logs sem secrets e uma nota de arquitetura para mudanças não triviais. Não editar catálogos gerados à mão nem alterar fixtures só para esconder falhas. Seguir as regras de documentação e idioma do repositório, mantendo a comunicação com o usuário em PT-BR.

Testes com mock/replay provam comportamento do runtime; não provam raciocínio do Qwen ou latência na 4070. Testes antigos mencionados em notas não contam como executados hoje. Reportar `aprovado`, `falhou`, `bloqueado` ou `não executado` por comando, com exit code quando existir e referência de log redigido.

Não iniciar a suíte completa por padrão. Executar gates focados e ampliar quando a mudança justificar. Não fazer push nem commit automaticamente; entregar diff revisável e aguardar a autorização correspondente.

## 14. Entrega obrigatória ao usuário

Ao terminar cada etapa, informar o que mudou, arquivos alterados, fatos já existentes reaproveitados, decisões novas, testes realmente executados e falhas remanescentes. Fornecer comando exato de inicialização, um exemplo de demanda, como acompanhar estado e como parar/voltar ao perfil normal.

Entregar no repositório, em locais compatíveis com suas regras: nota de decisão/arquitetura; implementação e configuração experimental; exemplo reproduzível; testes; documentação de uso/rollback; relatório de aceitação com snapshot do ambiente sem segredos. Nomes e pastas finais dependem do layout real.

Se não houver GPU/modelo/servidor acessível, concluir o que for possível na infraestrutura e registrar smoke local como bloqueado. Não dizer “pronto na sua 4070” após apenas compilar. Se não houver acesso ao código, não inventar alterações: indicar exatamente o bloqueio de acesso.

## 15. Critério final de sucesso

O marco é aceito quando o Leon real forma uma pequena equipe autorizada, permite colaboração verificável, mantém tarefas/evidências recuperáveis, controla recursos, respeita STOP, conclui somente com evidência e preserva o perfil e a memória anteriores.

O benefício de qualidade só estará demonstrado se a avaliação mostrar vantagem em alguma classe de demanda. Funcionalidade correta e superioridade do coletivo são conclusões diferentes.

**Primeira ação do Works:** executar LC-00 e apresentar diagnóstico curto com arquivos reais; em modo de execução autorizado, seguir imediatamente para LC-01. Não reabrir a decisão de framework nem transformar este documento em uma nova rodada de promessas.
