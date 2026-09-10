# Leon Coletivo — controle persistente parcial

Data: 06/09/2026. Checkout: `D:\Leon\app`. Esta entrega continua o LC-00; não conclui o LC-01.

## Entregue

Entrada experimental `@deepseek-ai/dsh-experimental-agent-team/mission-control`, desativada na composição normal. Usa o armazenamento nativo `storage-domain`; tarefas e mensagens continuam exclusivamente no diário de sessões de Agent Teams.

O controle registra objetivo, critérios, proprietário, workspace, prazo, limite e consumo de tentativas. A reserva é atômica. Pausa e retomada verificam a revisão e não reiniciam o orçamento nem o prazo. STOP é terminal para a missão; reabrir o armazenamento ou tentar iniciar novamente a mesma raiz não o apaga. O host, não o modelo, controla essas operações.

## Arquivos desta etapa

- `packages/experimental/agent-team/src/mission-control.ts`: serviço e entrada opcional.
- `packages/experimental/agent-team/tests/mission-control.spec.ts`: persistência, concorrência, revisões, escopo e ciclo de vida.
- `packages/experimental/agent-team/{package.json,tsconfig.json,tsdown.config.ts}` e `pnpm-lock.yaml`: dependências e empacotamento da entrada.
- `examples/headless-agent/team.cordis.snapshot.yml`, `tests/fixtures/team-llm.mjs` e `tests/headless.snapshot.ts`: execução pelo Loader real, com armazenamento temporário e adaptador determinístico.
- README bilíngue do pacote, nota de arquitetura proposta, geradores e catálogos: contrato e limitações. Os padrões de documentação do repositório orientaram a separação entre controle implementado e execução ainda pendente.

## Validação executada

- Testes de Agent Teams e ferramentas: **86 aprovados, seis arquivos**.
- Aplicação real via Loader: **três aprovados, 14 fora do filtro**. Cobrem colaboração nativa, recusa de conclusão sem revisão e entrada de controle com STOP persistido.
- TypeScript do pacote: aprovado.
- Build filtrado do pacote experimental: aprovado; aviso de desempenho do gerador Typert.
- Lint focado, incluindo os geradores alterados: aprovado.
- Documentação: a execução completa passou em 26 de 28 gates. Os dois restantes (catálogo Cordis e grafo de serviços) foram corrigidos e repetidos individualmente, ambos aprovados. Não foi repetido o conjunto completo após a correção.
- `git diff --check`: aprovado. O lint global não foi repetido; a validação de lint foi focada nos arquivos desta etapa.

O teste inicial do Loader revelou acesso não declarado ao serviço de agentes e identificador de sessão incorreto na fixture. Foi corrigido usando dependências explícitas e o agente iniciador real; a repetição passou. Os testes não chamam provedores pagos.

## Reprodução

Na pasta `D:\Leon\app`:

```powershell
pnpm exec vitest run packages/experimental/agent-team/tests packages/experimental/tool-agent-team/tests
pnpm exec vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/headless.snapshot.ts -t 'mission STOP|host review|keyless Agent Team'
pnpm exec tsc -b packages/experimental/agent-team/tsconfig.json --pretty false
pnpm exec tsdown -F '@deepseek-ai/dsh-experimental-agent-team' --env.DSH_BUILD_FACE host
```

## Ainda não entregue

O controle não intercepta chamadas reais de inferência, não interrompe processos em andamento e não impõe fila de geração, rota exclusivamente local ou escrita exclusiva do coordenador. Não há exclusão entre dois processos compartilhando o mesmo armazenamento. O teste de recuperação reabre o runtime e o backend após encerramento normal; não simula queda de energia.

Qwen3.5-4B não foi instalado ou executado nesta etapa. Não há medição da RTX 4070, comparação solo/coletivo nem primeira missão real concluída e auditada. O laboratório não deve ser ativado como executor seguro antes de conectar essas proteções.

## Parar, retomar e preservar o normal

Não existe ainda comando de uso final do Leon Coletivo. Os comandos acima iniciam somente testes descartáveis. Na API interna, `transition(lead, revision, 'pause')` pausa; `resume` retoma apenas uma missão pausada, sem renovar limites; `stop` cancela definitivamente aquela missão. Isso não equivale, ainda, a cancelar os processos do executor.

Nenhum perfil normal, credencial ou configuração de produção foi alterado por esta etapa. Não foi feito push, publicação ou reinício do serviço normal. Não há troca de perfil a desfazer.

## Próximo marco

Conectar o controle persistente ao despacho real: reservar orçamento, validar a rota local final, obter um único slot de geração e liberá-lo antes de aguardar colegas. Depois integrar cancelamento, restrições de escrita e revisão de evidências, antes da missão com Qwen e dois trabalhadores.
