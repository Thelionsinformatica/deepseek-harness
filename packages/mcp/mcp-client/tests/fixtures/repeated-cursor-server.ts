/** Local MCP fixture: an empty-page cycle must terminate before a third request. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new McpServer(
  { name: 'repeated-cursor', version: '1.0.0' },
  { capabilities: { tools: {} } },
)
let requests = 0
server.server.setRequestHandler(ListToolsRequestSchema, () => {
  if (++requests > 2) throw new Error('pagination continued after the repeated cursor')
  return { tools: [], nextCursor: 'same-cursor' }
})
await server.connect(new StdioServerTransport())
