/** In-memory Session persistence for tool-memory tests that mount the real agent loop. */
import { SessionLogOffset, type SessionEvent, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceRevision,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'

interface StoredSession {
  readonly header: SessionHeader
  events: SessionEvent[]
}

/**
 * Build a persistence service whose sessions live only in this process. It
 * covers create, open, read, append, stat, and list, which is what the loop
 * and the memory review service use.
 * @returns an object provided as `sessionPersistence`.
 */
export function memorySessionPersistence() {
  const stored = new Map<SessionId, StoredSession>()
  const handle = (session: StoredSession, access: SessionAccess): SessionHandle => ({
    id: session.header.id,
    header: session.header,
    inheritedEventCount: SessionLogOffset(0),
    access,
    read: async (offset = 0, length?: number) => {
      const events = session.events.filter(event => event.seq >= offset)
      return { eventState: 'detached', events: structuredClone(length === undefined ? events : events.slice(0, length)) }
    },
    append: async (events) => { session.events = [...session.events, ...events] },
    flush: async () => {},
    close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  })
  const snapshot = (session: StoredSession): SessionPersistenceSnapshot => ({
    header: session.header,
    revision: SessionPersistenceRevision(`memory:${session.header.id}:${session.events.length}`),
  })
  return {
    create: async (header: SessionHeader) => {
      const session: StoredSession = { header, events: [] }
      stored.set(header.id, session)
      return handle(session, 'write')
    },
    open: async (id: SessionId, access: SessionAccess) => {
      const session = stored.get(id)
      if (session === undefined) throw new Error(`session ${id} is not stored`)
      return handle(session, access)
    },
    flush: async () => {},
    stat: async (id: SessionId) => {
      const session = stored.get(id)
      return session === undefined ? undefined : snapshot(session)
    },
    list: async () => [...stored.values()].map(snapshot),
  }
}
