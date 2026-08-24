---
name: leon-browser
description: Navegar, ler, testar e interagir com sites em uma janela visível do navegador. Use quando o usuário pedir para abrir uma página, acompanhar uma tarefa no navegador, preencher um formulário, testar uma interface web ou operar um site.
---

# Navegação visível e segura

Use o Playwright CLI instalado com o Leon. Ele mantém uma sessão própria e mostra ao usuário a janela que está sendo controlada.

## Início

No Windows PowerShell, invoque sempre o executável fixado pelo Leon:

```powershell
& $env:DSH_NODE $env:DSH_PLAYWRIGHT_CLI -s=leon open "https://exemplo.com" --headed --browser=chrome --persistent
```

Em outros sistemas:

```bash
"$DSH_NODE" "$DSH_PLAYWRIGHT_CLI" -s=leon open "https://example.com" --headed --browser=chrome --persistent
```

Depois da abertura, use a mesma sessão `-s=leon` em todas as chamadas. Leia o snapshot retornado, use as referências dos elementos e execute uma ação por vez. Exemplos: `snapshot`, `find`, `click`, `fill`, `type`, `press`, `select`, `check`, `upload`, `tab-list`, `screenshot`, `console` e `requests`.

## Contexto persistente da página

Quando o usuário disser “esta página”, “a página aberta”, “essa tela” ou fizer outro pedido explícito sobre o navegador atual, não peça a URL. Resolva `scripts/context.mjs` a partir do diretório desta Skill e consulte primeiro a sessão `leon`:

```powershell
& $env:DSH_NODE "<skill>\scripts\context.mjs" inspect --session leon
```

Em outros sistemas:

```bash
"$DSH_NODE" "<skill>/scripts/context.mjs" inspect --session leon
```

O resultado contém URL, título, rota, carregamento, abas, resumo do console e uma árvore de acessibilidade limitada. Ele também mantém o último contexto em `$DSH_HOME/browser-context/` somente no computador local. Se nenhuma navegação, recarga, troca de aba ou ação ocorreu desde a inspeção, um acompanhamento pode consultar `status` e reutilizar o mesmo `snapshotId`; depois de qualquer mudança na página, execute `inspect` novamente. Use `clear` somente quando o usuário pedir para apagar esse cache.

Execute o helper apenas em uma solicitação explícita relacionada ao navegador. Ele não lê cookies, armazenamento, cabeçalhos ou corpos de requisição, não captura screenshot e não se conecta automaticamente ao navegador pessoal. Se retornar `SESSION_UNAVAILABLE`, abra uma página somente quando o usuário forneceu ou autorizou a URL; caso contrário, informe que a janela do Leon não está aberta.

## Fluxo de trabalho

1. Abra ou navegue até a URL solicitada em modo visível.
2. Consulte o contexto persistente ou inspecione `snapshot`/`find` antes de clicar ou preencher.
3. Execute a menor ação necessária e confira o novo estado.
4. Para testes de uma entrega, valide o fluxo principal, mensagens de erro, console e resultado visual.
5. Informe ao usuário o que foi confirmado e o que ainda depende de autenticação ou decisão humana.

Use `show` somente quando o usuário pedir o painel de acompanhamento. Use `run-code` ou `eval` apenas quando os comandos estruturados não forem suficientes e explique o motivo.

## Limites de autoridade

- Ler páginas, navegar e preencher um rascunho são ações preparatórias.
- Pare antes do clique que envia, publica, compra, paga, exclui, altera permissões, confirma cadastro ou produz outro efeito externo relevante. Mostre o alvo e peça confirmação explícita.
- Não leia nem exponha cookies, tokens, senhas, armazenamento de sessão ou outros segredos, salvo pedido explícito e necessário do usuário.
- Não envie arquivos privados a um site sem autorização específica para aquele destino.
- Não tente contornar CAPTCHA, autenticação multifator ou controles de acesso.

## Encerramento e falhas

Use `close` para encerrar a página quando solicitado. Não use `delete-data`, `close-all` ou `kill-all` sem confirmar o alvo e a necessidade. Se o navegador ou o comando não iniciar, não simule sucesso: informe que a capacidade está indisponível e preserve o restante da tarefa.
