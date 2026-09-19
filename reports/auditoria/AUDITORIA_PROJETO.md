# Auditoria Profunda, Adversarial e Baseada em Evidências — Projeto Leon

- Data: 2026-08-26
- Branch: `leon/identity-pt-br`
- Commit de referência: `89e2cf95db9aaf60263e2e90461217713468268c`
- Modo: leitura, verificações estáticas e testes locais sem credenciais
- Veredito: **não pronto para produção nem para autonomia ampla**

## 1. Resumo executivo

O Leon é um monorepo TypeScript de grande porte, derivado de um agent harness baseado em Cordis, que já oferece uma fundação técnica acima de um protótipo comum: log de eventos append-only, composição por plugins, modelos locais e externos, memória por workspace, ferramentas de código, navegador, UI Automation do Windows, custos por sessão, goals e auditor de conclusão.

A arquitetura é promissora para um assistente local-first single-user. Entretanto, a auditoria encontrou uma diferença material entre **possuir recursos** e **operá-los com garantias de produto**. O snapshot atual não é reproduzível, não possui recuperação integral comprovada, pode perder gravações com dois processos, não tem instalador Windows e permite que uma falha do modelo local escale contexto para provedores externos sem consentimento no momento da ação.

Foram confirmados dois riscos críticos no uso pretendido:

1. o fallback automático local → externo pode reenviar texto, histórico, resultados de ferramentas, imagens e anexos sem concessão prévia;
2. no modo `danger-full-access`, o conjunto leitura irrestrita + rede irrestrita + aprovação `never` deixa segredos e o computador expostos a erro do modelo ou prompt injection.

Também foram confirmados bloqueadores de release: 106 entradas preexistentes no working tree, um pacote que importa um chunk não publicado, gates de hygiene/lint/duplicação/catalogação vermelhos e uma suíte geral de testes que tentou usar rede e Codex real de forma inesperada.

### Nível de risco e maturidade

- Risco geral atual: **alto**.
- Segurança no perfil supervisionado `workspace-write`: **parcial, ainda com lacunas de egress/SSRF**.
- Segurança em `danger-full-access`: **inaceitável para uso cotidiano**.
- Maturidade arquitetural: **intermediária/boa**.
- Maturidade operacional: **inicial**.
- Prontidão para produção: **2,5/10**.

### Recomendação executiva

Não ampliar autonomia, voz ou controle visual antes de fechar cinco gates: egress com consentimento, proteção de segredos/SSRF, persistência com um único escritor, backup/restore integral e release reproduzível com CI Windows obrigatório. O primeiro problema a corrigir é `LEON-AUD-001`.

## 2. Escopo analisado

### Inventário

- Monorepo pnpm com mais de 100 workspaces.
- Versão do pacote raiz: `0.1.1-rc.2`.
- Runtime declarado: Node `^22.19 || >=24`; pnpm `11.7.0`.
- Aproximadamente 5.867 arquivos relevantes inventariados.
- Distribuição aproximada por área: `packages` 4.142, `examples` 644, `docs` 370, `apps` 322, `scripts` 192, `vendor` 74, `native` 50 e `python` 33.
- Linguagens/formato predominantes: TypeScript, Markdown, JSON, YAML, JSONL, TSX, SQL, PowerShell e Python.

### Áreas examinadas

- `apps/cli`, presets, composição e skills Leon;
- `apps/web` e fluxos UI relevantes;
- `packages/host/apiproxy`, roteamento e failover;
- `packages/session`, JSONL, exportação, projeções e custos;
- `packages/storage`, JSON, SQLite e contratos de domínio;
- `packages/memory`, memória de projeto, pessoal e procedural;
- ferramentas shell, web, MCP, navegador, LSP e UI Automation;
- credenciais, sandboxes e permissões Windows;
- goals, hooks, conclusão e retomada;
- bundles base/web e configurações de provedores;
- scripts, testes, coverage, perf/stress e acceptance;
- `.github/workflows`, Dependabot, release e cadeia de suprimentos;
- documentação de subsistemas e arquivos `vendor`.

### Itens não examinados ou não verificáveis nesta auditoria

- conteúdo de credenciais, `.env` reais, cookies e cofres;
- serviços de produção, porque nenhum ambiente de produção foi confirmado;
- branch protection, runners, environments e secrets do GitHub;
- CVEs atuais e integridade dos repositórios upstream, pois consultas externas não foram realizadas;
- APIs pagas, Gemini/OpenAI/NVIDIA/FreeLLMAPI e faturas reais;
- teste destrutivo, deploy, migração, restore real, queda de energia ou múltiplas máquinas;
- conteúdo integral de dependências ignoradas e de todos os 5.867 arquivos linha por linha;
- carga real de 10/100/1.000 usuários;
- uso contínuo de desktop, voz e navegador pessoal.

## 3. Controle de integridade

Baseline preexistente registrado em `reports/auditoria/AUDIT-BASELINE-GIT-STATUS.txt`:

- 68 arquivos rastreados modificados;
- 38 entradas não rastreadas;
- total: 106 linhas no status curto;
- diff rastreado inicial: 68 arquivos, 1.723 inserções e 213 exclusões.

O baseline incluía implementações centrais ainda não versionadas, como personalização, aprendizado de procedimentos, evidência de conclusão e acceptance 7/8. Esta auditoria não reverteu nem corrigiu nenhuma delas.

Um teste gerador criou um diretório temporário chamado `.rendered-model-oTwAed` sob a árvore de testes do gerador Typert. O diretório foi confirmado como criado durante a auditoria, dentro do repositório, e removido com segurança. Nenhum arquivo preexistente foi removido. Os únicos arquivos intencionalmente criados são os três relatórios autorizados em `reports/auditoria/`.

Na conferência final original, `git status --short` continuou com as mesmas 106 linhas do baseline porque o Git resumiu o diretório preexistente não rastreado como `?? docs/auditoria/`. Com `--untracked-files=all`, apareciam adicionalmente e somente os três relatórios autorizados. O `git diff --stat` rastreado permaneceu em 68 arquivos, 1.723 inserções e 213 exclusões; portanto, código e configuração preexistentes não foram alterados pela auditoria.

## 4. Finalidade real do produto

O código e a composição indicam que o Leon pretende ser um assistente pessoal local-first para Windows, single-user, capaz de:

- conversar com modelos Ollama e escalar para provedores externos;
- manter sessões, memórias, preferências e procedimentos;
- operar código, arquivos, PowerShell, LSP e MCP;
- navegar em uma sessão Chrome própria;
- inspecionar e operar controles Windows acessíveis;
- aceitar anexos e entrada por voz;
- registrar custo, goals, evidência de conclusão e ações.

O produto **não é hoje equivalente ao ChatGPT Work**. Ele controla parcialmente navegador e Windows, mas não possui percepção visual contínua, recuperação integral comprovada, voz full-duplex, política estrutural uniforme para ações irreversíveis nem continuidade garantida ao mudar caminho/máquina/modelo.

## 5. Arquitetura atual

```text
Usuário
  │
  ▼
Leon Web (conversa, dashboard, configurações, voz)
  │ loopback HTTP
  ▼
API Proxy ─── estado de modelo/sessão ─── projeções para UI
  │
  ▼
Agent Loop + preset Leon
  ├─ system prompt/personalização
  ├─ goals/auditor de conclusão
  ├─ memória de projeto/pessoal/procedural
  ├─ FS/PowerShell/LSP/MCP/Web
  ├─ Playwright (Chrome próprio)
  └─ UI Automation (janela/processo autorizado)
  │
  ├─ Ollama local
  └─ FreeLLMAPI → Gemini → OpenAI (fallback configurado)

$DSH_HOME
  ├─ sessions/*.jsonl       log append-only
  ├─ storages/*.json        workspaces e memórias
  ├─ attachments/media      anexos
  ├─ .credentials.yaml      credenciais locais
  └─ browser-context        último snapshot inspecionado
```

### Fluxo crítico de mensagem

