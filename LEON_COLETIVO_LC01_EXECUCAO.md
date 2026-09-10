# Leon Coletivo — laboratório de execução

Data: 06/09/2026. Checkout oficial: `D:\Leon\app`, branch `leon/estabilizacao-2026-09`, HEAD examinado `67ca70e150d4b99ce9f829bafe5826d0bfd098fa`.

Este registro complementa o histórico `LEON_COLETIVO_LC01_CONTROLE.md`, que descreve a etapa anterior. Não substitui os documentos originais. O checkout contém outras alterações locais, preservadas.

## Situação do marco

| Classificação | Situação |
| --- | --- |
| Implementado | Executor experimental, tarefas nativas simplificadas, mensagens, revisão e controles persistentes |
| Habilitado | Somente na composição de laboratório; não no perfil normal |
| Validado | Duas missões reais com Qwen3.5:4b, testes focados e Loader |
| Faltante | Confiabilidade estatística, comparação solo/coletivo, missões genéricas, dashboard e aprendizagem aprovada |

O primeiro marco funcional LC-01 foi demonstrado. Isso não declara concluído todo o roadmap do Leon Coletivo.

## Entrega e limites

Composição experimental executável, separada do Leon normal. Reutiliza Cordis, Agent Teams, armazenamento nativo, sessões distintas, quadro de tarefas e mensagens persistentes. Não cria outro banco autoritativo de tarefas.

- `mission-control.ts`: objetivo, critérios, prazo, orçamento, STOP persistente e resultado verificado.
- `execution.ts` e `inference-slot.ts`: fila de uma geração, reserva antes da chamada, rota fixa, limite de saída, oito passos por turno e cancelamento. O slot é liberado antes das ferramentas/esperas. A revisão final fecha novas admissões atomicamente antes de conferir evidências.
- `import-lab.ts`: inspeção, alteração exclusiva pelo coordenador e verificador determinístico de importação repetida. `mission_task` permite ao trabalhador iniciar/concluir sua tarefa pelo quadro nativo sem manipular revisões manualmente; pedidos concorrentes são serializados e não duplicam tarefas. A conclusão continua dependente do revisor. A missão exige saída correta, tarefas concluídas e verificação de trabalhador após recebimento de evidência de colega.
- `lab-bin.ts`: inicialização isolada, controle pelo terminal, exclusão entre processos e até duas devoluções do verificador, sem renovar limites. O verificador pode pedir nova medição ao checker por mensagem nativa, mas não inventa resultados nem conclui tarefas.
- `examples/headless-agent/collective.cordis.yml`: Qwen3.5:4b, dois trabalhadores, duas tarefas, 48 chamadas máximas e prazo de 15 minutos para novas missões. Tentativas anteriores mantêm os limites originalmente gravados.
- `collective.cordis.snapshot.yml`, `collective.snapshot.ts` e `collective-llm.mjs`: teste pelo Loader real com adaptador determinístico.

Os módulos e testes acima ficam em `packages/experimental/agent-team/{src,tests}`; a composição e suas fixtures ficam em `examples/headless-agent`. Também foram ajustados o manifesto, referências TypeScript e configuração de build do pacote, `pnpm-lock.yaml`, READMEs bilíngues, a nota de arquitetura experimental, `scripts/gen-cordis-catalog.ts` e os catálogos/grafos gerados. As extensões anteriores de revisão em `src/index.ts`, `src/task-board.ts`, `src/types.ts` e os testes de Team foram preservadas. Os padrões de documentação do repositório orientaram a separação entre implementação, habilitação e prova real.

A missão é deliberadamente pequena: corrigir a política JSON de uma importação, não programar um sistema arbitrário. Não estão habilitados shell, ferramentas gerais de arquivos, navegador, MCP, credenciais, promoção de memória ou fallback externo. Isto não é um sandbox para executar código hostil. Escritores externos à aplicação não são isolados pelo laboratório.

O contexto dinâmico contém identidade real, membros e tarefas; sua presença é verificada no log, não presumida pela configuração. A evidência é operacional, não uma exposição de raciocínio privado.

## Inicialização exata

Runtime portátil instalado exclusivamente para o laboratório: `D:\Leon\labs\coletivo-runtime-0.33.3\bin\ollama.exe`. O servidor desta validação usa `127.0.0.1:11439`; o perfil normal não foi reiniciado. Os modelos ficam em `D:\Leon\models\ollama`.

Se o servidor experimental não estiver iniciado, em PowerShell:

```powershell
if (Get-NetTCPConnection -LocalPort 11439 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Porta 11439 ocupada: identificar o processo antes de iniciar outra instância.'
}
$env:OLLAMA_HOST = '127.0.0.1:11439'
$env:OLLAMA_MODELS = 'D:\Leon\models\ollama'
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$env:OLLAMA_CONTEXT_LENGTH = '32768'
$env:OLLAMA_NO_CLOUD = '1'
Start-Process -FilePath 'D:\Leon\labs\coletivo-runtime-0.33.3\bin\ollama.exe' -ArgumentList 'serve' -WindowStyle Hidden
```

Não aceite um gateway desconhecido na porta como prova de inferência local. Verifique processo e `/api/version` antes da execução. O executável portátil foi obtido no release oficial Ollama v0.33.3; SHA-256 do ZIP comparado ao checksum publicado: `52CB36A62E7E501F61514F60212DEC7117B6C098811357585E02FFFE32D2FCD7`.

