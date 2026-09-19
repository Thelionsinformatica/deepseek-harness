# Plano de Correção Priorizado — Projeto Leon

- Data: 2026-08-26
- Base auditada: `leon/identity-pt-br` @ `89e2cf95db9aaf60263e2e90461217713468268c`

## Objetivo executivo

Transformar o snapshot atual em uma versão do Leon que seja, nesta ordem:

1. segura para operar com ferramentas e modelos externos;
2. reproduzível a partir de um commit;
3. resistente a concorrência e recuperável em outra máquina;
4. validada no Windows por gates obrigatórios;
5. instalável, atualizável e reversível;
6. observável e mensurável em qualidade, desempenho e custo;
7. só então mais próxima da experiência ChatGPT Work em voz e percepção contínua.

## Regra de execução

Cada correção deve seguir o ciclo:

```text
especificar contrato → teste que falha → implementação mínima → gates locais
→ teste adversarial → CI Windows → evidência ligada ao commit → release candidata
```

Nenhuma etapa deve habilitar envio externo, acesso total ou ação irreversível por padrão.

## Imediato — antes de qualquer uso com autonomia ampla

### I-01 — Congelar um candidato reproduzível

- Riscos: `LEON-AUD-008`, `009`, `010`.
- Ações:
  1. revisar as 106 entradas do baseline: 68 modificadas e 38 não rastreadas;
  2. separar mudanças Leon de resíduos e experimentos;
  3. versionar apenas o conjunto aprovado em branch de release;
  4. corrigir a lista `files` e o chunk ausente de `tool-goal`;
  5. regenerar catálogos/documentação pelo gerador oficial;
  6. corrigir lint, invariantes, constraints, Knip e duplicação relevante;
  7. vincular todos os artefatos de acceptance ao commit, lockfile e ambiente.
- Gate de saída:
  - `git status --short` vazio no candidato;
  - `git diff --check` passa;
  - `pnpm run lint:contracts-ready`, `pnpm run duplication`, `pnpm run hygiene` e `pnpm run typecheck` passam;
  - instalação do tarball de cada pacote em diretório limpo passa;
  - o arquivo importado pelo `tool-goal` aparece dentro do tarball.
- Esforço: médio.

### I-02 — Fechar todo egress automático

- Riscos: `LEON-AUD-001`, `006`, `014`, `015`.
- Ações:
  1. tornar `residency` obrigatório no schema de rota e de failover;
  2. tratar valor ausente/desconhecido como externo e falhar fechado;
  3. introduzir concessão de uso único ou por sessão antes de local → externo;
  4. mostrar provedor, modelo, classes de dados, estimativa de custo e motivo;
  5. persistir concessão e evento de decisão, sem armazenar credencial;
  6. aplicar política a texto, imagens, anexos, tool results e memória;
  7. adicionar teto monetário por sessão/dia e interromper retry ao atingir o limite;
  8. corrigir `hasImage` para considerar o turno que está sendo reenviado.
- Gate de saída:
  - teste com sentinela `LOCAL-ONLY`: adaptador externo recebe zero chamadas sem concessão;
  - teste real da composição, não apenas objeto montado manualmente;
  - imagem e anexo nunca saem com `residency` ausente;
  - revogação imediata funciona;
  - custo desconhecido aparece como **não contabilizado**, nunca como US$ 0.
- Esforço: médio.

### I-03 — Desativar `danger-full-access` como configuração cotidiana

- Riscos: `LEON-AUD-002`, `004`.
- Ações:
  1. manter `workspace-write` como padrão inequívoco;
  2. retirar `approval: never` de qualquer preset de uso normal;
  3. criar broker de credenciais usando Windows Credential Manager/DPAPI;
  4. impedir que shell/modelo recebam valor ou caminho do cofre;
  5. adicionar política explícita de leitura e egress no Windows;
  6. exigir concessão de uso único para enviar, publicar, comprar, pagar, excluir e alterar credenciais;
  7. registrar alvo, classe de efeito, consentimento e resultado.
- Gate de saída:
  - prompt injection em página/MCP/arquivo não consegue ler sentinela do cofre nem conectar ao receptor local;
  - UIA não aciona botões “Enviar”/“Excluir” sem concessão válida;
  - nenhum segredo aparece em prompt, log, ambiente ou resultado de ferramenta.
- Esforço: grande.

### I-04 — Corrigir SSRF e estabelecer fronteira de conteúdo não confiável

- Riscos: `LEON-AUD-003`, `004`.
- Ações:
  1. bloquear loopback, RFC1918, link-local, multicast, metadata e endereços especiais;
  2. resolver DNS antes da conexão e revalidar após cada redirecionamento;
  3. impedir DNS rebinding;
  4. aplicar allowlist opcional por integração;
  5. marcar web, MCP, anexos e páginas como dados não confiáveis;
  6. exigir `allowedTools` em MCP remoto e `credentialRef` em vez de header literal.