```text
prompt/anexo
 → seleção automática ou manual
 → persistência da mensagem
 → recall por WorkspaceId
 → chamada do modelo
 → ferramentas e eventos
 → projeções/custo
 → resposta na UI

falha do provedor
 → política de failover
 → troca automática
 → evento llm/failover
 → retry do mesmo passo
```

### Fronteiras de confiança

1. usuário/browser → Web/API local;
2. modelo → ferramentas com efeitos no computador;
3. conteúdo não confiável (web, MCP, documento, repositório) → prompt do modelo;
4. armazenamento local → processos Leon concorrentes;
5. Ollama/local → provedores externos e cobrança;
6. working tree → artefato publicado;
7. CI/release → Actions, imagens e registries terceiros.

### Controles positivos confirmados

- JSONL append-only com `fsync`, recuperação de cauda e sequência contígua: `packages/session/session-persistence-jsonl/README.md:40-48`.
- Node/pnpm fixados e lockfile congelado no CI: `package.json:7-10`, `.github/workflows/ci.yml:472-478`.
- Scripts de instalação de dependências negados por padrão e permitidos explicitamente: `pnpm-workspace.yaml:45-65`.
- MCP padrão do Leon local, limitado ao repositório e com allowlist somente leitura: `apps/cli/config/agent-presets/leon/agent.cordis.yml:98-115`.
- Ambiente de MCP stdio remove variáveis com aparência de credencial: `packages/mcp/mcp-client/src/transport.ts:15-23`.
- Memória filtra padrões de credencial e apresenta recall como dado não confiável: `packages/memory/tool-memory/src/index.ts:922-946`, `agent.cordis.yml:203-209`.
- Web UI padrão é loopback e a CLI rejeita `0.0.0.0`: `apps/cli/tests/built-bin.e2e.ts:342-348`.
- Artefato local ACC7 registra sete critérios aprovados; benchmark local registra 30/30 respostas Ollama sem despacho externo. São sinais positivos da máquina, não prova do commit atual.

## 6. Scorecard

| Dimensão | Nota | Justificativa baseada em evidência |
|---|---:|---|
| Arquitetura | 7,5 | Boa composição por plugins, contratos e event log; alguns estados centrais permanecem process-local e o roteamento inteligente ainda é shadow. |
| Qualidade de código | 5,5 | Typecheck e 155 testes focados passam; lint, duplicação, hygiene e catálogos falham. |
| Segurança | 3,5 | Há allowlists e loopback, mas fallback sem consentimento, SSRF, segredos acessíveis ao modelo e `danger-full-access` impedem autonomia segura. |
| Dados | 4,0 | JSONL de sessão é robusto; storages JSON não possuem lock, migração nem recuperação integral. |
| Testes | 5,0 | Cobertura e suites extensas, porém o agregado não é hermético, há gates fora do CI e exclusões críticas de coverage. |
| Confiabilidade | 4,0 | Falta single-writer, restore drill, persistência da política de modelo e reconciliação completa após crash. |
| Observabilidade | 5,0 | Eventos, custo e OTel opcional existem; faltam health/readiness, alertas, SLO e telemetria operacional pronta. |
| Performance | 4,5 | Há testes perf/stress opt-in; não há baseline contínuo nem medida atual de longo prazo. |
| Escalabilidade | 3,0 | Estado local e single-user; 100/1.000 usuários e múltiplos processos não são suportados por evidência. |
| Infraestrutura | 3,5 | CI e release existem, mas Windows completo não bloqueia, fork depende de runners privados e não há instalador. |
| Documentação | 6,0 | Muitos READMEs descrevem limitações honestamente; composição/catalogação gerada está divergente. |
| Produto | 5,5 | Proposta clara e recursos úteis; recuperação, consentimento, custo e operação ainda não fecham a promessa. |
| UX | 5,0 | UI, PT-BR, custos e voz existem; voz autoenvia, contexto visual envelhece e faltam estados operacionais maduros. |
| Manutenção | 4,5 | Monorepo organizado, mas 106 entradas sujas, duplicação e supply chain manual elevam custo. |
| Prontidão para produção | **2,5** | Dois riscos críticos, release não reproduzível, ausência de restore/installer e gates vermelhos. |

## 7. Dez maiores riscos

1. `LEON-AUD-001` — envio externo automático sem consentimento.
2. `LEON-AUD-002` — prompt injection com segredos/rede em acesso total.
3. `LEON-AUD-003` — SSRF para rede interna.
4. `LEON-AUD-005` — perda silenciosa entre processos.
5. `LEON-AUD-006` — recuperação incompleta após falha/reinstalação.
6. `LEON-AUD-004` — ação irreversível sem veto técnico uniforme.
7. `LEON-AUD-011` — testes acionando ambiente externo real.
8. `LEON-AUD-008` — candidato não reproduzível.
9. `LEON-AUD-009` — pacote publicado potencialmente quebrado.
10. `LEON-AUD-012` — Windows não bloqueante e ausência de instalador.

## 8. Achados detalhados

### LEON-AUD-001 — Fallback externo sem consentimento efetivo

- **Categoria / severidade / prioridade:** Segurança, IA, privacidade e custos / **crítica** / P0.
- **Probabilidade / impacto / confiança / status:** alta após indisponibilidade local / grave / alta / confirmado.
- **Componente:** Web bundle, ApiProxy e adaptive routing.
- **Arquivo e linha:** `packages/bundle/web-app/cordis.patch.yml:237-300`; `packages/host/apiproxy/src/api-proxy.ts:1231-1287`; `packages/host/apiproxy/src/adaptive-model.ts:196-214`; `packages/core/agent/src/runtime-types.ts:246-260`.
- **Evidência concreta:** a cascata Ollama → FreeLLMAPI → Gemini → OpenAI está ativa; failovers omitem `residency`; uma falha seleciona o próximo adaptador e repete a mesma etapa sem aprovação. O aviso `llm/failover` ocorre depois da decisão.
- **Como reproduzir com segurança:** adaptadores fake; o local recebe a sentinela `LOCAL-ONLY` e falha. Sem consentimento, o contador do fake externo deveria continuar em zero; o fluxo atual o chama.
- **Comportamento atual / esperado:** hoje a falha local pode reenviar contexto; o esperado é falhar fechado e solicitar autorização granular antes de qualquer saída.
- **Causa raiz provável:** residência opcional e separada do catálogo shadow; auditoria confundida com autorização.
- **Cenário de falha/exploração:** documento privado anexado, Ollama indisponível, retry em gateway externo.
- **Impactos técnico, usuário e financeiro/operacional:** quebra da fronteira local-first; vazamento de histórico/documentos; cobrança sem decisão consciente e risco reputacional/LGPD.
- **Correção recomendada:** `residency` obrigatório, consentimento persistido de uso único/sessão, classificação de dados, orçamento e desconhecido = externo.
- **Esforço / risco da correção / dependências:** médio / médio, pois altera continuidade / UI de consentimento, policy store e testes de composição.
- **Teste de validação:** texto, imagem, anexo, memória e tool result; zero chamada externa sem concessão; revogação e orçamento interrompem o retry.

### LEON-AUD-002 — Segredos e rede ao alcance do agente em `danger-full-access`

