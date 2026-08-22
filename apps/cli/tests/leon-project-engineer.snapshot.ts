import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/leon-project-engineer/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/leon-project-engineer/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const skillPath = fileURLToPath(
  new URL('../config/agent-presets/leon/skills/leon-project-engineer/', import.meta.url),
).replace(/[\\/]$/, '')
const encodedSkillPath = JSON.stringify(skillPath).slice(1, -1)

describe('Leon project engineer assembled snapshot', () => {
  it('advertises and loads the project workflow through the shipped app', async () => {
    const result = await runLoaderSmoke({
      label: 'Leon project engineer skill snapshot',
      tempDirPrefix: 'headless-snapshot-leon-project-engineer-',
      binScript,
      libBinScript: binScript,
      binArgs: [configPath, 'leon-project-engineer'],
      configPath,
      tsconfigPath,
      processTimeoutMs: 90_000,
    })
    const snapshot = JSON.parse(
      result.stdout.replaceAll(encodedSkillPath, '{{leonSkillPath}}'),
    ) as unknown

    expect(result.stderr).toBe('')
    expect(snapshot).toMatchInlineSnapshot(`
      {
        "catalog": [
          {
            "text": "<system-reminder>
      A skill is a reusable set of task-specific instructions. The following skills are available in this session:

      <available_skills>
      - \`leon-project-engineer\`: Analisar, diagnosticar, corrigir, implementar e verificar mudanças em projetos de software. Use quando o usuário pedir auditoria técnica, correção de erro, refatoração, nova funcionalidade ou preparação de uma mudança para entrega.
      </available_skills>

      If the user names a skill, or the task clearly matches a skill's description, call the \`skill\` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
      A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the \`skill\` tool again for that skill.
      </system-reminder>",
            "type": "text",
          },
        ],
        "result": {
          "content": [
            {
              "text": "<skill_content name="leon-project-engineer">
      <skill_resources>
      Base directory for this skill: {{leonSkillPath}}
      Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
      </skill_resources>

      <skill_instructions>
      # Engenharia de projetos do Leon

      Transforme o pedido em uma mudança verificável, preservando o trabalho existente e a autoridade do usuário.

      ## Antes de agir

      - Identifique o resultado esperado e os limites do pedido. Resolva pelo próprio projeto fatos que possam ser descobertos com leitura e busca.
      - Leia as instruções do workspace e inspecione a estrutura, o estado do controle de versão e os padrões usados pelos arquivos relacionados.
      - Diferencie explicação, diagnóstico e implementação. Um pedido de diagnóstico autoriza investigar e explicar, mas não alterar arquivos.
      - Para trabalhos com várias etapas dependentes, registre um plano curto e mantenha somente uma etapa em andamento. Não crie um plano para uma alteração trivial.

      ## Implementação segura

      - Prefira a menor mudança coerente que atenda ao resultado solicitado e siga as extensões já existentes no projeto.
      - Preserve alterações do usuário e arquivos fora do escopo. Não reverta, apague ou sobrescreva trabalho que não pertence à tarefa.
      - Inspecione os alvos exatos antes de qualquer operação destrutiva. Peça confirmação quando a ação for irreversível ou ampliar materialmente o escopo.
      - Não publique, envie mensagens, abra uma PR ou altere sistemas externos sem autorização do usuário para essa entrega.
      - Comunique progresso em trabalhos demorados e informe cedo uma suposição que possa mudar o resultado.

      ## Verificação e entrega

      - Execute o teste mais próximo do comportamento alterado. Acrescente lint, typecheck, build ou testes mais amplos conforme o risco e as regras do projeto.
      - Revise o diff final para detectar mudanças acidentais, credenciais, arquivos gerados indevidos e diferenças de formatação.
      - Se uma verificação não puder rodar, informe o comando, o motivo e o que permanece sem comprovação. Nunca apresente uma verificação pendente como aprovada.
      - Entregue primeiro o resultado. Depois informe os principais arquivos alterados, as verificações realizadas e qualquer limitação ou próximo passo realmente necessário.
      </skill_instructions>
      </skill_content>",
              "type": "text",
            },
          ],
          "isError": false,
          "value": {
            "content": "# Engenharia de projetos do Leon

      Transforme o pedido em uma mudança verificável, preservando o trabalho existente e a autoridade do usuário.

      ## Antes de agir

      - Identifique o resultado esperado e os limites do pedido. Resolva pelo próprio projeto fatos que possam ser descobertos com leitura e busca.
      - Leia as instruções do workspace e inspecione a estrutura, o estado do controle de versão e os padrões usados pelos arquivos relacionados.
      - Diferencie explicação, diagnóstico e implementação. Um pedido de diagnóstico autoriza investigar e explicar, mas não alterar arquivos.
      - Para trabalhos com várias etapas dependentes, registre um plano curto e mantenha somente uma etapa em andamento. Não crie um plano para uma alteração trivial.

      ## Implementação segura

      - Prefira a menor mudança coerente que atenda ao resultado solicitado e siga as extensões já existentes no projeto.
      - Preserve alterações do usuário e arquivos fora do escopo. Não reverta, apague ou sobrescreva trabalho que não pertence à tarefa.
      - Inspecione os alvos exatos antes de qualquer operação destrutiva. Peça confirmação quando a ação for irreversível ou ampliar materialmente o escopo.
      - Não publique, envie mensagens, abra uma PR ou altere sistemas externos sem autorização do usuário para essa entrega.
      - Comunique progresso em trabalhos demorados e informe cedo uma suposição que possa mudar o resultado.

      ## Verificação e entrega

      - Execute o teste mais próximo do comportamento alterado. Acrescente lint, typecheck, build ou testes mais amplos conforme o risco e as regras do projeto.
      - Revise o diff final para detectar mudanças acidentais, credenciais, arquivos gerados indevidos e diferenças de formatação.
      - Se uma verificação não puder rodar, informe o comando, o motivo e o que permanece sem comprovação. Nunca apresente uma verificação pendente como aprovada.
      - Entregue primeiro o resultado. Depois informe os principais arquivos alterados, as verificações realizadas e qualquer limitação ou próximo passo realmente necessário.",
            "name": "leon-project-engineer",
            "provider": "filesystem",
            "resourceBase": {
              "kind": "directory",
              "path": "{{leonSkillPath}}",
            },
          },
        },
        "summary": {
          "description": "Analisar, diagnosticar, corrigir, implementar e verificar mudanças em projetos de software. Use quando o usuário pedir auditoria técnica, correção de erro, refatoração, nova funcionalidade ou preparação de uma mudança para entrega.",
          "invocation": {
            "modelInvocable": true,
            "userInvocable": true,
          },
          "name": "leon-project-engineer",
          "provider": "filesystem",
          "resourceBase": {
            "kind": "directory",
            "path": "{{leonSkillPath}}",
          },
          "source": "custom",
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS + 60_000)
})