- Gate de saída:
  - suíte de SSRF cobre IPv4, IPv6, DNS e redirect público → privado;
  - servidor MCP adversarial não influencia autorização;
  - configuração com token literal é rejeitada.
- Esforço: médio/grande.

### I-05 — Tornar os testes herméticos

- Risco: `LEON-AUD-011`.
- Ações:
  1. separar unitário, integração local, E2E autenticado e canários externos;
  2. negar rede por padrão nas suítes unitária/integrada;
  3. substituir Codex/Claude/Gemini reais por fakes determinísticos;
  4. exigir flag explícita e ambiente isolado para qualquer teste externo;
  5. impedir descoberta acidental de testes de ferramentas instaladas;
  6. corrigir listener leak observado na suíte geral.
- Gate de saída:
  - `pnpm run test` completa com rede negada e zero tentativas externas;
  - canários externos ficam em jobs nomeados, manuais/agendados e com orçamento;
  - falha de fake não chama CLI ou API real.
- Esforço: médio.

## Curto prazo — próximos 7 dias

### C-01 — Criar um dono único do estado

- Risco: `LEON-AUD-005`.
- Opção recomendada: um processo servidor é o único escritor; Web/headless acessam o estado por contrato local. Como alternativa, migrar domínios para backend transacional com lock, WAL, `busy_timeout` e retry idempotente.
- Requisitos:
  - trava de instância por `$DSH_HOME`;
  - transações e CAS reais entre processos;
  - journal e recuperação após crash;
  - idempotency key para memórias e procedimentos.
- Gate: dois processos gravam chaves distintas e 100% sobrevivem; kill no ponto crítico não corrompe estado.
- Esforço: grande.

### C-02 — Backup/restore integral e verificável

- Riscos: `LEON-AUD-006`, `007`, `016`.
- Conteúdo mínimo:
  - sessões, storages, anexos, personalização, candidatos, procedimentos e manifest;
  - versões do schema, commit/build, lockfile, modelos e digests;
  - credenciais fora do pacote ou criptografadas separadamente;
  - checksums, `backup verify`, `restore --dry-run` e relatório de incompatibilidades;
  - quiescência/flush antes do snapshot;
  - RPO e RTO documentados.
- Gate: restore em perfil Windows limpo, sem unidade/caminho original, recupera sessões, memórias, procedimentos e personalização.
- Esforço: grande.

### C-03 — Relink e migração de workspace

- Risco: `LEON-AUD-007`.
- Ações:
  - comando de `workspace relink` preservando `WorkspaceId`;
  - detecção por manifest/repository identity, nunca apenas por caminho;
  - dry-run e rollback;
  - prevenção de colisão quando duas cópias coexistem.
- Gate: mover `E:\computador` para outro volume e manter o mesmo contexto.
- Esforço: médio.

### C-04 — Persistir política de modelo e promover roteamento com segurança

- Risco: `LEON-AUD-014`.
- Ações:
  - persistir `automatic`, modelo fixo, esforço, orçamento e consentimentos;
  - restaurar exatamente o estado após restart;
  - usar saúde/circuit breaker/capacidade/custo na decisão ativa apenas após evals;
  - registrar explicação do roteamento na UI;
  - canário da cadeia realmente usada pelo Leon, não de DeepSeek legado.
- Gate: restart não altera política; circuito aberto evita nova espera; fallback continua bloqueado sem autorização.
- Esforço: médio.

### C-05 — CI Windows e release do fork

- Riscos: `LEON-AUD-012`, `013`.
- Ações:
  - tornar `windows-native-full` obrigatório no agregado;
  - registrar runners The Lions ou migrar para runners hospedados compatíveis;
  - eliminar dependência implícita de infraestrutura upstream;
  - pin de Actions por SHA e imagens por digest;
  - adicionar SBOM, dependency review/OSV, secret scan e CodeQL equivalente;
  - adotar OIDC/provenance em publicação quando suportado.
- Gate: PR de teste com falha Windows é bloqueada; pipeline do fork termina sem runner upstream; artefato possui SBOM e proveniência.
- Esforço: médio.

## Médio prazo — próximos 30 dias

### M-01 — Instalador Windows e atualização reversível

- Entrega recomendada: MSI/MSIX ou Inno Setup assinado, com preflight.
- Requisitos:
  - detectar Windows, CPU, RAM, GPU/driver, espaço, Node/Ollama/modelos e portas;
  - permitir raiz configurável, com `E:\computador` como escolha de produto, não hardcode;
  - provisionar serviços e atalhos com privilégios mínimos;
  - health check pós-instalação;
  - atualização atômica, migração versionada, rollback e desinstalação sem apagar dados;
  - pacote de diagnóstico sem segredos.
- Gate: instalação, upgrade N-1 → N e rollback em VM Windows limpa; contexto preservado.

### M-02 — Política de dados de longo prazo