- **Categoria / severidade / prioridade:** Segurança e autonomia / **crítica nesse modo** / P0.
- **Probabilidade / impacto / confiança / status:** média / catastrófico / alta / capacidades confirmadas; exploração depende de conteúdo adversarial ou erro do modelo.
- **Componente:** credenciais, PowerShell sandbox, Windows ACL e preset de permissões.
- **Arquivo e linha:** `packages/credentials/credentials-local/README.md:76`; `packages/credentials/credentials-local/src/index.ts:61-67,137`; `packages/shell/pwsh-sandbox/README.md:30-34`; `packages/sandbox/sandbox-windows-acl/README.md:73-101`; `packages/bundle/base/cordis.patch.yml:326-343`.
- **Evidência concreta:** credenciais ficam em `$DSH_HOME/.credentials.yaml`; no Windows não há proteção POSIX; leitura e rede não são confinadas; `danger-full-access` resulta em sandbox irrestrito e aprovação `never`.
- **Como reproduzir com segurança:** home temporário com credencial falsa e receptor HTTP local; instrução adversarial tenta ler/enviar a sentinela.
- **Comportamento atual / esperado:** hoje o modelo/processo pode alcançar o segredo; o esperado é broker de credencial que usa o segredo sem devolvê-lo ao modelo, com egress controlado.
- **Causa raiz provável:** sandbox Windows orientado a escrita e confiança excessiva no prompt/approval.
- **Cenário de falha/exploração:** README, página ou MCP injeta instrução para ler o cofre e transmitir o valor.
- **Impactos técnico, usuário e financeiro/operacional:** comprometimento de contas e máquina; perda de privacidade; custos, fraude e incidente operacional.
- **Correção recomendada:** Credential Manager/DPAPI, broker/capabilities, política de leitura/rede e remoção de `approval: never` no uso normal.
- **Esforço / risco da correção / dependências:** grande / alto / novo broker, policy engine e testes Windows.
- **Teste de validação:** sentinela nunca aparece em prompt/log/resultado/rede, inclusive com prompt injection e `danger-full-access` de laboratório.

### LEON-AUD-003 — SSRF no `web_fetch`

- **Categoria / severidade / prioridade:** Segurança de rede / **alta** / P0.
- **Probabilidade / impacto / confiança / status:** média/alta / alto / alta / confirmado.
- **Componente:** `web-fetch-http` e ferramenta web.
- **Arquivo e linha:** `packages/web/web-fetch-http/src/provider.ts:6,46-108`; `packages/web/web-fetch-http/src/policy.ts:18`; `packages/bundle/web-app/cordis.patch.yml:115-118`; `packages/web/tool-web/README.md:154`.
- **Evidência concreta:** o próprio código registra que proteção contra rede privada não foi implementada e chama `fetch()` sem bloquear endereços internos; a documentação de composição afirma uma proteção inexistente.
- **Como reproduzir com segurança:** servidor HTTP local sem dados sensíveis e URLs loopback/RFC1918/IPv6/redirect.
- **Comportamento atual / esperado:** conexão é tentada; deveria ser negada antes do socket e revalidada após DNS/redirecionamento.
- **Causa raiz provável:** política adiada e documentação antecipou a implementação.
- **Cenário de falha/exploração:** prompt injection consulta painel do roteador, serviço administrativo ou endpoint de metadata.
- **Impactos técnico, usuário e financeiro/operacional:** leitura de rede interna e possível movimento lateral; exposição de configurações; interrupção ou fraude.
- **Correção recomendada:** classificação IP completa, DNS pinning/rebinding defense, redirect recheck e allowlists.
- **Esforço / risco da correção / dependências:** médio / médio por falsos positivos / resolvedor de rede testável.
- **Teste de validação:** matriz IPv4/IPv6, DNS e redirect público → privado, todos bloqueados antes da conexão.

### LEON-AUD-004 — Conteúdo não confiável e ações irreversíveis sem veto estrutural uniforme

- **Categoria / severidade / prioridade:** Segurança, MCP, navegador e UIA / **alta** / P0.
- **Probabilidade / impacto / confiança / status:** média / alto / alta / lacuna confirmada; exploração provável.
- **Componente:** MCP tool catalog/results, skills `leon-browser`/`leon-windows` e `uia.ps1`.
- **Arquivo e linha:** `packages/mcp/mcp-client/src/tools.ts:145-175,258-275,328-373`; `apps/cli/config/agent-presets/leon/skills/leon-browser/SKILL.md:57`; `apps/cli/config/agent-presets/leon/skills/leon-windows/SKILL.md:49`; `leon-windows/scripts/uia.ps1:286-320,549-590`.
- **Evidência concreta:** descrições/resultados MCP entram literalmente no contexto; confirmações de enviar/comprar/excluir são instruções de skill; UIA valida janela/processo, mas `invoke`, `set-value` e `select` não exigem capability de efeito.
- **Como reproduzir com segurança:** MCP/página adversarial e aplicativo de teste com botões “Enviar”/“Excluir”.
- **Comportamento atual / esperado:** o modelo pode pedir a operação e o script executá-la; o runtime deveria negar sem concessão assinada e de uso único.
- **Causa raiz provável:** segurança concentrada no prompt em vez de policy enforcement abaixo do modelo.
- **Cenário de falha/exploração:** conteúdo visual/MCP ordena ignorar regras e clicar em ação irreversível.
- **Impactos técnico, usuário e financeiro/operacional:** ação fora do escopo, publicação/exclusão/pagamento indevido e perda de confiança.
- **Correção recomendada:** envelope de dado não confiável, classe de efeito, capability token, allowlist MCP obrigatória e confirmação técnica.
- **Esforço / risco da correção / dependências:** grande / médio / contrato de ferramentas, UI de autorização e audit log.
- **Teste de validação:** mesmo quando o modelo solicita, operação sensível falha sem capability; concessão é alvo-específica, expira e não pode ser reutilizada.

### LEON-AUD-005 — Perda silenciosa no storage compartilhado

- **Categoria / severidade / prioridade:** Dados e confiabilidade / **alta** / P0.
- **Probabilidade / impacto / confiança / status:** média no uso concorrente / alto / alta / limitação confirmada.
- **Componente:** `storage-json`, `storage-domain`, bundle base e alternativa SQLite.
- **Arquivo e linha:** `packages/storage/storage-json/README.md:9-11,35-38`; `packages/storage/storage-json/src/unit.ts:1-6,24-44,133-139`; `packages/storage/storage-domain/src/domain.ts:153-166,280-286`; `packages/bundle/base/cordis.patch.yml:226-239`; `packages/storage/storage-sqlite/README.md:38-42`.
- **Evidência concreta:** cada processo carrega snapshot e reescreve o arquivo; a fila é interna à instância; não há lock cross-process e prevalece a última escrita. SQLite também não documenta busy/retry multiprocesso.
- **Como reproduzir com segurança:** dois processos contra home temporário gravam chaves distintas no mesmo domínio e reabrem o storage.
- **Comportamento atual / esperado:** uma gravação pode desaparecer; ambas deveriam confirmar commit transacional ou uma instância deveria ser recusada.
- **Causa raiz provável:** pressuposto de host single-process não aplicado como invariante.
- **Cenário de falha/exploração:** Web e headless ativos, ou reinício sobreposto, atualizam memória/procedimento ao mesmo tempo.
- **Impactos técnico, usuário e financeiro/operacional:** inconsistência e perda silenciosa; Leon esquece decisões; suporte e reconstrução manual.
- **Correção recomendada:** single-writer/trava por home ou backend transacional com WAL, lock, CAS, idempotência e retry.
- **Esforço / risco da correção / dependências:** grande / alto por migração / contrato de storage, recovery e testes de concorrência.
- **Teste de validação:** stress multiprocesso, crash nos pontos de commit, reabertura e verificação de 100% das gravações.

### LEON-AUD-006 — Backup/exportação não recuperam o sistema completo

- **Categoria / severidade / prioridade:** Continuidade, dados e operação / **alta** / P0.
- **Probabilidade / impacto / confiança / status:** alta ao migrar ou perder a máquina / alto / alta / confirmado por fluxo e ausência.
- **Componente:** home paths, exportação de sessão, storages, anexos e schemas.
- **Arquivo e linha:** `packages/host/apiproxy/src/session-export.ts:1-18,35-48`; `packages/bundle/base/cordis.patch.yml:221-239`; `packages/util/home-paths/README.md:7-24`; `packages/session/session-persistence-jsonl/README.md:70-76`; `packages/attachment/attachment-local/README.md:21-24`.
- **Evidência concreta:** ZIP de sessão contém logs, descendentes e mídia, mas não os domínios de workspace, memória pessoal/projeto, candidatos e procedimentos. Não há `backup`, `restore`, RPO/RTO, checksum nem restore drill.
- **Como reproduzir com segurança:** home temporário com sessão, memórias e procedimento; exportar, mover e tentar restaurar em home limpo.
- **Comportamento atual / esperado:** conversa pode ser exportada, mas o “cérebro” não retorna; esperado é snapshot consistente, verificável e migrável.
- **Causa raiz provável:** exportação de conversa foi confundida com recuperação de desastre.
- **Cenário de falha/exploração:** SSD/PC falha ou Leon é reinstalado em outra unidade.
- **Impactos técnico, usuário e financeiro/operacional:** relações órfãs e contexto perdido; necessidade de reconstrução; indisponibilidade prolongada.
- **Correção recomendada:** backup integral com quiescência, manifest, versões/digests, checksums, credenciais separadas e restore dry-run.
- **Esforço / risco da correção / dependências:** grande / médio / migrações, relink e single-writer.
- **Teste de validação:** restore em perfil Windows limpo e caminho diferente recupera sessões, memórias, personalização, anexos e procedimentos.

