/** `web-access` namespace dictionaries. */

/** Dictionary namespace owned by the composer control. */
export const NS = 'web-access'

/** Brazilian Portuguese dictionary (the product-authored language). */
export const pt = {
  'off.aria': 'Ativar acesso web nesta sessão',
  'off.title': 'Ativar acesso web nesta sessão para pesquisas e leitura de páginas públicas.',
  'on.aria': 'Desativar acesso web nesta sessão',
  'on.title': 'Acesso web ativo nesta sessão. Clique para revogar imediatamente.',
  'pending': 'Atualizando acesso web…',
  'failure': 'Não foi possível atualizar o acesso web',
} as const

/** Locale key union. */
export type WebAccessKey = keyof typeof pt

/** English dictionary. */
export const en = {
  'off.aria': 'Enable web access for this session',
  'off.title': 'Enable web access in this session for public searches and page reading.',
  'on.aria': 'Disable web access for this session',
  'on.title': 'Web access is active for this session. Select to revoke it immediately.',
  'pending': 'Updating web access…',
  'failure': 'Could not update web access',
} satisfies Record<WebAccessKey, string>

/** Simplified Chinese dictionary. */
export const zh = {
  'off.aria': '为此会话启用 Web 访问',
  'off.title': '为此会话启用公开搜索和网页读取的 Web 访问。',
  'on.aria': '为此会话禁用 Web 访问',
  'on.title': '此会话的 Web 访问已启用。点击可立即撤销。',
  'pending': '正在更新 Web 访问…',
  'failure': '无法更新 Web 访问',
} satisfies Record<WebAccessKey, string>
