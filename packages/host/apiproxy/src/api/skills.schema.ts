/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { SkillEntry, SkillInspectionEntry } from './skills.ts'

/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<SkillEntry>>

/** skill.list request payload. */
export const skillListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.list'>>>

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.list'>>>

/** Path-free skill.inspect catalog entry. */
export const skillInspectionEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  source: z.string(),
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<SkillInspectionEntry>>

/** skill.inspect request payload. */
export const skillInspectRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.inspect'>>>

/** skill.inspect response value. */
export const skillInspectValueSchema = z.object({
  agentPreset: z.string().nullable(),
  complete: z.boolean(),
  modelToolAvailable: z.boolean(),
  authorization: z.literal('not-evaluated'),
  skills: z.array(skillInspectionEntrySchema),
  observedAt: z.iso.datetime(),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.inspect'>>>