Fontes do runtime: [release oficial](https://github.com/ollama/ollama/releases/tag/v0.33.3), [distribuição portátil para Windows](https://docs.ollama.com/windows) e [compatibilidade local](https://docs.ollama.com/api/openai-compatibility). O placeholder de autenticação do adaptador não é uma chave real; a documentação do Ollama esclarece que esse campo é ignorado pelo servidor local.

Para uma nova missão, escolha um diretório vazio e execute:

```powershell
Set-Location 'D:\Leon\app'
node packages/experimental/agent-team/lib/lab-bin.js run D:\Leon\labs\minha-missao-coletiva D:\Leon\app\examples\headless-agent\collective.cordis.yml
```

O comando envia a demanda de importação aos agentes e mostra chamadas/resultados observados. Não há integração desta demonstração no dashboard normal.

## Parar, retomar e consultar

Durante a execução, digite `status`, `pause` ou `stop` e Enter no mesmo terminal. Ctrl+C solicita STOP persistente. `pause` encerra a execução preservando a possibilidade de retomada; o prazo continua correndo.

Após o processo sair:

```powershell
node D:\Leon\app\packages\experimental\agent-team\lib\lab-bin.js status D:\Leon\labs\minha-missao-coletiva D:\Leon\app\examples\headless-agent\collective.cordis.yml
node D:\Leon\app\packages\experimental\agent-team\lib\lab-bin.js resume D:\Leon\labs\minha-missao-coletiva D:\Leon\app\examples\headless-agent\collective.cordis.yml
```

Retomada aceita somente estado pausado. STOP não pode ser desfeito por reinício, novo prompt ou recriação da mesma missão. Uma missão bloqueada não recebe orçamento adicional. Crie outra missão para outro experimento.

Se uma queda ocorrer durante `reviewing`, não há aprovação automática nem retomada implícita. O registro deve ser inspecionado; essa recuperação ainda não foi automatizada. O cancelamento de um turno pela revisão final não significa que a missão foi cancelada: o resultado autoritativo é o estado persistido da missão.

O arquivo `.owner.lock` impede dois executores na mesma pasta. Após queda abrupta, conferir o PID registrado e ausência do processo antes de qualquer remoção manual desse arquivo. Não há remoção automática de lock potencialmente ativo.

Para voltar ao normal, encerre o laboratório e use o Leon habitual: seu perfil e seus modelos de 9B não foram substituídos. Não houve push, publicação, mudança de credenciais ou chamada a API paga.

## Validação

- Agent Teams, ferramentas, fila e controle: 98 testes aprovados em sete arquivos.
- Loader real: quatro cenários focados aprovados; outros 14 ficaram fora do filtro.
- Novo teste exige contexto de identidade presente nos registros: aprovado.
- A missão pelo Loader foi repetida três vezes após a correção da finalização: três aprovações consecutivas, incluindo STOP em novo processo. O teste cobre também as duas formas de chamar a entrega da tarefa.
- STOP após reabertura do armazenamento, cancelamento de stream, orçamento concorrente, veto a rota e ferramenta proibidas: testados.
- Novo processo pelo Loader: STOP persistido, retomada recusada e consulta posterior mantendo o cancelamento; aprovado.
- Escrita da política com arquivo temporário sincronizado, troca por rename e rejeição de digest antigo: testada. Isto não equivale a simular falha elétrica do disco.
- TypeScript e lint focado: aprovados. Documentação: após corrigir os achados e sincronizar os pares bilíngues, a última repetição completa passou nos 28 gates (183,18 s). Não se confunde isso com aprovação do lint/testes globais de todo o checkout.
- Qwen real: missão `coletivo-qwen-20260906-14` aprovada, processo encerrado com código 0 e consulta em novo processo confirmando `completed`. Usou 36/48 chamadas em aproximadamente 2 min 45 s. Duas tarefas concluídas, `peerMessage=true`, `workerVerification=true`, saída com dois registros e valor atualizado. Testes determinísticos não foram usados como substituto dessa validação.
- Repetição real `coletivo-qwen-20260906-15`: também `completed`, com as duas tarefas concluídas e ambas as provas de colaboração verdadeiras. Consumiu 48/48 chamadas: passou, mas sem margem de orçamento. Os arquivos estão na pasta e no log com esse mesmo identificador.

Evidências da missão aprovada:

- `D:\Leon\labs\coletivo-qwen-20260906-14.log`: chamadas e resultados observados.
- `D:\Leon\labs\coletivo-qwen-20260906-14\control\leon_collective.json`: estado persistido e resultado do verificador.
- `D:\Leon\labs\coletivo-qwen-20260906-14\sessions`: sessões distintas e mensagens nativas.
- `D:\Leon\labs\coletivo-qwen-20260906-14\import-policy.json`: artefato corrigido para `upsert`.

As rodadas anteriores foram mantidas, inclusive reprovações por orçamento, tarefas incompletas, falta de evidência entre colegas e problemas de integração corrigidos. São uma sequência de desenvolvimento com configurações diferentes, não uma amostra estatística de qualidade. Uma missão aprovada não torna o Qwen coordenador confiável para qualquer demanda.

Próxima prioridade: um conjunto pequeno de missões diferentes e comparação com execução individual, mantendo o laboratório separado. Não ampliar memória, modelos ou interface com base apenas nestas duas aprovações.

As primeiras rodadas usaram janela de 8.192 tokens. Foram observados cortes em que entrada + cache + saída totalizavam exatamente 8.192 (exemplo: 6.465 + 1.693 + 34). A configuração do laboratório foi corrigida para 32.768 no servidor e no adaptador. `/api/ps` confirmou 32.768 e `size_vram=4197596527` bytes para Qwen3.5:4b. Isso comprova carregamento local, não taxa de sucesso ou superioridade do coletivo.

Sem comparação solo/coletivo, benchmark estatístico, ensaio de queda de energia, missão genérica de programação, promoção de experiências ou validação de produção. Esses itens não são declarados concluídos.