### LEON-AUD-007 — Workspace preso ao caminho absoluto

- **Categoria / severidade / prioridade:** Memória, portabilidade e dados / **alta** / P0.
- **Probabilidade / impacto / confiança / status:** alta em troca de unidade/máquina / alto / alta / confirmado.
- **Componente:** workspace registry e resolução de memória.
- **Arquivo e linha:** `packages/workspace/workspace/src/index.ts:143-163,451-469,572-589`; `packages/memory/tool-memory/src/index.ts:909-914,958-970`.
- **Evidência concreta:** o registro usa `realpath` absoluto; novo caminho cria outro UUID; caminho inexistente é filtrado; memória resolve escopo pelo caminho atual.
- **Como reproduzir com segurança:** copiar projeto e home para outro diretório, reabrir e consultar um marcador de memória.
- **Comportamento atual / esperado:** surge um workspace novo e a memória antiga fica inacessível; esperado é relink explícito que preserve `WorkspaceId`.
- **Causa raiz provável:** identidade técnica baseada em localização, sem manifest durável do projeto.
- **Cenário de falha/exploração:** migração de `E:\computador`, OneDrive reorganizado ou restore em disco diferente.
- **Impactos técnico, usuário e financeiro/operacional:** continuidade aparente quebra; usuário acredita que Leon esqueceu tudo; suporte/migração manual.
- **Correção recomendada:** manifest de identidade, `workspace relink --dry-run`, detecção de colisões e rollback.
- **Esforço / risco da correção / dependências:** médio / médio / backup, registry e UX de conflito.
- **Teste de validação:** mover/copy/relink preserva o mesmo ID e todo recall; duas cópias coexistentes são diferenciadas.

### LEON-AUD-008 — Working tree não reproduzível

- **Categoria / severidade / prioridade:** Release e governança / **alta, bloqueador** / P1.
- **Probabilidade / impacto / confiança / status:** atual / alto / alta / confirmado.
- **Componente:** repositório inteiro.
- **Arquivo e linha:** `reports/auditoria/AUDIT-BASELINE-GIT-STATUS.txt:1-106`; `reports/auditoria/AUDIT-BASELINE-GIT-DIFFSTAT.txt`.
- **Evidência concreta:** 68 arquivos modificados, 38 entradas não rastreadas; diff rastreado de 1.723 inserções/213 exclusões; implementações centrais não pertencem ao commit de referência.
- **Como reproduzir com segurança:** `git status --short` e `git diff --stat`.
- **Comportamento atual / esperado:** artefato depende do diretório local; esperado é commit imutável, diff limpo e artefato ligado ao hash.
- **Causa raiz provável:** evolução longa diretamente no checkout, sem corte de release.
- **Cenário de falha/exploração:** outra máquina clona o commit e não recebe partes essenciais do Leon.
- **Impactos técnico, usuário e financeiro/operacional:** build irreproduzível, correção difícil, rollback impossível e entrega inconsistente.
- **Correção recomendada:** triagem, commit candidato, changelog, tags e manifest de build.
- **Esforço / risco da correção / dependências:** médio / baixo, desde que revisado / decisão de escopo e gates verdes.
- **Teste de validação:** clone limpo do commit produz os mesmos pacotes e passa os mesmos acceptance gates.

### LEON-AUD-009 — Pacote publicado omite dependência de runtime

- **Categoria / severidade / prioridade:** Build e distribuição / **alta, bloqueador** / P1.
- **Probabilidade / impacto / confiança / status:** alta ao publicar / alto / alta / confirmado por gate.
- **Componente:** `packages/goal/tool-goal`.
- **Arquivo e linha:** `packages/goal/tool-goal/package.json` e artefatos `lib/index.js`/`lib/invariant.js` reportados por `publint`/runtime closure.
- **Evidência concreta:** o build importa `completion-evidence-*.js`, mas o chunk não está incluído na lista `files` do pacote; `hygiene` falhou ao validar a publicação.
- **Como reproduzir com segurança:** `pnpm pack`, instalar o tarball num diretório temporário e importar os entrypoints.
- **Comportamento atual / esperado:** instalação publicada pode falhar com módulo ausente; esperado é tarball autocontido.
- **Causa raiz provável:** chunk novo sem atualização da allowlist de arquivos publicados.
- **Cenário de falha/exploração:** instalador/consumidor baixa release e o goal tool falha ao iniciar.
- **Impactos técnico, usuário e financeiro/operacional:** runtime quebrado; Leon não conclui tarefas; rollback e suporte emergencial.
- **Correção recomendada:** publicar o chunk ou produzir bundle estável, e validar todos os tarballs no CI.
- **Esforço / risco da correção / dependências:** pequeno/médio / baixo / configuração de build/package.
- **Teste de validação:** import dos entrypoints a partir exclusivamente do tarball em ambiente limpo.

### LEON-AUD-010 — Gates de qualidade e catálogos divergentes

- **Categoria / severidade / prioridade:** Qualidade, documentação e manutenção / **alta, bloqueador** / P1.
- **Probabilidade / impacto / confiança / status:** atual / alto para release / alta / confirmado por execução.
- **Componente:** lint, jscpd, hygiene, catálogo de ferramentas e Cordis catalog.
- **Arquivo e linha:** `scripts/run-leon-acceptance-7.ts:80`; `packages/core/tools/tests/gen-tool-catalog.spec.ts:28`; `packages/typert/generator/tests/cordis-catalog.spec.ts:78`; `packages/memory/tool-memory/package.json`; `packages/client/ui-settings-personalization/src/invariant.ts`.
- **Evidência concreta:** lint falha em `no-dynamic-delete`; duplicação detecta sete clones; catálogos não refletem quatro tools de memória pessoal e `procedureLearning`; constraints/invariants/Knip/publint falham.
- **Como reproduzir com segurança:** comandos registrados na seção “Testes executados”.
- **Comportamento atual / esperado:** código, pacote e documentação gerada discordam; esperado é geração determinística e gates verdes.
- **Causa raiz provável:** novos recursos foram adicionados sem completar o fechamento de build/catalog/package.
- **Cenário de falha/exploração:** ferramenta existe no código, mas não no catálogo; pacote ou UI não a descobre; clones divergem futuramente.
- **Impactos técnico, usuário e financeiro/operacional:** regressões, manutenção cara, recursos ausentes e release bloqueada.
- **Correção recomendada:** corrigir fontes, regenerar artefatos, deduplicar helpers e tornar os gates obrigatórios.
- **Esforço / risco da correção / dependências:** médio / baixo / decisão sobre artefatos gerados e package closure.
- **Teste de validação:** lint, duplication, hygiene e os dois testes de catálogo passam num checkout limpo.

### LEON-AUD-011 — Suíte padrão não hermética

