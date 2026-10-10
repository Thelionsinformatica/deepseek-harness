/** `web-access` namespace dictionaries. */

/** Dictionary namespace owned by the composer control. */
export const NS = 'web-access'

/** English dictionary. */
export const en = {
  'off.aria': 'Enable web access for this session',
  'off.title': 'Enable web access in this session for public searches and page reading.',
  'on.aria': 'Disable web access for this session',
  'on.title': 'Web access is active for this session. Select to revoke it immediately.',
  'pending': 'Updating web access…',
  'failure': 'Could not update web access',
}

/** Locale key union. */
export type WebAccessKey = keyof typeof en

/** Simplified Chinese dictionary. */
export const zh = {
  'off.aria': '为此会话启用 Web 访问',
  'off.title': '为此会话启用公开搜索和网页读取的 Web 访问。',
  'on.aria': '为此会话禁用 Web 访问',
  'on.title': '此会话的 Web 访问已启用。点击可立即撤销。',
  'pending': '正在更新 Web 访问…',
  'failure': '无法更新 Web 访问',
} satisfies Record<WebAccessKey, string>
