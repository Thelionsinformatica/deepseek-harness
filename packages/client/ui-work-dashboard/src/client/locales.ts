/** `work-dashboard` namespace dictionaries. */

/** Dictionary namespace owned by the Leon Work dashboard. */
export const NS = 'work-dashboard'

/** Brazilian Portuguese dictionary (the product-authored language). */
export const pt = {
  'aria': 'Painel Leon Work',
  'eyebrow': 'LEON WORK',
  'title': 'Seu espaço de trabalho inteligente',
  'description': 'Continue projetos, acompanhe tarefas e entregue resultados com controle local.',
  'newTask': 'Nova tarefa',
  'metric.projects': 'Projetos',
  'metric.projects.detail': 'espaços conectados',
  'metric.running': 'Em andamento',
  'metric.running.detail': 'tarefas trabalhando',
  'metric.waiting': 'Aguardando você',
  'metric.waiting.detail': 'ações que precisam de resposta',
  'metric.completed': 'Concluídas',
  'metric.completed.detail': 'entregas ainda não abertas',
  'metric.apiCost': 'API acumulada',
  'metric.apiCost.detail': '{count} chamadas com preço',
  'metric.apiCost.unpriced': '{count} chamadas ainda sem preço',
  'recent.title': 'Trabalhos recentes',
  'recent.empty': 'Suas conversas aparecerão aqui depois da primeira tarefa.',
  'recent.open': 'Continuar {name}',
  'workspace.ungrouped': 'Sem projeto',
  'status.waiting': 'Aguardando resposta',
  'status.running': 'Em andamento',
  'status.completed': 'Concluída',
  'status.ready': 'Pronta para continuar',
  'local.title': 'Local primeiro',
  'local.detail': 'O modelo atual aparece na barra de envio. Dados só devem seguir para uma API com sua autorização.',
} satisfies Record<string, string>

/** Dashboard locale key union. */
export type WorkDashboardKey = keyof typeof pt

/** English dictionary. */
export const en = {
  'aria': 'Leon Work dashboard',
  'eyebrow': 'LEON WORK',
  'title': 'Your intelligent workspace',
  'description': 'Continue projects, track tasks, and deliver results with local control.',
  'newTask': 'New task',
  'metric.projects': 'Projects',
  'metric.projects.detail': 'connected workspaces',
  'metric.running': 'In progress',
  'metric.running.detail': 'tasks working',
  'metric.waiting': 'Waiting for you',
  'metric.waiting.detail': 'actions that need an answer',
  'metric.completed': 'Completed',
  'metric.completed.detail': 'deliveries not yet opened',
  'metric.apiCost': 'Accumulated API',
  'metric.apiCost.detail': '{count} priced calls',
  'metric.apiCost.unpriced': '{count} calls still unpriced',
  'recent.title': 'Recent work',
  'recent.empty': 'Your conversations will appear here after the first task.',
  'recent.open': 'Continue {name}',
  'workspace.ungrouped': 'No project',
  'status.waiting': 'Waiting for an answer',
  'status.running': 'In progress',
  'status.completed': 'Completed',
  'status.ready': 'Ready to continue',
  'local.title': 'Local first',
  'local.detail': 'The current model appears in the composer. Data should reach an API only with your authorization.',
} satisfies Record<WorkDashboardKey, string>

/** Simplified Chinese dictionary. */
export const zh = {
  'aria': 'Leon Work 仪表板',
  'eyebrow': 'LEON WORK',
  'title': '你的智能工作空间',
  'description': '继续项目、跟踪任务，并在本地控制下交付结果。',
  'newTask': '新建任务',
  'metric.projects': '项目',
  'metric.projects.detail': '已连接的工作区',
  'metric.running': '进行中',
  'metric.running.detail': '正在工作的任务',
  'metric.waiting': '等待你处理',
  'metric.waiting.detail': '需要回答的操作',
  'metric.completed': '已完成',
  'metric.completed.detail': '尚未打开的交付',
  'metric.apiCost': '累计 API',
  'metric.apiCost.detail': '{count} 次已定价调用',
  'metric.apiCost.unpriced': '{count} 次调用尚未定价',
  'recent.title': '最近工作',
  'recent.empty': '完成第一个任务后，对话会显示在这里。',
  'recent.open': '继续 {name}',
  'workspace.ungrouped': '无项目',
  'status.waiting': '等待回答',
  'status.running': '进行中',
  'status.completed': '已完成',
  'status.ready': '可继续',
  'local.title': '本地优先',
  'local.detail': '当前模型显示在输入栏中。只有在你授权后，数据才应发送到 API。',
} satisfies Record<WorkDashboardKey, string>
