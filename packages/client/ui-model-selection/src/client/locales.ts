/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` reads identically to `trigger.fallback` today and is
 * still a separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'trigger.ariaAutomatic': 'Leon 自动模式，当前使用 {model}',
  'trigger.ariaAutomaticEffort': 'Leon 自动模式，当前使用 {model}，推理等级 {effort}',
  'automatic.name': 'Leon 自动',
  'automatic.description': '从本地模型开始，复杂任务使用本地 Ornith；只有本地路由失败且获得授权后才使用外部 API',
  'automatic.externalConsent.name': '允许通过 API 使用外部备用模型',
  'automatic.externalConsent.description': '可能会将此对话的上下文发送给外部提供商，并产生 API 费用。默认关闭。',
  'automatic.action.enable': '启用 Leon 自动模式',
  'automatic.action.save': '保存设置',
  'menu.aria': '模型与推理等级',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供推理等级。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'trigger.ariaAutomatic': 'Leon Automatic, currently using {model}',
  'trigger.ariaAutomaticEffort': 'Leon Automatic, currently using {model}, reasoning effort {effort}',
  'automatic.name': 'Leon Automatic',
  'automatic.description': 'Starts locally, uses local Ornith for complex work, and uses an external API only after a local failure and explicit consent',
  'automatic.externalConsent.name': 'Allow API fallback',
  'automatic.externalConsent.description': 'This may send this conversation context to an external provider and incur API charges. Off by default.',
  'automatic.action.enable': 'Enable Leon Automatic',
  'automatic.action.save': 'Save preference',
  'menu.aria': 'Model and reasoning effort',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
} satisfies Record<ModelKey, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'command.description': 'Selecionar o modelo desta conversa',
  'option.loadError': 'Falha ao carregar o catálogo: {message}',
  'trigger.fallback': 'Selecionar modelo',
  'trigger.selectAria': 'Selecionar modelo',
  'trigger.aria': 'Selecionar modelo, atual {model}',
  'trigger.ariaEffort': 'Selecionar modelo, atual {model}, esforço de raciocínio {effort}',
  'trigger.ariaAutomatic': 'Leon Automático, usando agora {model}',
  'trigger.ariaAutomaticEffort': 'Leon Automático, usando agora {model}, esforço de raciocínio {effort}',
  'automatic.name': 'Leon Automático',
  'automatic.description': 'Começa localmente, usa o Ornith em tarefas complexas e só usa API após falha local e autorização.',
  'automatic.externalConsent.name': 'Permitir fallback por API',
  'automatic.externalConsent.description': 'Pode enviar o contexto desta conversa a um provedor externo e gerar custos de API. Desligado por padrão.',
  'automatic.action.enable': 'Ativar Leon Automático',
  'automatic.action.save': 'Salvar preferência',
  'menu.aria': 'Modelo e esforço de raciocínio',
  'menu.model': 'Modelo',
  'menu.effort': 'Esforço',
  'effort.providerDefault': 'Padrão',
  'status.loading': 'Atualizando lista de modelos…',
  'error.action': 'Falha na operação do modelo: {message}',
  'action.reload': 'Recarregar',
  'warning.groupLoad': 'Falha ao carregar {name}: {message}',
  'empty.models': 'Nenhum modelo disponível.',
  'blocked.composer': 'Este modelo está indisponível — selecione outro para continuar',
  'empty.efforts': 'Este modelo não oferece níveis de esforço de raciocínio.',
} satisfies Record<ModelKey, string>