- Risco: `LEON-AUD-016`.
- Ações:
  - criptografia opcional por DPAPI;
  - owner derivado do perfil local, não constante global;
  - retenção configurável de sessões/anexos/telemetria;
  - exclusão verificável e exportação seletiva;
  - compactação e índices persistentes;
  - reconciliação de candidatos em estado `writing`;
  - migrações N-1/N-2 com rollback.
- Gate: corpus de 100 mil memórias atende SLO; duas identidades não se misturam; crash intermediário é reconciliado.

### M-03 — Observabilidade operacional

- Risco: `LEON-AUD-019`.
- Ações:
  - health/readiness local;
  - métricas de fila, tool latency, retry, loop, modelo, custo, falha e storage;
  - OTel com redação e opt-in;
  - alertas locais para degradação, custo e backup vencido;
  - runbooks de restauração, modelo indisponível e estado corrompido.
- Gate: falhas injetadas geram sinal, causa e runbook; telemetria não contém sentinelas privadas.

### M-04 — Gates de aceitação vinculados ao commit

- Ações:
  - incluir ACC7/ACC8 no CI apropriado;
  - registrar commit, diff limpo, lockfile hash, modelos/digests, Ollama, GPU/driver e política de rede;
  - executar perf/stress com baseline e orçamento;
  - ampliar cobertura medida para `apps`, `scripts`, ApiProxy, seletor e UI crítica.
- Gate: o relatório é reproduzível e verificável em outra máquina compatível.

## Evolução — próximos 90 dias

### E-01 — Voz conversacional segura

- Risco: `LEON-AUD-017`.
- Evolução:
  - empacotar STT sem caminhos absolutos de laboratório;
  - prévia editável por padrão; autoenvio opcional;
  - TTS local configurável;
  - streaming, interrupção/barge-in, cancelamento e indicador de privacidade;
  - teste de ruído, sotaque PT-BR e dispositivo ausente.
- Gate: conversa STT → chat → TTS contínua, cancelável e sem transmissão não autorizada.

### E-02 — Percepção visual residente com estado fresco

- Risco: `LEON-AUD-018`.
- Evolução:
  - conector local de navegador com URL, DOM/acessibilidade e fingerprint atuais;
  - TTL e invalidação de snapshot em SPA/modal/login;
  - UI Automation residente com janela focada e inspeção antes/depois;
  - visão por screenshot sob permissão e limites de aplicativo;
  - sempre separar observar, propor e executar.
- Gate: DOM muda sem rota e Leon detecta obsolescência; ação em janela errada é negada.

### E-03 — Memória contextual independente de modelo

- Dependência: concluir C-01, C-02 e M-02 antes.
- Evolução:
  - memória episódica, semântica e procedural com proveniência;
  - promoção apenas de fatos/decisões confirmados;
  - avaliação de recall, precisão e contaminação entre workspaces;
  - troca Ollama/Gemini/OpenAI sem perda de estado de tarefa;
  - sumários versionados e reconstruíveis a partir do event log.
- Gate: retomar tarefa após restart e troca de modelo; localizar decisão antiga com fonte; procedimento reaprendido não duplica nem degrada.

## Quick wins

1. Tornar `residency` obrigatório e desconhecido = externo.
2. Persistir `automatic:false` junto à sessão.
3. Classificar `0/0` não verificado como custo não contabilizado.
4. Bloquear rede nos testes unitários.
5. Corrigir `files` do `tool-goal` e regenerar catálogos.
6. Tornar o job Windows completo obrigatório.
7. Adicionar trava de instância por `$DSH_HOME` até existir backend transacional.
8. Tornar a transcrição revisável antes do envio.
9. Adicionar TTL/fingerprint ao cache de contexto do navegador.
10. Remover canário DeepSeek da posição de único teste agendado e testar a cadeia real.

## Ordem que não deve ser invertida

Não priorizar novos modelos, mais presets, voz full-duplex ou controle visual amplo antes de:

1. egress/consentimento;
2. proteção de segredos e SSRF;
3. consistência do armazenamento;
4. backup/restore;
5. release reproduzível e CI Windows.

Expandir autonomia antes desses controles aumenta o raio de impacto sem aumentar a confiabilidade.

## Definição de pronto para a primeira release utilizável

Uma release só deve ser chamada de pronta quando todas as condições abaixo tiverem evidência ligada ao mesmo commit:

- checkout limpo e artefatos reproduzíveis;
- gates de lint, tipos, hygiene, duplicação e catálogos verdes;
- suíte padrão hermética e sem rede;
- nenhum fallback externo sem consentimento;
- nenhuma ação irreversível sem veto técnico;
- SSRF bloqueado;
- apenas um escritor ou storage transacional validado;
- backup verificado e restore em Windows limpo;
- Windows full obrigatório no CI;
- instalador/upgrade/rollback testados;
- custo externo conhecido ou explicitamente não contabilizado, com orçamento;
- health, logs redigidos e runbooks mínimos;
- ACC7/ACC8 e testes de continuidade vinculados ao commit.