- **Categoria / severidade / prioridade:** Testes, privacidade e custos / **alta** / P0/P1.
- **Probabilidade / impacto / confiança / status:** alta ao rodar a suíte / alto / alta / confirmado em execução.
- **Componente:** descoberta/agregado Vitest e testes de bridges/subagentes Codex.
- **Arquivo e linha:** configuração agregada do Vitest e testes Codex descobertos por `pnpm run test`; localização exata do disparo requer isolamento adicional com rede negada.
- **Evidência concreta:** a suíte geral exibiu `MaxListenersExceededWarning`, falhou em dois geradores e tentou acessar `https://chatgpt.com/backend-api/plugins/featured?platform=codex`, recebendo 401. Também iniciou fluxo real de Codex. A execução foi interrompida imediatamente.
- **Como reproduzir com segurança:** container/VM sem credenciais, DNS bloqueado e interceptador que falha qualquer conexão; executar somente após isolar o processo.
- **Comportamento atual / esperado:** teste local pode procurar serviço/CLI real; esperado é fake determinístico e rede negada por padrão.
- **Causa raiz provável:** fronteira insuficiente entre unitários e E2E autenticados, com auto-discovery amplo.
- **Cenário de falha/exploração:** CI/desenvolvedor roda testes e envia contexto, consome quota ou depende de serviço externo.
- **Impactos técnico, usuário e financeiro/operacional:** não determinismo, privacidade, custo e testes impossíveis offline.
- **Correção recomendada:** separar projetos, negar rede, injetar adapters fake e exigir flag/job explícito para canários externos.
- **Esforço / risco da correção / dependências:** médio / médio / refatoração dos fixtures e runners.
- **Teste de validação:** suíte padrão completa offline com zero sockets; canários externos executam apenas em jobs nomeados e orçados.

### LEON-AUD-012 — Windows e distribuição não têm gate de produto

- **Categoria / severidade / prioridade:** CI/CD, infraestrutura e produto / **alta** / P1.
- **Probabilidade / impacto / confiança / status:** alta / alto / alta / confirmado; disponibilidade de runners é não verificável offline.
- **Componente:** workflows, CLI/source install e executable builder.
- **Arquivo e linha:** `.github/workflows/ci.yml:427-505`; `.github/workflows/ci-master.yml:75-78,152-166`; `README.md:17-39`; `scripts/build-exe-for-python-sdk.ts:53-77`; `.github/workflows/build-exe-for-python-sdk.yml:30-35,97-105`; `packages/util/home-paths/README.md:21-24`.
- **Evidência concreta:** Windows nativo completo é excluído do check agregado; pós-merge depende de runners privados; distribuição exige Node/npm ou clone/build; builder cobre Linux/macOS, não Windows; raiz `E:\computador` não é provisionada.
- **Como reproduzir com segurança:** PR de laboratório faz um teste Windows falhar; verificar se check agregado ainda passa. Instalar numa VM limpa seguindo somente o release.
- **Comportamento atual / esperado:** regressão Windows pode não bloquear e usuário precisa configurar manualmente; esperado é CI obrigatório e instalador com preflight/rollback.
- **Causa raiz provável:** herança da infraestrutura upstream e foco de desenvolvimento, não distribuição de produto Windows.
- **Cenário de falha/exploração:** release passa em Linux, falha em PowerShell/ConPTY/ACL/UIA na máquina do usuário.
- **Impactos técnico, usuário e financeiro/operacional:** instalação inconsistente, suporte elevado e indisponibilidade.
- **Correção recomendada:** tornar Windows full obrigatório, runners do fork, MSI/MSIX/Inno assinado, upgrade atômico e rollback.
- **Esforço / risco da correção / dependências:** grande / médio / assinatura, pipeline e matriz Windows.
- **Teste de validação:** install/upgrade/rollback em Windows limpo e CI bloqueado por regressão nativa.

### LEON-AUD-013 — Cadeia de suprimentos incompleta

- **Categoria / severidade / prioridade:** Supply chain e CI / **alta** / P1.
- **Probabilidade / impacto / confiança / status:** média / alto / alta / controles ausentes confirmados; vulnerabilidades atuais não verificadas.
- **Componente:** GitHub Actions, containers, registries, Dependabot e `vendor`.
- **Arquivo e linha:** `.github/workflows/ci.yml:55-64`; `.github/workflows/python-release.yml:211-216,246-249`; `.github/workflows/build-exe-for-python-sdk.yml:191-210`; `.github/workflows/release-publish.yml:128-131`; `scripts/run-gates.ts:284-326,638-656`; `vendor/README.md:13-25,52-60`.
- **Evidência concreta:** Actions usam tags mutáveis; imagens sem digest; npm usa token durável; não há SBOM/audit/secret scan/dependency review no gate; procedência de vendor é manual e não compara conteúdo ao SHA declarado.
- **Como reproduzir com segurança:** análise estática do workflow, geração de SBOM offline e verificação de pin/digest; CVE scan somente em ambiente autorizado.
- **Comportamento atual / esperado:** integridade depende de referências mutáveis e processo manual; esperado é provenance verificável e scanners obrigatórios.
- **Causa raiz provável:** controles de licença/estrutura amadureceram antes dos controles de supply chain.
- **Cenário de falha/exploração:** Action/tag ou imagem é substituída, ou vendor diverge silenciosamente do upstream.
- **Impactos técnico, usuário e financeiro/operacional:** build comprometido, segredo de release exposto e distribuição maliciosa.
- **Correção recomendada:** SHA/digest, OIDC/provenance, SBOM, CodeQL equivalente, secret/CVE scan e verificação de vendor.
- **Esforço / risco da correção / dependências:** médio / baixo / permissões GitHub e política de atualização.
- **Teste de validação:** CI rejeita referência mutável, SBOM acompanha artefato e alteração de vendor não autorizada falha o gate.

### LEON-AUD-014 — Política de modelo efêmera e roteamento inteligente apenas observacional

- **Categoria / severidade / prioridade:** IA, produto e confiabilidade / **média/alta** / P1.
- **Probabilidade / impacto / confiança / status:** alta após restart/falha / médio/alto / alta / confirmado.
- **Componente:** ApiProxy, adaptive routing shadow e canários de provedor.
- **Arquivo e linha:** `packages/host/apiproxy/src/api-proxy.ts:1074-1077,1170-1173,2380-2414`; `packages/bundle/web-app/cordis.patch.yml:301-356`; `packages/host/apiproxy/src/adaptive-routing-shadow.ts:387-390,452-484,545-570`; `.github/workflows/e2e.yml:1-7,30-37,109-120`.
- **Evidência concreta:** `automatic` fica num `WeakMap`; restart volta ao padrão. Shadow registra saúde/custo, mas nunca troca a rota. O canário agendado real continua centrado em DeepSeek, não na cadeia atual.
- **Como reproduzir com segurança:** selecionar modelo manual em sessão fake, reiniciar host e consultar estado; abrir circuito fake e enviar nova mensagem.
- **Comportamento atual / esperado:** modo muda após restart e rota doente precisa falhar outra vez; esperado é política durável e circuito ativo validado.
- **Causa raiz provável:** seleção e policy state separados; shadow ainda em fase de observação.
- **Cenário de falha/exploração:** usuário desliga automático por privacidade, reinicia e o fallback externo volta.
- **Impactos técnico, usuário e financeiro/operacional:** comportamento surpreendente, latência, possível egress/custo e perda de confiança.
- **Correção recomendada:** persistir política completa; promover sinais do shadow somente após evals; canário da cadeia real.
- **Esforço / risco da correção / dependências:** médio / médio / policy storage, consentimento e testes de restart.
- **Teste de validação:** restart preserva estado; circuito aberto evita timeout; decisão e motivo aparecem na UI sem violar consentimento.

### LEON-AUD-015 — Painel de custos não é controle orçamentário

