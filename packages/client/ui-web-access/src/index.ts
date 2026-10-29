/**
 * Web-access control plugin, node half. Pure UI plugin: the empty apply exists
 * so the plugin appears in the host roster; the browser half ships via
 * exports["./client"]. The grant itself (the /web command, the `webAccess`
 * projection) is owned by `@deepseek-ai/dsh-web-access` on the host.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
