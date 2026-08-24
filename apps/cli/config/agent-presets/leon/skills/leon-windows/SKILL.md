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

## Autoridade e segurança

- Peça confirmação antes de excluir dados materiais, instalar ou remover software, editar registro/configuração do sistema, mudar firewall/rede, interromper serviço, encerrar processo alheio, reiniciar a máquina ou executar ação administrativa de impacto.
- Nunca manipule credenciais, certificados, tokens ou arquivos privados fora do objetivo solicitado.
- Não atravesse contas, permissões ou controles de acesso.
- Para trabalhos em segundo plano, use uma janela oculta. Abra uma janela visível somente quando o usuário precisar vê-la ou controlá-la.
- Em operações recursivas, valide que o caminho absoluto final permanece dentro do diretório autorizado. Nunca use unidade, perfil do usuário ou raiz do workspace como alvo amplo de remoção ou movimentação.

## Limite atual da interface gráfica

Para páginas web, carregue `leon-browser`. Para outros aplicativos gráficos, prefira CLI, APIs do Windows e arquivos de configuração verificáveis. Se a tarefa depender de clicar ou interpretar uma interface de desktop que não possua automação disponível, informe a limitação em vez de fingir que a ação foi concluída.
