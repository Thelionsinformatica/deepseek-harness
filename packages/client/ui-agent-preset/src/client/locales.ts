/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetCodeName' | 'presetCodeDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'presetLeonName' | 'presetLeonDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'primaryGroup' | 'advancedGroup' | 'customGroup'
  | 'showAdvanced' | 'hideAdvanced'
  | 'brokenBadge' | 'brokenNoCopy'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Applies to sessions you start from now on. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Agent preset for the session you are about to start',
  headerHint: 'The agent preset this session runs, fixed when it started',
  nav: 'Agent presets',
  sectionIntro:
    'A preset is the plugin composition one session\'s agent runs — its tools, prompt, and capabilities. '
    + 'Duplicate an existing one and make it yours, or let the agent draft one for you in Creator mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  presetCodeName: 'PTC mode',
  presetCodeDescription:
    'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations in one TypeScript program.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'Two-tool coding agent with persistent bash and str_replace_editor.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  presetLeonName: 'Leon',
  presetLeonDescription:
    'The Lions Informática assistant for coding, project engineering, automation, and optional persistent memory.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This deployment has no writable preset directory',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  primaryGroup: 'Primary assistant',
  advancedGroup: 'Advanced modes',
  customGroup: 'Custom',
  showAdvanced: 'Show',
  hideAdvanced: 'Hide',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A preset that failed to load cannot be duplicated',
  copyOf: 'Copied from',
  composition: 'Composition (agent.cordis.yml)',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate preset',
  copyIntro:
    'The whole preset is copied on this machine. The identifier becomes its directory name and cannot '
    + 'be changed later; everything else is edited in the preset\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  creatorDraft: 'Draft a custom preset with Creator mode',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Preset files:',
  idRequired: 'Give the preset an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A preset with this identifier already exists.',
  deleteTitle: 'Delete this preset?',
  deleteDescription:
    'The preset directory is deleted. Sessions already running on it keep working; new sessions cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}

/** Brazilian Portuguese copy. */
export const pt: Record<AgentPresetSettingsKey, string> = {
  title: 'Preset do agente',
  description: 'Aplica-se às novas sessões. Sessões em andamento mantêm o preset com que foram iniciadas.',
  loading: 'Carregando presets…',
  error: 'Não foi possível carregar os presets do agente.',
  userTrust: 'Personalizado',
  seatHint: 'Preset do agente para a sessão que você iniciará',
  headerHint: 'Preset usado por esta sessão, definido quando ela foi iniciada',
  nav: 'Presets do agente',
  sectionIntro:
    'Um preset reúne as ferramentas, instruções e capacidades usadas pelo agente em uma sessão. '
    + 'Duplique um preset existente para personalizá-lo ou use o modo Criador para preparar um novo.',
  builtIn: 'Integrado',
  setDefault: 'Definir como padrão',
  view: 'Visualizar',
  presetStandardName: 'Modo padrão',
  presetStandardDescription:
    'Agente completo para programação, com edição de arquivos, terminal, pesquisa local e na web, skills, planos, metas, subagentes e fluxos de trabalho.',
  presetCodeName: 'Modo PTC',
  presetCodeDescription:
    'Inclui todos os recursos do modo padrão e permite combinar operações em várias etapas por meio do SDK do Modo Código.',
  presetMinimalName: 'Modo mínimo',
  presetMinimalDescription: 'Agente de programação com terminal persistente e edição estruturada de arquivos.',
  presetCordisName: 'Modo Criador',
  presetCordisDescription:
    'Inclui os recursos do modo padrão e ferramentas para inspecionar o sistema, experimentar plugins e criar presets.',
  presetLeonName: 'Leon',
  presetLeonDescription:
    'Assistente da The Lions Informática para programação, engenharia de projetos, automação e memória persistente opcional.',
  duplicate: 'Duplicar',
  duplicateUnavailable: 'Esta implantação não possui uma pasta de presets gravável',
  delete: 'Excluir',
  presetId: 'Identificador',
  presetIdPlaceholder: 'meu-agente',
  displayName: 'Nome',
  displayNamePlaceholder: 'Exibido no seletor; usa o identificador quando vazio',
  inUse: 'Em uso',
  primaryGroup: 'Assistente principal',
  advancedGroup: 'Modos avançados',
  customGroup: 'Personalizados',
  showAdvanced: 'Mostrar',
  hideAdvanced: 'Ocultar',
  noDescription: 'Sem descrição.',
  brokenBadge: 'Falha ao carregar',
  brokenNoCopy: 'Um preset que falhou ao carregar não pode ser duplicado',
  copyOf: 'Copiado de',
  composition: 'Composição (agent.cordis.yml)',
  cancel: 'Cancelar',
  close: 'Fechar',
  retry: 'Tentar novamente',
  copyTitle: 'Duplicar preset',
  copyIntro:
    'O preset completo será copiado neste computador. O identificador se tornará o nome da pasta e não poderá '
    + 'ser alterado depois; os demais dados ficam nos arquivos do próprio preset.',
  create: 'Criar',
  creating: 'Criando…',
  creatorDraft: 'Criar um preset personalizado no modo Criador',
  openLocation: 'Abrir pasta',
  showLocation: 'Mostrar local',
  revealedPathLabel: 'Arquivos do preset:',
  idRequired: 'Informe um identificador para o preset.',
  idInvalid: 'Use letras minúsculas, números e hífens, começando com uma letra ou número.',
  idTaken: 'Já existe um preset com este identificador.',
  deleteTitle: 'Excluir este preset?',
  deleteDescription:
    'A pasta do preset será excluída. Sessões que já o utilizam continuam funcionando; novas sessões não poderão selecioná-lo.',
  deleteConfirm: 'Excluir',
  deleting: 'Excluindo…',
}

