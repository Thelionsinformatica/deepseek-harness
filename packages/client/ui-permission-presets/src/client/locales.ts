/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
  'confirm.title': '确认启用 Full access？',
  'confirm.description': '启用 Full access 后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用 Full access',
  'preset.readOnly': '只读',
  'preset.workspaceWrite': '工作区写入',
  'preset.fullAccess': '完全访问',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Brazilian Portuguese dictionary for the permission settings row. */
export const pt = {
  'title': 'Permissão',
  'description': 'Escolha o modo de permissão padrão para novas sessões',
  'loading': 'Carregando',
  'unavailable': 'Indisponível',
  'confirm.title': 'Ativar acesso total?',
  'confirm.description': 'O acesso total reduz as etapas de confirmação nas novas sessões e permite executar diretamente ações sensíveis, alterações em arquivos e comandos externos. Use somente em tarefas confiáveis.',
  'confirm.acknowledge': 'Entendo os riscos e quero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Ativar acesso total',
  'preset.readOnly': 'Somente leitura',
  'preset.workspaceWrite': 'Gravar no espaço de trabalho',
  'preset.fullAccess': 'Acesso total',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'confirm.title': '确认启用 Full access？',
  'confirm.description': '启用 Full access 后，agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用 Full access',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionAccessKey, string>

/** Brazilian Portuguese dictionary for the current-session popup gate. */
export const accessPt = {
  'confirm.title': 'Ativar acesso total?',
  'confirm.description': 'O acesso total reduz as etapas de confirmação e permite que o agente execute diretamente ações sensíveis, alterações em arquivos e comandos externos. Use somente quando confiar na tarefa atual.',
  'confirm.acknowledge': 'Entendo os riscos e quero continuar',
  'confirm.cancel': 'Cancelar',
  'confirm.enable': 'Ativar acesso total',
} satisfies Record<PermissionAccessKey, string>
