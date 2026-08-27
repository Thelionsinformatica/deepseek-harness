/** Durable schema for the local personal-memory adapter. */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { MemoryId } from '@deepseek-ai/dsh-memory'
import { localMemoryRecord, type LocalMemoryRecord } from '@deepseek-ai/dsh-memory-local'

/** Physically separate storage domain; workspace memory never opens this table. */
export const localPersonalMemoryDomainSpec = defineDomain({
  name: 'personal_memory_local',
  version: 1,
  tables: {
    memories: domainTable<ReturnType<typeof MemoryId>, LocalMemoryRecord>(localMemoryRecord),
  },
})