/** Simplified Chinese copy. */
export const zh: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent 预设',
  description: '对此后新建的会话生效。运行中的会话保持它开始时的预设。',
  loading: '正在加载预设…',
  error: '无法加载 Agent 预设。',
  userTrust: '自定义',
  seatHint: '即将开始的这个会话所用的 Agent 预设',
  headerHint: '本会话运行的 Agent 预设，开始时即固定',
  nav: 'Agent 预设',
  sectionIntro: '预设即一个会话的 Agent 所运行的插件组装 —— 它的工具、提示词与能力。复制一份既有预设改成自己的，或用「创造模式」让 Agent 帮你创建。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  presetStandardName: '标准模式',
  presetStandardDescription: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
  presetCodeName: 'PTC 模式',
  presetCodeDescription: '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
  presetMinimalName: '极简模式',
  presetMinimalDescription: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
  presetCordisName: '创造模式',
  presetCordisDescription: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
  presetLeonName: 'Leon',
  presetLeonDescription: 'The Lions Informática 助手，面向编程、项目工程和自动化，并支持可选持久记忆。',
  duplicate: '复制',
  duplicateUnavailable: '此部署未配置可写的预设目录',
  delete: '删除',
  presetId: '标识符',
  presetIdPlaceholder: 'my-agent',
  displayName: '名称',
  displayNamePlaceholder: '选择器中显示的名字，缺省用标识符',
  inUse: '当前使用',
  primaryGroup: '主要助手',
  advancedGroup: '高级模式',
  customGroup: '自定义',
  showAdvanced: '显示',
  hideAdvanced: '收起',
  noDescription: '暂无描述。',
  brokenBadge: '加载失败',
  brokenNoCopy: '预设加载失败，不能复制',
  copyOf: '复制自',
  composition: '组装（agent.cordis.yml）',
  cancel: '取消',
  close: '关闭',
  retry: '重试',
  copyTitle: '复制预设',
  copyIntro: '整个预设会在本机复制一份。标识符将成为目录名，事后无法更改；其余内容之后直接在预设自己的文件里编辑。',
  create: '创建',
  creating: '正在创建…',
  creatorDraft: '用「创造模式」创作自定义预设',
  openLocation: '打开目录',
  showLocation: '查看路径',
  revealedPathLabel: '预设文件：',
  idRequired: '请填写标识符。',
  idInvalid: '只能使用小写字母、数字与连字符，且以字母或数字开头。',
  idTaken: '该标识符已被占用。',
  deleteTitle: '删除该预设？',
  deleteDescription: '预设目录将被删除。已在其上运行的会话不受影响；新会话将无法再选择它。',
  deleteConfirm: '删除',
  deleting: '正在删除…',
}

/** Preset roster fields needed to resolve Web display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  code: { name: 'presetCodeName', description: 'presetCodeDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
  leon: { name: 'presetLeonName', description: 'presetLeonDescription' },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
