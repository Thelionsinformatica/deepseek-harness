# Matriz de Riscos — Projeto Leon

- Data da auditoria: 2026-08-26
- Branch: `leon/identity-pt-br`
- Commit de referência: `89e2cf95db9aaf60263e2e90461217713468268c`
- Escopo: snapshot do commit mais as alterações preexistentes registradas no baseline Git.

## Critérios

- **Severidade** considera impacto e probabilidade no uso pretendido do Leon.
- **Status** diferencia fato observado de exploração ainda dependente de condição.
- **Prioridade**: P0 impede autonomia/produção; P1 impede release confiável; P2 deve entrar na evolução controlada; P3 é melhoria.
- **Confiança**: alta quando há código/documentação/teste direto; média quando a consequência depende do ambiente.

| ID | Risco | Categoria | Severidade | Probabilidade | Impacto | Confiança | Status | Esforço | Risco da correção | Prioridade |
|---|---|---|---|---|---|---|---|---|---|---|
| LEON-AUD-001 | Fallback local → externo envia contexto sem consentimento e com `residency` omitido | Segurança, IA, privacidade, custos | **Crítica** | Alta após falha local | Vazamento de documentos/histórico e cobrança externa | Alta | Confirmado | Médio | Médio | **P0** |
| LEON-AUD-002 | `danger-full-access` + leitura/rede irrestritas expõem segredos a prompt injection | Segurança, autonomia | **Crítica no modo total** | Média | Comprometimento do computador e exfiltração | Alta | Capacidade confirmada; exploração condicional | Grande | Alto | **P0** |
| LEON-AUD-003 | `web_fetch` não bloqueia SSRF/rede privada | Segurança, rede | **Alta** | Média/alta | Acesso a serviços locais, roteadores e metadata | Alta | Confirmado | Médio | Médio | **P0** |
| LEON-AUD-004 | Confirmações de navegador/UIA e conteúdo MCP não possuem veto técnico uniforme | Segurança, produto, agentes | **Alta** | Média | Ação irreversível induzida por erro ou conteúdo malicioso | Alta | Lacuna confirmada; exploração provável | Grande | Médio | **P0** |
| LEON-AUD-005 | Storage JSON compartilhado não tem lock entre processos | Dados, confiabilidade | **Alta** | Média no uso concorrente | Perda silenciosa de memórias, workspaces e procedimentos | Alta | Confirmado | Grande | Alto | **P0** |
| LEON-AUD-006 | Não existe backup/restore integral, relink nem migração entre versões | Continuidade, dados, operação | **Alta** | Alta ao migrar/reinstalar | Recuperação incompleta e contexto órfão | Alta | Confirmado por ausência e fluxo | Grande | Médio | **P0** |
| LEON-AUD-007 | Identidade do workspace depende de caminho absoluto | Dados, memória, portabilidade | **Alta** | Alta ao mudar unidade/máquina | Leon deixa de recuperar contexto existente | Alta | Confirmado | Médio | Médio | **P0** |
| LEON-AUD-008 | Checkout possui 106 entradas sujas e recursos centrais não rastreados | Release, configuração | **Alta/Bloqueador** | Atual | Build não corresponde a um commit reproduzível | Alta | Confirmado | Médio | Baixo | **P1** |
| LEON-AUD-009 | Pacote `tool-goal` referencia chunk não incluído na publicação | Build, distribuição | **Alta/Bloqueador** | Alta ao empacotar | Instalação publicada quebra em runtime | Alta | Confirmado por `hygiene` | Pequeno/médio | Baixo | **P1** |
| LEON-AUD-010 | Gates de lint, duplicação, catálogo, constraints e invariantes estão vermelhos | Qualidade, manutenção | **Alta/Bloqueador** | Atual | Regressões e documentação/runtime divergentes | Alta | Confirmado por execução | Médio | Baixo | **P1** |
| LEON-AUD-011 | Suíte geral de testes não é hermética e acionou tráfego externo/Codex real | Testes, privacidade, custos | **Alta** | Alta ao executar `pnpm run test` | Vazamento, custo e CI não determinístico | Alta | Confirmado por execução | Médio | Médio | **P0/P1** |
| LEON-AUD-012 | Windows completo não bloqueia o agregado; fork depende de runners privados; não há instalador | CI/CD, infraestrutura, produto | **Alta** | Alta | Falha no sistema-alvo e instalação não repetível | Alta | Confirmado; runners externos não verificados | Grande | Médio | **P1** |
| LEON-AUD-013 | Actions/imagens não são imutavelmente fixadas e faltam SBOM/audit/secret scan | Cadeia de suprimentos | **Alta** | Média | Build comprometido ou vulnerabilidade não detectada | Alta | Controles ausentes confirmados; CVEs não verificados | Médio | Baixo | **P1** |
| LEON-AUD-014 | Modo automático/manual é efêmero e roteamento de saúde/custo ainda é apenas shadow | IA, produto, confiabilidade | **Média/Alta** | Alta após reinício/falha | Modelo inesperado, latência e novo envio externo | Alta | Confirmado | Médio | Médio | **P1** |
| LEON-AUD-015 | Custo `0/0`, ausência de orçamento e retry potencialmente ilimitado subestimam gasto | Custos, produto | **Média/Alta** | Média | Fatura inesperada e falsa percepção de gratuidade | Alta | Risco contábil confirmado; preço real não verificado | Médio | Baixo | **P1** |
| LEON-AUD-016 | Histórico/memória crescem sem retenção, criptografia, reconciliação ou busca durável padrão | Dados, privacidade, performance | **Média/Alta** | Alta no uso prolongado | Recall ruim, dados expostos e candidato preso após crash | Alta | Confirmado | Grande | Alto | **P1/P2** |
| LEON-AUD-017 | Voz depende de caminhos de laboratório, autoenvia transcrição e não oferece full-duplex/TTS | UX, produto, portabilidade | **Média** | Alta em máquina limpa | Comando incorreto enviado e experiência incompleta | Alta | Confirmado | Médio/grande | Médio | **P2** |
| LEON-AUD-018 | Contexto do navegador pode ficar obsoleto e visão do desktop não é contínua | UX, automação, segurança | **Média/Alta** | Média | Leon age sobre estado visual antigo ou não observa o alvo | Alta | Confirmado | Grande | Alto | **P1/P2** |
| LEON-AUD-019 | Observabilidade, health/readiness, desempenho e canários da cadeia real não são gates | SRE, performance | **Média/Alta** | Alta em operação | Falha silenciosa, regressão e diagnóstico tardio | Alta | Confirmado | Médio/grande | Baixo | **P1/P2** |
| LEON-AUD-020 | Semântica de `continue:false` não é kill switch global em todos os hooks | Segurança, extensibilidade | **Média** | Média em integrações futuras | Operador presume veto que não existe | Alta | Confirmado | Médio | Médio | **P2** |

