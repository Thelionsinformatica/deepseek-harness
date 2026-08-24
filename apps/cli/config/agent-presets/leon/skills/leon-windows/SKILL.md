---
name: leon-windows
description: Diagnosticar e operar o computador Windows com PowerShell, incluindo arquivos, processos, serviços, rede, aplicativos e ambiente local. Use quando o usuário pedir para verificar, configurar, abrir ou automatizar algo no próprio PC.
---

# Operação segura do Windows

Use as ferramentas nativas de arquivos para ler, pesquisar e editar conteúdo. Use PowerShell quando a tarefa exigir o sistema operacional, programas instalados, processos, serviços, rede, registro ou comandos de uma ferramenta local.

## Método

1. Descubra o estado atual com operações somente de leitura.
2. Resolva caminhos absolutos e alvos exatos antes de alterar algo.
3. Prefira comandos nativos do PowerShell e argumentos literais; não construa comandos destrutivos a partir de texto não validado.
4. Execute a menor mudança necessária e verifique o resultado no mesmo subsistema.
5. Informe o que mudou, o que foi comprovado e como desfazer quando existir reversão segura.

## Capacidades

- Arquivos e pastas: localizar, comparar, criar, editar, copiar e organizar dentro do escopo autorizado.
- Sistema: consultar versão, hardware, armazenamento, eventos, variáveis e programas instalados.
- Processos e serviços: inspecionar estado, caminho, dependências e logs. Não encerre processos nem reinicie serviços sem justificar o alvo e obter aprovação quando houver impacto.
- Rede: testar DNS, rotas, portas, interfaces e conectividade antes de propor alterações.
- Aplicativos: abrir um arquivo, URL ou programa solicitado. Uma abertura não prova que a interface concluiu a ação; valide por saída, arquivo, processo ou estado observável.
- Área de transferência: leia ou altere somente quando o usuário mencionar explicitamente o conteúdo copiado, pois ela pode conter dados privados.

## Interface gráfica por acessibilidade

No Windows, resolva `scripts/uia.ps1` a partir do diretório desta Skill. Use a interface de acessibilidade somente quando CLI, API ou arquivo de configuração não forem suficientes. O estado inicial é sempre somente leitura.

Liste as janelas e depois inspecione a janela em foco ou um `windowId` específico:

```powershell
& "<skill>\scripts\uia.ps1" windows
& "<skill>\scripts\uia.ps1" inspect -Depth 5 -MaxNodes 300
& "<skill>\scripts\uia.ps1" tree -WindowId "<processId>:<handle>" -Depth 5 -MaxNodes 300
```

O resultado fornece processo, título, `windowId`, tipo, `automationId`, nome e relações dos controles acessíveis. Os campos `ref` valem somente para a inspeção atual; para uma ação, prefira `automationId` ou use nome exato com `controlType`. Se o seletor encontrar zero ou vários controles, refine-o em vez de adivinhar.

Qualquer ação exige repetir exatamente o processo e a janela permitidos. Exemplos estruturais:

```powershell
& "<skill>\scripts\uia.ps1" invoke -WindowId "<id>" -AllowWindowId "<id>" -AllowProcess "notepad" -AutomationId "<id-do-controle>"
& "<skill>\scripts\uia.ps1" set-value -WindowId "<id>" -AllowWindowId "<id>" -AllowProcess "notepad" -AutomationId "<id-do-controle>" -Value "texto autorizado"
& "<skill>\scripts\uia.ps1" select -WindowId "<id>" -AllowWindowId "<id>" -AllowProcess "app" -ControlName "Opção" -ControlType "ListItem"
```

Antes de executar uma ação, inspecione novamente, confirme que `windowId`, processo e controle continuam iguais e obtenha aprovação quando o controle enviar, publicar, comprar, excluir, salvar material importante, alterar permissão ou produzir outro efeito externo relevante. Depois da ação, inspecione novamente e confira o resultado. Consulte a trilha local com:

```powershell
& "<skill>\scripts\uia.ps1" audit -Limit 50
```

Capture uma janela somente quando o usuário pedir uma imagem dela. Use um caminho absoluto para um arquivo PNG novo e a mesma permissão exata de processo/janela:

```powershell
& "<skill>\scripts\uia.ps1" screenshot -WindowId "<id>" -AllowWindowId "<id>" -AllowProcess "app" -OutputPath "C:\caminho\captura.png"
```

O conector não usa coordenadas, não injeta teclas globais, não preenche controles marcados como senha, não sobrescreve capturas e não eleva privilégios. Nunca capture tela, liste janelas ou inspecione controles em segundo plano sem um pedido relacionado ao computador ou aplicativo atual.

## Autoridade e segurança

- Peça confirmação antes de excluir dados materiais, instalar ou remover software, editar registro/configuração do sistema, mudar firewall/rede, interromper serviço, encerrar processo alheio, reiniciar a máquina ou executar ação administrativa de impacto.
- Nunca manipule credenciais, certificados, tokens ou arquivos privados fora do objetivo solicitado.
- Não atravesse contas, permissões ou controles de acesso.
- Para trabalhos em segundo plano, use uma janela oculta. Abra uma janela visível somente quando o usuário precisar vê-la ou controlá-la.
- Em operações recursivas, valide que o caminho absoluto final permanece dentro do diretório autorizado. Nunca use unidade, perfil do usuário ou raiz do workspace como alvo amplo de remoção ou movimentação.

## Limites da interface gráfica

Para páginas web, carregue `leon-browser`. UI Automation enxerga somente controles expostos pela acessibilidade do aplicativo; superfícies desenhadas como pixels, jogos, áreas protegidas e alguns programas legados podem aparecer vazios. Nesses casos, não troque silenciosamente para cliques por coordenadas nem simule sucesso: informe a limitação e peça ao usuário outro caminho verificável.
