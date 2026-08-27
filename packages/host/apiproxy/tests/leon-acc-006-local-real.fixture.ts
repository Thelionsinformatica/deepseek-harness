import type { AdaptiveRoutingDecision } from '../src/adaptive-model.ts'

/** One deterministic task executed by a real loopback Ollama model. */
export interface LeonAcc006LocalTask {
  id: string
  title: string
  prompt: string
  hasHistory: boolean
  goalRound?: number
  expectedTier: AdaptiveRoutingDecision['tier']
  expectedModel: 'qwen3.5:9b' | 'ornith-1.5:9b'
  acceptedAnswers: readonly string[]
}

const mediumLengthPrompt = [
  'Analise a sequência apresentada e siga somente a instrução final.',
  'Este texto inclui detalhes suficientes para representar uma solicitação maior que uma pergunta curta,',
  'mas não exige revisar todos os módulos nem executar ferramentas externas.',
  'O identificador verificável desta tarefa é L00620.',
  'Retorne no campo answer somente o identificador verificável, sem explicação.',
].join(' ')

const expertLengthPrompt = [
  'Analise este projeto e produza internamente uma avaliação detalhada antes de responder.',
  'Considere requisitos, riscos, validação, recuperação, observabilidade e reversão segura. '.repeat(12),
  'O código verificável é ORION-28. Retorne no campo answer somente esse código, sem explicação.',
].join(' ')

const thirteenLinesPrompt = [
  'Conte as linhas de dados abaixo e retorne no campo answer somente a quantidade.',
  'linha 01',
  'linha 02',
  'linha 03',
  'linha 04',
  'linha 05',
  'linha 06',
  'linha 07',
  'linha 08',
  'linha 09',
  'linha 10',
  'linha 11',
  'linha 12',
  'linha 13',
].join('\n')

/**
 * Fixed PT-BR corpus for real local inference. Each task has an exact local
 * oracle; this measures deterministic response completion, not tool use.
 */
