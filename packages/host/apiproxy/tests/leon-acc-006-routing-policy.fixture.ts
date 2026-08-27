import type { PromptContentPart } from '../src/api/sessions.ts'
import type { AdaptiveRoutingConfig, AdaptiveRoutingDecision } from '../src/adaptive-model.ts'

/**
 * LEON-ACC-006 first-layer fixture.
 *
 * This corpus measures only the initial Leon Automatic routing policy. It does
 * not call a model and therefore proves neither answer quality nor completion
 * of the described tasks.
 */
export interface LeonAcc006RoutingTask {
  id: string
  title: string
  content: readonly PromptContentPart[]
  hasHistory: boolean
  goalRound?: number
  expectedTier: AdaptiveRoutingDecision['tier']
  expectedModel: 'qwen3.5:9b' | 'ornith-1.5:9b'
}

/** Leon's shipped local thresholds and initial model roles, without failover execution. */
export const leonAcc006RoutingConfig: AdaptiveRoutingConfig = {
  provider: 'ollama',
  fastProvider: 'ollama',
  mainProvider: 'ollama',
  expertProvider: 'ollama',
  fastModel: 'qwen3.5:9b',
  mainModel: 'qwen3.5:9b',
  expertModel: 'ornith-1.5:9b',
  fastReasoningEffort: 'off',
  mainReasoningEffort: 'medium',
  expertReasoningEffort: 'high',
  simpleMaxCharacters: 280,
  expertMinCharacters: 700,
  goalRoundTiers: [
    { fromRound: 1, provider: 'ollama', model: 'ornith-1.5:9b', reasoningEffort: 'high' },
  ],
}

const longTechnicalRequest = [
  'Implemente uma área administrativa para um sistema de atendimento.',
  'Inclua cadastro de clientes e profissionais.',
  'Inclua agenda com bloqueio de conflitos.',
  'Inclua serviços e duração configurável.',
  'Inclua permissões por função.',
  'Inclua fluxo de caixa diário.',
  'Inclua contas a receber.',
  'Inclua relatórios mensais.',
  'Inclua exportação dos dados.',
  'Inclua validação dos formulários.',
  'Inclua tratamento de erros.',
  'Inclua testes de integração.',
  'Inclua instruções de instalação.',
].join('\n')

const oversizedRequest = `Analise este projeto e proponha uma solução técnica detalhada. ${'Considere requisitos, riscos, validação e reversão segura. '.repeat(14)}`

