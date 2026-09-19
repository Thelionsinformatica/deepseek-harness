/** Host-owned auxiliary routes, separate from the interactive model default. */
import z from '@deepseek-ai/schemastery'
import type { AgentDefaultModelSettings } from './index.ts'

/** Independent consumers supported by the normal Leon composition. */
export type AuxiliaryModelRole = 'title' | 'compression' | 'vision' | 'worker' | 'review'

/** A complete route and explicit consent for automatic external calls. */
export interface AuxiliaryModelRoute extends AgentDefaultModelSettings {
  /** Allows this role to send its context to an external provider and incur charges. */
  allowExternal?: boolean
}

/** Missing entries preserve the consumer's existing inheritance behavior. */
export type AuxiliaryModelSettings = Partial<Record<AuxiliaryModelRole, AuxiliaryModelRoute>>

/** Deployment opt-in; an absent policy leaves experimental compositions untouched. */
export interface AuxiliaryModelPolicy {
  /** Trusted direct local adapters. A loopback gateway is not automatically local. */
  localProviders: string[]
  /** Initial routes, overridden by the settings provider when mounted. */
  roles?: AuxiliaryModelSettings
}

const route: z<AuxiliaryModelRoute> = z.object({
  provider: z.string().required(), model: z.string().required(),
  reasoningEffort: z.string(), allowExternal: z.boolean(),
}).default(undefined as unknown as Required<AuxiliaryModelRoute>)

/** Fixed role keys prevent a model from inventing a new dispatch function. */
export const auxiliarySettingsSchema: z<AuxiliaryModelSettings> = z.object({
  title: route, compression: route, vision: route, worker: route, review: route,
})

/** Composition policy, never inferred from provider names or endpoint addresses. */
export const auxiliaryPolicySchema: z<AuxiliaryModelPolicy> = z.object({
  localProviders: z.array(z.string()).required(), roles: auxiliarySettingsSchema,
}).default(undefined as unknown as Required<AuxiliaryModelPolicy>)
