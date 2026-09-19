/**
 * Deterministic, explicitly permissioned loopback connector for the web-fetch
 * snapshot scenario. Production's anonymous public-web provider rejects
 * private destinations by design; this fixture keeps that policy intact while
 * exercising the real `dsh-tool-web` markdown rendering without external
 * network. The port is fixed because the URL is part of the transcript.
 */
import { createServer } from 'node:http'

/** Fixed loopback port the scenario prompt points `web_fetch` at. */
const PORT = 43117
const FIXTURE_URL = `http://127.0.0.1:${PORT}/menu.html`

const PAGE = `<!doctype html>
<html><head><title>Menu</title><style>.x{color:red}</style><script>ignored()</script></head>
<body>
<h1>Caf&eacute; menu</h1>
<p>Prices include <strong>service &amp; <em>tax</em></strong> &mdash; updated daily.</p>
<ul><li>Espresso</li><li>Flat white</li></ul>
<table><thead><tr><th>Drink</th><th>Price</th></tr></thead><tbody><tr><td>Espresso</td><td>&euro;2</td></tr><tr><td>Flat white</td><td>&euro;3</td></tr></tbody></table>
<p>See <a href="https://fixture.invalid/specials">today&rsquo;s specials</a>.</p>
</body></html>
`

/** Cordis plugin name. */
export const name = 'web-fetch-fixture-server'
export const inject = ['web']

/**
 * Start the fixture server on 127.0.0.1 and register its shutdown.
 * @param ctx - Cordis context; the effect disposes the server with the fiber.
 */
export async function apply(ctx) {
  const server = createServer((req, res) => {
    if (req.url === '/menu.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () => resolve(undefined))
  })
  // The fixture must never hold the process open past protocol shutdown.
  server.unref()
  ctx.web.registerFetchProvider({
    id: 'snapshot-fixture',
    available: () => true,
    async fetch(request, signal) {
      if (request.url !== FIXTURE_URL) {
        throw new Error(`snapshot fixture only permits ${FIXTURE_URL}`)
      }
      const response = await fetch(FIXTURE_URL, { signal })
      return {
        url: response.url,
        statusCode: response.status,
        body: { kind: 'html', content: await response.text() },
        truncated: false,
      }
    },
  })
  ctx.effect(() => async () => {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve(undefined))
      // Stop accepting first so a connection cannot arrive after the forced close.
      server.closeAllConnections()
    })
  }, 'web-fetch-fixture-server')
}