- **Categoria / severidade / prioridade:** Custos e produto / **média/alta** / P1.
- **Probabilidade / impacto / confiança / status:** média / médio/alto / alta / contabilização confirmada; preço real offline não verificado.
- **Componente:** configuração de preços, session stats, retry e goals.
- **Arquivo e linha:** `packages/bundle/web-app/cordis.patch.yml:194-211`; `packages/session/session-stats/src/projection.ts:178-193,239-256`; `packages/client/ui-conversation/src/client/chat/StatsLine.tsx:269-299`; `packages/session/session-stats/README.md:15,38,48-54`; `packages/llm/llm-retry/README.md:41-52`.
- **Evidência concreta:** FreeLLMAPI/NVIDIA usam preço `0/0`; qualquer preço configurado vira estimativa, inclusive zero; custos sem usage, impostos/créditos e outras cobranças ficam fora; não há orçamento monetário central e retry pode ser ilimitado.
- **Como reproduzir com segurança:** evento fake sem `providerCostUsdNanos` numa rota `0/0`; verificar classificação e orçamento.
- **Comportamento atual / esperado:** UI pode exibir estimado US$ 0; esperado é “não contabilizado” até gratuidade confirmada e teto de gasto aplicado antes da chamada.
- **Causa raiz provável:** tabela de preços usada como fallback contábil sem semântica de desconhecido.
- **Cenário de falha/exploração:** OmniRoute/FreeLLMAPI escolhe backend variável e gera cobrança não refletida.
- **Impactos técnico, usuário e financeiro/operacional:** métrica incorreta; surpresa de cobrança; inviabilidade de prever custo.
- **Correção recomendada:** três estados estritos, catálogo datado por conta/modelo, orçamento hard-stop e reconciliação com fatura.
- **Esforço / risco da correção / dependências:** médio / baixo / schema de preço, policy e adapters de usage.
- **Teste de validação:** desconhecido nunca vira zero; teto impede nova chamada; painel reconcilia amostra com fatura controlada.

### LEON-AUD-016 — Memória de longo prazo sem garantias de escala, retenção e recuperação

- **Categoria / severidade / prioridade:** Dados, privacidade e performance / **média/alta** / P1/P2.
- **Probabilidade / impacto / confiança / status:** alta no uso prolongado / alto / alta / confirmado.
- **Componente:** memory-local, personal memory, tool-memory e busca histórica.
- **Arquivo e linha:** `packages/memory/memory-local/src/index.ts:227-253,335-355,480-514`; `packages/memory/personal-memory-local/README.md:26-30`; `packages/memory/tool-memory/src/review.ts:694-742`; `packages/memory/tool-memory/README.md:53`; `packages/bundle/base/cordis.patch.yml:247-259`; `packages/memory/memory-local/README.md:18-24`.
- **Evidência concreta:** buscas e listagens varrem dados, revisões acumulam histórico e storage é regravado; criptografia/retenção são adiadas; estado `writing` incerto não é reconciliado; full-text histórico e memória semântica estão desativados/limitados.
- **Como reproduzir com segurança:** corpus temporário grande, falha injetada após `memory.create`, restart e pesquisa de marcador antigo.
- **Comportamento atual / esperado:** latência/crescimento contínuo e candidato pode ficar preso; esperado é índice, retenção, criptografia, idempotência/reconciliação e recall medido.
- **Causa raiz provável:** MVP local otimizado para simplicidade e prevenção de duplicata, sem ciclo de vida de anos.
- **Cenário de falha/exploração:** meses de uso, milhares de revisões, crash no ponto incerto e decisão antiga nunca promovida.
- **Impactos técnico, usuário e financeiro/operacional:** Leon esquece ou demora; plaintext em disco; reparo manual e backups grandes.
- **Correção recomendada:** storage transacional/indexado, DPAPI opcional, owner real, retenção/compactação, reconciliation journal e full-text durável.
- **Esforço / risco da correção / dependências:** grande / alto por migração / backup, schemas e benchmarks.
- **Teste de validação:** 100 mil memórias com SLO; crash reconciliado; exclusão/retention verificáveis; recall de decisões com fonte e sem vazamento entre owners.

### LEON-AUD-017 — Voz não portátil e envia transcrição sem revisão

- **Categoria / severidade / prioridade:** UX e produto / **média** / P2.
- **Probabilidade / impacto / confiança / status:** alta em máquina limpa / médio / alta / confirmado.
- **Componente:** bundle de voz e `VoiceControl`.
- **Arquivo e linha:** `packages/bundle/web-app/cordis.patch.yml:396-399`; `packages/client/ui-voice/src/client/VoiceControl.tsx:72-87`; `packages/client/ui-voice/README.md:20`.
- **Evidência concreta:** Python/modelo Vosk apontam para caminhos absolutos de laboratório; transcrição é anexada ao rascunho e enviada imediatamente; não há TTS/full-duplex.
- **Como reproduzir com segurança:** perfil Windows sem unidade E, microfone de teste e rascunho preexistente.
- **Comportamento atual / esperado:** STT tende a falhar ou texto incorreto é enviado; esperado é provisionamento/diagnóstico, prévia editável e autoenvio opcional.
- **Causa raiz provável:** protótipo integrado antes de empacotamento e política de confirmação.
- **Cenário de falha/exploração:** reconhecimento incorreto junta-se a um rascunho e dispara tarefa errada.
- **Impactos técnico, usuário e financeiro/operacional:** falha portátil, comando não intencional e experiência inferior a voz ao vivo.
- **Correção recomendada:** paths relativos/configurados, device diagnostics, preview, TTS, streaming, barge-in e cancelamento.
- **Esforço / risco da correção / dependências:** médio/grande / médio / instalador, STT/TTS e UI.
- **Teste de validação:** máquina limpa, ruído/sotaque PT-BR, dispositivo ausente, edição antes do envio e interrupção de resposta.

### LEON-AUD-018 — Percepção visual parcial e snapshot potencialmente obsoleto

- **Categoria / severidade / prioridade:** UX, automação e segurança / **média/alta** / P1/P2.
- **Probabilidade / impacto / confiança / status:** média / alto em automação / alta / confirmado.
- **Componente:** `leon-browser`, cache de contexto e `leon-windows`.
- **Arquivo e linha:** `apps/cli/config/agent-presets/leon/skills/leon-browser/SKILL.md:8-42`; `leon-browser/scripts/context.mjs:176-246`; `apps/cli/config/agent-presets/leon/skills/leon-windows/SKILL.md:27-73`.
- **Evidência concreta:** Leon usa Chrome próprio, não o navegador pessoal; `status` lê JSON cacheado sem TTL/fingerprint live; não existe visão contínua; canvas, pixel surfaces e apps legados podem ser invisíveis.
- **Como reproduzir com segurança:** SPA muda DOM por timer sem alterar URL; depois de `inspect`, consultar `status` e tentar referenciar elemento antigo.
- **Comportamento atual / esperado:** snapshot permanece aparentemente válido; esperado é detectar obsolescência e reinspecionar antes de efeito.
- **Causa raiz provável:** cache pensado para continuidade entre passos, não percepção residente.
- **Cenário de falha/exploração:** modal/login altera a página e Leon clica no controle errado; janela focada muda entre inspeção e ação.
- **Impactos técnico, usuário e financeiro/operacional:** ação no alvo errado, necessidade de intervenção e risco em fluxos sensíveis.
- **Correção recomendada:** TTL/fingerprint, árvore acessível ao vivo, foco/handle estável, observe→propose→act e screenshot sob autorização.
- **Esforço / risco da correção / dependências:** grande / alto / conector residente, policy de ação e privacidade.
- **Teste de validação:** DOM/janela mudam entre etapas; ação é negada ou reinspecionada e nenhum conteúdo privado sai sem permissão.

### LEON-AUD-019 — Operação sem SLO, health e gates contínuos de performance/aceitação

- **Categoria / severidade / prioridade:** SRE, performance e qualidade / **média/alta** / P1/P2.
- **Probabilidade / impacto / confiança / status:** alta em operação / médio/alto / alta / confirmado.
- **Componente:** OTel, web server, coverage, perf/stress e acceptance.
- **Arquivo e linha:** `packages/bundle/base/cordis.patch.yml:267-290`; `docs/subsystems/session-telemetry.md:57-61,124-126`; `packages/bundle/web-app/src/index.ts:291-326`; `vitest.config.ts:189-286`; `vitest.web.perf.config.ts:4-13`; `vitest.web-stress.config.ts:5-13`; `scripts/run-gates.ts:284-326`.
- **Evidência concreta:** OTel é opt-in/best-effort e pode exportar payload bruto; não foi encontrado endpoint health/readiness/metrics; coverage exclui áreas críticas; perf/stress e ACC7/8 não bloqueiam CI.
- **Como reproduzir com segurança:** falhas injetadas e carga em ambiente local isolado, com coletor redigido.
- **Comportamento atual / esperado:** degradação pode ser percebida apenas pelo usuário; esperado é SLO, métricas, alertas e gates vinculados ao commit.
- **Causa raiz provável:** instrumentação e benchmarks existem como ferramentas, não como contrato operacional.
- **Cenário de falha/exploração:** memória cresce, latência degrada e canário legado permanece verde enquanto a cadeia Leon falha.
- **Impactos técnico, usuário e financeiro/operacional:** diagnóstico tardio, regressão silenciosa e indisponibilidade prolongada.
- **Correção recomendada:** health/readiness, métricas redigidas, SLOs, ACC/perf/stress versionados e canários reais.
- **Esforço / risco da correção / dependências:** médio/grande / baixo / CI Windows, ambiente de benchmark e runbooks.
- **Teste de validação:** falhas e regressões geram sinal/alerta; telemetria não contém sentinelas; CI bloqueia orçamento excedido.

