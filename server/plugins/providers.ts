import { z } from 'zod'
import type { HostPlugin } from '../plugin-runtime.ts'

const profile = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(100),
  protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']),
  baseUrl: z.string().url(),
  models: z.string().trim().min(1),
  enabled: z.boolean(),
  hasKey: z.boolean(),
})

export const ProviderPlugin: HostPlugin = {
  id: 'providers',
  register(ctx) {
    ctx.command('provider.list', z.object({}), async () => ({
      items: ctx.providers.list(),
      models: ctx.providers.models(),
      default: ctx.providers.defaultSelection(),
    }))
    ctx.command('provider.save', z.object({ profile, apiKey: z.string().max(10_000).optional() }), async (args) => {
      const input = args as { profile: Parameters<typeof ctx.providers.save>[0]; apiKey?: string }
      const saved = await ctx.providers.save(input.profile, input.apiKey)
      ctx.providers.syncModels(ctx.models)
      return saved
    })
    ctx.command('provider.sync-models', z.object({
      profile: profile.extend({ models: z.string() }),
      apiKey: z.string().max(10_000).optional(),
    }), async (args) => {
      const input = args as { profile: Parameters<typeof ctx.providers.discoverModels>[0]; apiKey?: string }
      return { models: await ctx.providers.discoverModels(input.profile, input.apiKey) }
    })
    ctx.command('provider.enabled', z.object({ id: z.string().min(1), enabled: z.boolean() }), async (args) => {
      const input = args as { id: string; enabled: boolean }
      const saved = await ctx.providers.setEnabled(input.id, input.enabled)
      ctx.providers.syncModels(ctx.models)
      return saved
    })
  },
}
