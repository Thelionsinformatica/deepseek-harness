/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { SkillCatalogEntry, SkillEntry, SkillInspectionEntry } from './skills.ts'

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

/** skill.catalog request accepts registered identifiers, never filesystem paths. */
export const skillCatalogRequestSchema = z.object({
  agentPreset: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.catalog'>>>

/** Administrative metadata row, including the preset restriction decision. */
export const skillCatalogEntrySchema = skillInspectionEntrySchema.extend({
  enabled: z.boolean(),
}) satisfies z.ZodType<Wire<SkillCatalogEntry>>

/** skill.catalog response with the settings revision needed for a later edit. */
export const skillCatalogValueSchema = z.object({
  agentPreset: z.string().min(1),
  complete: z.boolean(),
  skills: z.array(skillCatalogEntrySchema),
  revision: z.number().int().nonnegative(),
  writable: z.boolean(),
  disabledNames: z.array(z.string().min(1)),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.catalog'>>>

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