export const leonAcc006LocalTasks = [
  {
    id: 'LEON-ACC-006-LOCAL-001',
    title: 'Soma elementar',
    prompt: 'Some 2 mais 3. Retorne no campo answer somente o resultado numérico.',
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['5'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-002',
    title: 'Capital estadual',
    prompt: 'Qual é a capital de Sergipe? Retorne no campo answer somente o nome da cidade.',
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['aracaju'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-003',
    title: 'Conversão para maiúsculas',
    prompt: 'Converta a palavra Leon para letras maiúsculas. Retorne no campo answer somente a palavra.',
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['leon'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-004',
    title: 'Ordenação numérica',
    prompt: 'Ordene 3, 1 e 2 em ordem crescente. Retorne no campo answer somente 1,2,3.',
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['1,2,3'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-005',
    title: 'Contagem de letras',
    prompt: 'Quantas letras existem na palavra LEON? Retorne no campo answer somente o número.',
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['4'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-006',
    title: 'Porcentagem',
    prompt: 'Calcule 18 por cento de 350. Retorne no campo answer somente o resultado numérico.',
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['63'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-007',
    title: 'Tradução de palavra',
    prompt: 'Traduza reliable para português. Retorne no campo answer somente uma palavra.',
    hasHistory: false,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['confiavel'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-008',
    title: 'Comparação booleana',
    prompt: 'Dez é maior que sete? Retorne no campo answer somente sim ou nao.',
    hasHistory: true,
    expectedTier: 'fast',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['sim'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-009',
    title: 'Análise de soma',
    prompt: 'Analise os números 2, 4 e 6. Retorne no campo answer somente a soma.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['12'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-010',
    title: 'Implementação mental de expressão',
    prompt: 'Implemente mentalmente a multiplicação 7 vezes 8. Retorne no campo answer somente o resultado.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['56'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-011',
    title: 'Correção aritmética',
    prompt: 'Corrija o teste: a expressão 3 mais 6 deve produzir qual valor? Retorne apenas o valor no campo answer.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['9'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-012',
    title: 'Comparação de valores',
    prompt: 'Compare 12 e 21. Retorne no campo answer somente o maior valor.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['21'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-013',
    title: 'Planejamento de ordem',
    prompt: 'Planeje a ordem alfabética dos itens B, A e C. Retorne no campo answer somente A,B,C.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['a,b,c'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-014',
    title: 'Investigação de HTTP',
    prompt: 'Investigue o significado padrão do status HTTP 404. Retorne no campo answer exatamente NAO_ENCONTRADO.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['nao_encontrado'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-015',
    title: 'Refatoração de duplicatas',
    prompt: 'Refatore a lista azul, azul, verde removendo duplicatas. Retorne no campo answer somente azul,verde.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['azul,verde'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-016',
    title: 'Teste de limite',
    prompt: 'Em testes unitários, a regra aceita valores menores ou iguais a 10. Para o valor 10, retorne no campo answer somente VALIDO.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['valido'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-017',
    title: 'Leitura de função',
    prompt: 'Considere `function proximo(n) { return n + 1 }`. Para n igual a 4, retorne no campo answer somente o resultado.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['5'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-018',
    title: 'Continuação contextual autossuficiente',
    prompt: 'Continue de onde parou: o valor parcial era 20 e agora deve subtrair 11. Retorne no campo answer somente o resultado.',
    hasHistory: true,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['9'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-019',
    title: 'Concatenação multilinha',
    prompt: 'Analise os valores abaixo e concatene na ordem.\na\nb\nc\nd\ne\nRetorne no campo answer somente abcde.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['abcde'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-020',
    title: 'Identificador em solicitação média',
    prompt: mediumLengthPrompt,
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['l00620'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-021',
    title: 'Soma de valores SQL',
    prompt: 'Uma consulta SELECT retorna os valores 10, 20 e 30. Retorne no campo answer somente a soma.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['60'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-022',
    title: 'Papéis únicos de autenticação',
    prompt: 'Analise os papéis de autenticação admin, leitor e admin. Retorne no campo answer somente a quantidade de papéis únicos.',
    hasHistory: false,
    expectedTier: 'main',
    expectedModel: 'qwen3.5:9b',
    acceptedAnswers: ['2'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-023',
    title: 'Auditoria de duplicata',
    prompt: 'Faça uma auditoria completa da lista A, B, A, C. Retorne no campo answer somente o item duplicado.',
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
    acceptedAnswers: ['a'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-024',
    title: 'Análise profunda de sequência',
    prompt: 'Faça uma análise profunda da sequência 2, 4, 8, 16. Retorne no campo answer somente o próximo número.',
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
    acceptedAnswers: ['32'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-025',
    title: 'Contagem da arquitetura',
    prompt: 'Revise toda a arquitetura formada pelos componentes interface, API e banco. Retorne no campo answer somente a quantidade de componentes.',
    hasHistory: true,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
    acceptedAnswers: ['3'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-026',
    title: 'Prioridade do projeto completo',
    prompt: 'Considere um projeto completo dividido em MVP e melhorias futuras. Retorne no campo answer somente a etapa que deve vir primeiro: MVP.',
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
    acceptedAnswers: ['mvp'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-027',
    title: 'Contagem estruturada extensa',
    prompt: thirteenLinesPrompt,
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
    acceptedAnswers: ['13'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-028',
    title: 'Identificador em solicitação especialista',
    prompt: expertLengthPrompt,
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
    acceptedAnswers: ['orion-28'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-029',
    title: 'Segurança da arquitetura em produção',
    prompt: 'Analise a segurança desta arquitetura em produção usando as portas 80 e 443. Retorne no campo answer somente a maior porta.',
    hasHistory: false,
    expectedTier: 'expert',
    expectedModel: 'ornith-1.5:9b',
    acceptedAnswers: ['443'],
  },
  {
    id: 'LEON-ACC-006-LOCAL-030',
    title: 'Primeiro round de objetivo',
    prompt: 'Some 40 mais 2. Retorne no campo answer somente o resultado numérico.',
    hasHistory: true,
    goalRound: 1,
    expectedTier: 'goal-round',
    expectedModel: 'ornith-1.5:9b',
    acceptedAnswers: ['42'],
  },
] as const satisfies readonly LeonAcc006LocalTask[]

/** Normalize harmless formatting variation while preserving the task's semantic oracle. */
export function normalizeLeonAcc006Answer(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, ' ')
}