### LEON-AUD-020 — `continue:false` não funciona como parada global em todos os hooks

- **Categoria / severidade / prioridade:** Segurança e extensibilidade / **média** / P2.
- **Probabilidade / impacto / confiança / status:** média em integrações futuras / médio / alta / confirmado, com correção de uma alegação antiga.
- **Componente:** bridges hooks Codex e Claude Code.
- **Arquivo e linha:** `packages/hooks/hooks-codex/README.md:41-48,93-100`; `packages/hooks/hooks-claude-code/README.md:89-96`; implementações atuais de `PreToolUse` em ambos os bridges.
- **Evidência concreta:** `PreToolUse continue:false` nega corretamente a ferramenta; em eventos como `PostToolUse`, `Stop` e `UserPromptSubmit`, a flag pode ser apenas registrada e não encerra globalmente o agente.
- **Como reproduzir com segurança:** matriz fake por evento, sem chamar provedores externos.
- **Comportamento atual / esperado:** semântica varia por evento; esperado é contrato explícito e impossível de interpretar como kill switch quando não é.
- **Causa raiz provável:** compatibilidade parcial com protocolos externos e semânticas diferentes.
- **Cenário de falha/exploração:** integração acredita ter parado o agente, mas o turno continua.
- **Impactos técnico, usuário e financeiro/operacional:** ação adicional inesperada e falsa sensação de controle; incidente operacional possível.
- **Correção recomendada:** estados `denyTool`, `stopTurn`, `stopAgent`, documentação tipada e testes de conformidade.
- **Esforço / risco da correção / dependências:** médio / médio por compatibilidade / contratos dos bridges.
- **Teste de validação:** matriz de todos os eventos confirma exatamente qual unidade é interrompida.

## 9. Gaps funcionais e de produto

1. Backup/restore integral e verificado.
2. Relink de workspace após mudança de caminho/máquina.
3. Instalador Windows, upgrade atômico, rollback e desinstalação preservando dados.
4. Consentimento granular antes de qualquer envio externo ou ação irreversível.
5. Controle monetário, e não apenas exibição estimada de custos.
6. Health/readiness e diagnóstico exportável sem segredos.
7. Retenção, exclusão, criptografia e migração de memória/sessões/anexos.
8. Busca histórica durável por conteúdo, com fonte e explicação de recall.
9. Visão contínua/atual do navegador e desktop, com privacidade e foco estável.
10. Voz conversacional full-duplex com prévia/cancelamento.
11. Reconciliação de memórias/procedimentos após crash parcial.
12. Administração de conectores, permissões, revogação e trilha de consentimento.
13. Canário da cascata realmente usada: Ollama → FreeLLMAPI/OmniRoute → Gemini → OpenAI.
14. Release manifest com commit, lockfile, modelos/digests, GPU/driver e políticas.
15. Suporte operacional para logs, backup vencido, custo, storage e modelo indisponível.

## 10. Pontos cegos

1. **Maior suposição não validada:** que um `$DSH_HOME` será usado por um único processo e permanecerá no mesmo caminho/máquina.
2. **Parte que parece funcionar por acidente:** continuidade de memória enquanto caminho absoluto e home não mudam.
3. **Componente com responsabilidade excessiva:** ApiProxy combina lifecycle de sessão, seleção, fallback, policy state e exposição à UI.
4. **Maior erro financeiro:** rota externa/retry sem teto e custo marcado como zero/desconhecido.
5. **Maior risco de perda de dados:** duas instâncias regravando storage JSON.
6. **Maior risco de acesso indevido:** prompt injection alcançando segredo/rede em acesso total.
7. **Dependência externa paralisante:** runners privados do upstream e provedores sem canário da cadeia real.
8. **Fluxo crítico sem teste confiável:** backup → restore → relink → retomada após troca de máquina/modelo.
9. **Falha difícil de perceber:** última escrita vence; Leon simplesmente “esquece” uma mudança.
10. **Problema típico de produção:** teste/agent bridge chama serviço real e torna CI não determinístico.
11. **Crescimento não linear operacional:** histórico/memória/anexos sem retenção e regravação integral.
12. **Decisão cara de manter:** múltiplos backends locais sem contrato único de migração/locking.
13. **Requisito esquecido:** identidade durável de projeto independente do path.
14. **Função administrativa futura:** painel de consentimentos, conectores, custos, backups, owners e integridade.
15. **Mecanismo de recuperação ausente:** restore transacional testado em máquina limpa.

## 11. Ameaças

| Ativo | Atacante/vetor | Superfície | Controle atual | Controle ausente |
|---|---|---|---|---|
| Credenciais | Página/MCP/repo malicioso | Shell, rede, `$DSH_HOME` | permissões locais e filtros de env MCP | broker secreto, read/egress policy |
| Arquivos/histórico | Falha local induz fallback | ApiProxy/provedores externos | evento de auditoria | consentimento antes da saída |
| Rede interna | URL adversarial | `web_fetch` | validação HTTP básica | SSRF/DNS/redirect guard |
| Computador | Erro de modelo/prompt injection | UIA, PowerShell | allowlist de janela/processo e approvals em alguns modos | capability por ação/efeito |
| Memória | Dois processos/crash | JSON domains | fila por instância, CAS parcial | lock cross-process/reconciliation |
| Build | Dependência/Action comprometida | CI/release/vendor | lockfile, Dependabot, license gates | SHA/digest, SBOM, provenance, scan |
| Dados pessoais | Acesso ao disco/backup | JSONL/JSON/anexos | armazenamento local | criptografia, retenção e owner real |

## 12. Performance e escalabilidade

Não foram produzidos benchmarks novos. As afirmações seguintes são estimativas arquiteturais:

- **10 usuários/processos simultâneos compartilhando o mesmo home:** não suportado com segurança; risco imediato de last-write-wins.
- **100 usuários simultâneos:** não há autenticação, segregação, backend multi-tenant, fila, pooling ou storage distribuído demonstrados.
- **1.000 usuários simultâneos:** fora do desenho atual; exigiria arquitetura de serviço, banco transacional, quotas, isolation e observabilidade distintos.
- **10 vezes o volume histórico:** varreduras e regravações integrais tendem a elevar latência/RAM; impacto exato não medido.
- **Indisponibilidade externa:** retry/failover existe, mas consentimento, circuit breaker ativo e orçamento não estão fechados.
- **Pico de tráfego local:** estado process-local e arquivos são gargalos; horizontal scaling não é seguro com o backend atual.

## 13. Dependências e cadeia de suprimentos

### Atualização urgente

- Não foi identificada uma versão específica vulnerável sem consulta CVE; portanto, nenhuma atualização de pacote é prescrita como “urgente” sem evidência.
- Urgente é corrigir pin de Actions/imagens, package closure e adicionar scanners.

### Atualização planejada

- executar OSV/dependency review e gerar SBOM em job autorizado;
- comparar `vendor/*` ao SHA upstream documentado;
- revisar pacotes abandonados/duplicados e licenças antes do release.

### Substituição recomendada

- segredo literal/header → `credentialRef` + broker;
- JSON compartilhado multiprocesso → single-writer ou backend transacional;
- tags/imagens mutáveis → SHA/digest imutável;
- token durável de publicação → OIDC/provenance, quando suportado.

