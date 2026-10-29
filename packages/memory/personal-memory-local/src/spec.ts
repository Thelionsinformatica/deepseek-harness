/** Durable schema for the local personal-memory adapter. */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import {
  localMemoryGraph,
  localMemoryRecord,
  type localMemoryDomainSpec,
  type LocalMemoryGraph,
  type LocalMemoryRecord,
} from '@deepseek-ai/dsh-memory-local'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Physically separate storage domain; workspace memory never opens this table. */
export const localPersonalMemoryDomainSpec: typeof localMemoryDomainSpec = defineDomain({
  name: 'personal_memory_local',
  version: 1,
  tables: {
    memories: domainTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>(localMemoryRecord),
    graph: domainTable<WorkspaceId, LocalMemoryGraph>(localMemoryGraph),
  },
})