## Distribuição

| Faixa | Quantidade | IDs |
|---|---:|---|
| Crítica | 2 | 001, 002 |
| Alta ou alta/bloqueador | 11 | 003–013 |
| Média/alta | 5 | 014–016, 018–019 |
| Média | 2 | 017, 020 |

## Dependências entre riscos

1. `LEON-AUD-008`, `009` e `010` impedem formar um candidato de release confiável.
2. `LEON-AUD-001` a `004` impedem autonomia ampla ou `danger-full-access` no uso cotidiano.
3. `LEON-AUD-005` a `007` impedem prometer continuidade após falha, mudança de máquina ou reinstalação.
4. `LEON-AUD-012`, `013` e `019` impedem operação Windows repetível e observável.
5. `LEON-AUD-014` a `018` afetam a experiência semelhante ao ChatGPT Work, mas devem ser tratados após os controles de segurança, dados e release.

## Riscos aceitos apenas temporariamente

Enquanto as correções P0 não forem concluídas, o único perfil recomendável é:

- uso local e single-user;
- `workspace-write`;
- rede e fallback externo desabilitados ou dependentes de confirmação explícita;
- navegador/UIA supervisionados;
- apenas uma instância do Leon por `$DSH_HOME`;
- backups manuais não tratados como recuperação comprovada;
- nenhuma alegação de prontidão para produção.
