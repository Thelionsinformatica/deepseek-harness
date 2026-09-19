# Estado do Sistema (Checkpoint de Estabilização)

Data: 04/09/2026

Este arquivo registra um checkpoint datado e não substitui a execução atual dos comandos de validação.

## Proteção de saída web — etapa de 04/09/2026

- O preset oficial `leon` usa `egressPolicy: ask` para `web_search` e `web_fetch`.
- Cada chamada exige autorização própria, com consultas ou URL completas no pedido; uma autorização não libera chamadas posteriores.
- Recusa, ausência de canal, política de aprovação `never`, cancelamento e prazo excedido impedem o contato por essas ferramentas.
- A aprovação e os argumentos ficam no registro local. Não há classificação automática de segredos: o usuário ainda pode autorizar conteúdo privado.
- Limite de escopo: isso não isola conexões de terminal, navegador, MCP, chamadas diretas ao serviço web ou tráfego de modelos externos.
- Validação sem APIs pagas e sem dados reais: **107 testes em 5 arquivos** e um cenário integrado pelo Loader, conferido também nos artefatos compilados. Apenas as duas chamadas aprovadas chegaram aos provedores simulados; os marcadores privados recusados não chegaram.
- Typecheck do workspace aprovado; lint aprovado após correções pelos estágios de compilação e `lint:contracts-ready`; Knip aprovado; **28/28 verificações de documentação** aprovadas.
- A porta 3080 não tinha listener na conferência desta etapa. O aplicativo do usuário não foi iniciado ou reiniciado; falta conferir a interação na Web UI real.

## Evidências da etapa anterior

- **Typecheck:** aprovado em todo o workspace.
- **Lint:** aprovado em todo o workspace.
- **Testes focados após as correções:** 32 aprovados em 4 arquivos.
- **UI Automation:** 6 testes aprovados na execução isolada da auditoria.
- **Duplicação:** nenhum clone encontrado em 1.288 arquivos pelo `jscpd`.
- **Código morto/órfão:** Knip aprovado com dicas tratadas como erro.
- **Documentação:** 28 de 28 verificações aprovadas.

## Pendências comprovadas

- **Suíte completa:** a execução de 03/09/2026 excedeu 120 segundos, registrou 11 listeners de saída e não produziu um resumo final. As duas falhas UIA observadas naquela execução não se repetiram isoladamente.
- **Dependências:** o último relatório disponível registra 8 vulnerabilidades, sendo 2 moderadas e 6 altas. A atualização da auditoria está bloqueada por `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; a cadeia de confiança TLS deve ser corrigida sem desativar a verificação de certificados.
- **Isolamento no Windows:** a proteção de escrita não comprova isolamento de leitura, rede ou processos. A proteção web desta etapa é específica às duas ferramentas nativas e não encerra esse achado.
- **Histórico Git:** os documentos pessoais retirados do checkout continuam no histórico anterior; não houve reescrita, commit ou publicação nesta etapa.