/** Thirty fixed PT-BR task descriptions spanning fast, main, expert, and goal-round tiers. */
export const leonAcc006RoutingTasks = [
  {
    id: 'LEON-ACC-006-001',
    title: 'Saudação curta',
    content: [{ type: 'text', text: 'Olá, Leon.' }],
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-002',
    title: 'Pergunta factual curta',
    content: [{ type: 'text', text: 'Qual é a capital de Sergipe?' }],
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-003',
    title: 'Reescrita breve',
    content: [{ type: 'text', text: 'Reescreva esta frase de forma mais clara: atendimento rápido e seguro.' }],
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-004',
    title: 'Cálculo simples',
    content: [{ type: 'text', text: 'Quanto é 18 por cento de 350?' }],
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-005',
    title: 'Explicação em uma frase',
    content: [{ type: 'text', text: 'Explique em uma frase o que significa DNS.' }],
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-006',
    title: 'Tradução curta',
    content: [{ type: 'text', text: 'Traduza para português: reliable local assistant.' }],
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-007',
    title: 'Lista breve',
    content: [{ type: 'text', text: 'Liste três maneiras de organizar melhor a rotina.' }],
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-008',
    title: 'Resposta curta com histórico sem continuação',
    content: [{ type: 'text', text: 'Responda apenas com sim ou não.' }],
    hasHistory: true,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-009',
    title: 'Análise de arquivo',
    content: [{ type: 'text', text: 'Analise este arquivo e aponte inconsistências.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-010',
    title: 'Implementação de função',
    content: [{ type: 'text', text: 'Implemente uma função TypeScript que valide um endereço de e-mail.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-011',
    title: 'Correção de teste',
    content: [{ type: 'text', text: 'Corrija o teste unitário que falha ao receber uma lista vazia.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-012',
    title: 'Comparação técnica',
    content: [{ type: 'text', text: 'Compare SQLite e PostgreSQL para um aplicativo usado por uma pequena equipe.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-013',
    title: 'Planejamento de migração',
    content: [{ type: 'text', text: 'Planeje a migração de uma aplicação local para outro computador Windows.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-014',
    title: 'Investigação de falha',
    content: [{ type: 'text', text: 'Investigue por que o serviço inicia, mas não responde na porta configurada.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-015',
    title: 'Refatoração localizada',
    content: [{ type: 'text', text: 'Refatore esta classe para separar validação e persistência.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-016',
    title: 'Criação de testes',
    content: [{ type: 'text', text: 'Crie testes de integração para o cadastro de profissionais.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-017',
    title: 'Trecho de código',
    content: [{ type: 'text', text: '```ts\nfunction total(valor: number) {\n  return valor\n}\n```\nRevise este trecho.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-018',
    title: 'Continuação contextual',
    content: [{ type: 'text', text: 'Pode continuar de onde parou.' }],
    hasHistory: true,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-019',
    title: 'Solicitação com várias linhas',
    content: [{ type: 'text', text: 'Organize a entrega.\nSepare as etapas.\nIndique os riscos.\nDefina os responsáveis.\nEstabeleça a validação.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-020',
    title: 'Solicitação acima do limite simples',
    content: [{
      type: 'text',
      text: 'Descreva uma estratégia prática para organizar compromissos, separar prioridades, acompanhar pendências e revisar resultados semanalmente, mantendo uma linguagem objetiva, etapas pequenas, responsáveis claros, prazos realistas e uma forma mensurável de confirmar se cada atividade produziu o resultado esperado.',
    }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-021',
    title: 'Consulta SQL',
    content: [{ type: 'text', text: 'Escreva uma consulta SELECT que totalize os pagamentos por profissional.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-022',
    title: 'Autenticação do sistema',
    content: [{ type: 'text', text: 'Analise o fluxo de autenticação e indique dois riscos objetivos.' }],
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
  },
  {
    id: 'LEON-ACC-006-023',
    title: 'Auditoria completa',
    content: [{ type: 'text', text: 'Faça uma auditoria completa deste projeto.' }],
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
  },
  {
    id: 'LEON-ACC-006-024',
    title: 'Análise profunda',
    content: [{ type: 'text', text: 'Faça uma análise profunda do mecanismo de recuperação após falhas.' }],
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
  },
  {
    id: 'LEON-ACC-006-025',
    title: 'Arquitetura integral',
    content: [{ type: 'text', text: 'Revise toda a arquitetura e apresente os principais riscos técnicos.' }],
    hasHistory: true,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
  },
  {
    id: 'LEON-ACC-006-026',
    title: 'Projeto completo',
    content: [{ type: 'text', text: 'Implemente o projeto completo com validação e testes automatizados.' }],
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
  },
  {
    id: 'LEON-ACC-006-027',
    title: 'Solicitação estruturada extensa',
    content: [{ type: 'text', text: longTechnicalRequest }],
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
  },
  {
    id: 'LEON-ACC-006-028',
    title: 'Solicitação acima do limite especialista',
    content: [{ type: 'text', text: oversizedRequest }],
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
  },
  {
    id: 'LEON-ACC-006-029',
    title: 'Entrada multimodal',
    content: [
      { type: 'text', text: 'Descreva o conteúdo visual anexado.' },
      { type: 'image', mediaType: 'image/png', data: 'AQ==' },
    ],
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
  },
  {
    id: 'LEON-ACC-006-030',
    title: 'Primeiro round de objetivo',
    content: [],
    hasHistory: true,
    goalRound: 1,
    expectedTier: 'goal-round',
    expectedModel: 'ornith-1.5:9b',
  },
] as const satisfies readonly LeonAcc006RoutingTask[]

/**
 * Offline dispatch boundary for this gate. Any external selection fails before
 * an adapter or network client could be reached.
 */
export function dispatchThroughLeonAcc006Sentinel(
  decision: AdaptiveRoutingDecision,
): AdaptiveRoutingDecision {
  if (decision.provider !== 'ollama') {
    throw new Error(
      `LEON-ACC-006_EXTERNAL_ROUTE_BLOCKED: ${decision.provider}/${decision.model}`,
    )
  }
  return decision
}
