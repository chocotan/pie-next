import { contentText } from '@earendil-works/pi-ai'
import { CompactionTask, defineExtension, hook } from '@earendil-works/pi-durable'
import type { HostPlugin } from '../plugin-runtime.ts'

export const CompactionPlugin: HostPlugin = {
  id: 'compaction',
  register(ctx) {
    ctx.extension(defineExtension({
      name: 'app.compact-model',
      hooks: [hook(CompactionTask, {
        beforeCompact: async (compaction, api, context) => {
          const selected = ctx.runtime.state.compactModel
          if (!selected) return undefined
          try {
            const model = api.models.getModel(selected.provider, selected.modelId)
            if (!model) throw new Error(`Unknown compaction model: ${selected.provider}/${selected.modelId}`)
            const response = await api.models.completeSimple(model, {
              messages: [...compaction.messages, {
                role: 'user',
                content: 'Summarize the conversation so far for continuation. Preserve goals, decisions, constraints, file paths, commands, pending work, and verified facts. Return only the summary.',
                timestamp: Date.now(),
              }],
            }, { signal: context.abortSignal, cacheRetention: 'none' })
            const summary = contentText(response.content).trim()
            if (response.stopReason === 'error' || !summary) throw new Error(response.errorMessage ?? 'Compaction returned an empty summary')
            return { summary }
          } catch (cause) {
            if (context.abortSignal?.aborted) throw cause
            console.warn(`Compact model failed; using the conversation model: ${cause instanceof Error ? cause.message : String(cause)}`)
            return undefined
          }
        },
      })],
    }))
  },
}