### Remoção

- remover dependências/exports apontados como não usados pelo Knip somente após confirmar que não são entrypoints públicos;
- remover o canário DeepSeek da posição de único sinal automático, sem necessariamente remover o provedor opcional.

### Manter

- lockfile congelado;
- política `onlyBuiltDependencies`/negação de scripts de instalação;
- gates de licença, runtime closure e links vendorizados, ampliando-os em vez de substituí-los.

## 14. Pré-mortem — o projeto fracassou em seis meses

| Causa provável | Classificação | Evidência atual | Resultado do fracasso |
|---|---|---|---|
| Documento malicioso induziu leitura/envio de segredo | Forte indício condicional | `danger-full-access`, leitura/rede irrestritas | contas comprometidas e interrupção |
| Falha do Ollama enviou conteúdo privado externamente | Confirmado como comportamento | failover sem consentimento/residency | incidente de privacidade e perda de confiança |
| Duas instâncias sobrescreveram memória | Confirmado como limitação | last-write-wins documentado | Leon “esqueceu” decisões sem erro visível |
| Computador falhou e export não restaurou o cérebro | Confirmado por ausência | sem backup/restore/relink | meses de contexto perdidos |
| Release Windows quebrou | Forte indício | gate Windows não bloqueante, sem installer | abandono por instalação/suporte |
| Custo externo excedeu expectativa | Forte indício | `0/0`, sem hard budget, retry amplo | despesa e desativação do produto |
| Supply chain foi comprometida | Risco teórico plausível | refs mutáveis, sem SBOM/scan | artefato malicioso distribuído |
| Memória cresceu e recall piorou | Forte indício | scans/regravações, busca desativada | lentidão e baixa utilidade |
| Voz/visão executaram intenção errada | Forte indício | autoenvio, snapshot stale, veto só em prompt | ação indevida e perda de confiança |
| Não foi possível diagnosticar falha | Confirmado como gap operacional | sem health/SLO/alerta/runbook completo | indisponibilidade longa e manutenção cara |

## 15. Quick wins

1. `residency` obrigatório; ausente = externo.
2. persistir modo automático/manual.
3. classificar preço `0/0` não confirmado como não contabilizado.
4. corrigir `tool-goal` e catálogos gerados.
5. negar rede na suíte padrão.
6. tornar Windows full obrigatório.
7. trava de instância por `$DSH_HOME`.
8. prévia de voz antes de enviar.
9. TTL/fingerprint no snapshot do navegador.
10. manifest de acceptance ligado ao commit.

O plano temporal completo está em `reports/auditoria/PLANO_DE_CORRECAO.md`; a tabela consolidada está em `reports/auditoria/MATRIZ_DE_RISCOS.md`.

## 16. Testes executados

Todos os comandos abaixo foram executados no repositório local, sem credenciais reais e sem intenção de alterar código. Durações são aproximadas quando não fornecidas pela ferramenta.

| Comando/verificação | Objetivo | Resultado | Duração/observação |
|---|---|---|---|
| `git status --short`, branch e HEAD | baseline de integridade | 106 entradas; branch/commit registrados | < 1 s |
| inventário por extensão/diretório | mapa do repositório | ~5.867 arquivos relevantes | leitura local |
| `git diff --check` | whitespace/patch integrity | **passou** | < 1 s |
| busca heurística de segredos | localizar padrões de chaves reais | nenhum literal suspeito encontrado nas áreas varridas | não prova ausência em ignorados/cofres |
| `pnpm run lint:contracts-ready` | lint contratual | **falhou** em `no-dynamic-delete` | falha reproduzível |
| `pnpm run duplication` | duplicação | **falhou**: 7 clones, 60 linhas, 624 tokens | clones em personalização, procedimentos e acceptance |
| `pnpm run typecheck` | tipos/build oficial | **passou** | ~42 s |
| 16 suites focadas | roteamento, custos, memória, goals, UIA e modelos | **passou**: 16 arquivos, 155 testes | 22,04 s |
| 2 suites de catálogo isoladas | sincronização de artefatos gerados | **falhou**: 2 falhas, 11 passes | 57,10 s |
| `pnpm run hygiene` | constraints, invariantes, Knip, publint e closure | **falhou**: 8 grupos passaram, 5 falharam | 78,47 s |
| `pnpm run test` | suíte total | **interrompida** após falhas de catálogo e tentativa inesperada de rede/Codex real | não é resultado de aprovação/reprovação global |

Uma tentativa preliminar com `tsc -b --noEmit --incremental false` foi descartada: flags incompatíveis com projetos composite produziram `TS6310/TS6379`; isso não foi classificado como falha do projeto. O comando oficial de typecheck passou.

### Falhas materiais observadas

- catálogo de ferramentas não contém quatro operações de memória pessoal;
- catálogo Cordis diverge quanto a `procedureLearning`;
- `tool-goal` importa chunk não publicado;
- `tool-memory` possui lista `files` incompleta;
- invariant vazio da personalização carece da justificativa exigida;
- Knip aponta arquivos/scripts/dependências/exports não usados;
- listener leak na suíte geral;
- tentativa externa recebeu HTTP 401 e a execução foi parada.

## 17. Testes ainda necessários

1. Teste de egress com adapters fake e composição real.
2. Prompt injection end-to-end em sandbox Windows e receptor local.
3. Matriz SSRF IPv4/IPv6/DNS/redirect.
4. UIA/browser com capability de ação irreversível.
5. Concorrência multiprocesso, crash e power-loss simulation.
6. Backup/verify/restore/relink em Windows limpo.
7. Upgrade N-1/N-2 e rollback.
8. Instalação/desinstalação e preservação de dados.
9. Suite total hermética com rede negada.
10. CVE/OSV/dependency review, SBOM e vendor attestation.
11. ACC7/ACC8 vinculados ao commit e executados no CI Windows.
12. Perf/stress com hardware fixo, baseline e SLO.
13. Recall de longo prazo com 100 mil memórias e decisões não promovidas.
14. Reconciliação de memória após crash intermediário.
15. Reconciliar painel de custos com faturas de contas controladas.
16. Voz PT-BR e percepção visual em máquina limpa.
17. Branch protection, runners e environments do fork.

## 18. Perguntas em aberto

1. O Leon será estritamente single-user/local ou haverá acesso remoto/múltiplos usuários? Isso muda autenticação, segregação e backend.
2. Qual RPO/RTO aceitável para sessões, memória e procedimentos?
3. Quais classes de dados podem sair da máquina e por quanto tempo vale uma autorização?
4. O fork possui runners Windows/Linux próprios e quais checks são obrigatórios na branch protegida?
5. Qual teto monetário diário/mensal por provedor e quem pode alterá-lo?
6. Qual diretório deve ser identidade estável: `E:\computador`, manifest do projeto ou repositório Git?
7. Quais aplicativos/janelas podem receber automação e quais efeitos exigem confirmação sempre?

## 19. Conclusão

### O projeto está pronto para produção?

**Não.** Ele é adequado para desenvolvimento local supervisionado, com `workspace-write`, uma única instância e fallback externo desabilitado ou confirmado manualmente.

### Condições que impedem produção

- egress automático sem consentimento;
- exposição estrutural em `danger-full-access` e SSRF;
- storage concorrente sem lock;
- ausência de backup/restore/relink/migrações;
- checkout e pacote não reproduzíveis;
- gates vermelhos e testes não herméticos;
- Windows não bloqueante e sem instalador;
- cadeia de suprimentos/observabilidade ainda incompletas.

### Primeiro problema a corrigir

`LEON-AUD-001`: bloquear todo fallback local → externo até existir autorização explícita, granular, persistida e auditável.

### Maior risco oculto

`LEON-AUD-005`: duas instâncias podem causar perda silenciosa de memória/estado sem crash evidente. É o tipo de falha que só aparece depois como “Leon esqueceu”.

### Recomendação final

Executar o plano na ordem P0 → release reproduzível → Windows/restore → observabilidade → experiência avançada. Aumentar autonomia antes desses gates amplia o raio de dano sem aumentar a capacidade real de conclusão.
