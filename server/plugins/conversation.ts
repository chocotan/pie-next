import { z } from 'zod'
import { AgentDoc, defineDoc } from '@earendil-works/pi-durable'
import type { ConversationId, Cursor } from '@earendil-works/pi-durable'
import { interruptPendingApprovals } from './approval.ts'
import type { HostPlugin } from '../plugin-runtime.ts'

const id = z.number().int().positive()

// Durable has no conversation-delete API; removing a session from the list is recorded as a session tombstone so the
// history stays recoverable and no storage invariant is bypassed.
const ArchivedDoc = defineDoc<{ ids: number[] }>({
  kind: 'app.archived-sessions', version: 1, scope: 'session',
  initial: () => ({ ids: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
})

export const ConversationPlugin: HostPlugin = {
  id: 'conversation',
  register(ctx) {
    ctx.command('session.list', z.object({}), async (_args, context) => {
      const records = await ctx.getHarness().commit(async tx => {
        const [page, archived] = await Promise.all([tx.scanConversations({}, 100), tx.doc(ArchivedDoc)])
        return page.items.filter(record => Number(record.id) !== 1 && !archived.ids.includes(Number(record.id)))
      }, context)
      return { items: records }
    })
    ctx.command('session.delete', z.object({ conversationId: id }), async (args, context) => {
      const conversationId = (args as { conversationId: number }).conversationId
      if (conversationId === 1) throw new Error('Cannot delete the internal root conversation')
      const conversation = await ctx.conversation(conversationId, context)
      if (!conversation) throw new Error('Conversation not found')
      await conversation.abort(context, { background: true })
      await ctx.getHarness().commit(async tx => {
        const archived = await tx.doc(ArchivedDoc)
        if (!archived.ids.includes(conversationId)) archived.ids.push(conversationId)
      }, context)
      return { archived: true as const }
    })
    ctx.command('session.create', z.object({}), async (_args, context) => {
      const conversation = await ctx.getHarness().createConversation({
        ownership: { kind: 'ownerless' },
        agent: { model: ctx.providers.defaultSelection() },
      }, context)
      return { conversationId: Number(conversation.id) }
    })
    ctx.command('session.input', z.object({ conversationId: id, requestId: z.string().min(1).max(100), content: z.string().trim().min(1).max(100_000), whenBusy: z.enum(['steer', 'followUp']).default('followUp') }), async (args, context) => {
      const input = args as { conversationId: number; requestId: string; content: string; whenBusy: 'steer' | 'followUp' }
      const conversation = await ctx.conversation(input.conversationId, context)
      if (!conversation) throw new Error('Conversation not found')
      const agent = await ctx.getHarness().snapshot(AgentDoc, conversation.id, context)
      if (!agent?.model) {
        const model = ctx.providers.defaultSelection()
        if (!model) throw new Error('请先在设置中添加并启用 Provider 和模型。')
        await conversation.configure({ model }, context)
      } else if (!ctx.models.getModel(agent.model.provider, agent.model.modelId)) {
        throw new Error(`模型 ${agent.model.provider}/${agent.model.modelId} 不可用，请检查 Provider 配置。`)
      }
      const submission = await conversation.submit({ type: 'input', content: input.content, requestId: input.requestId, whenBusy: input.whenBusy }, context)
      return { submissionId: submission.id }
    })
    ctx.command('session.compact', z.object({ conversationId: id }), async (args, context) => {
      const conversation = await ctx.conversation((args as { conversationId: number }).conversationId, context)
      if (!conversation) throw new Error('Conversation not found')
      const taskId = await conversation.compact(undefined, context)
      return { taskId: Number(taskId) }
    })
    ctx.command('session.abort', z.object({ conversationId: id, background: z.boolean().default(false) }), async (args, context) => {
      const input = args as { conversationId: number; background: boolean }
      const conversation = await ctx.conversation(input.conversationId, context)
      if (!conversation) throw new Error('Conversation not found')
      await conversation.abort(context, { background: input.background })
      await interruptPendingApprovals(ctx.getHarness(), input.conversationId as ConversationId)
      return { accepted: true }
    })
    ctx.command('session.configure', z.object({
      conversationId: id,
      model: z.object({ provider: z.string().min(1), modelId: z.string().min(1) }).optional(),
      thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).nullish(),
    }).refine(value => value.model !== undefined || value.thinkingLevel !== undefined, { message: 'No configuration change' }), async (args, context) => {
      const input = args as { conversationId: number; model?: { provider: string; modelId: string }; thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null }
      const conversation = await ctx.conversation(input.conversationId, context)
      if (!conversation) throw new Error('Conversation not found')
      await conversation.configure({
        ...(input.model ? { model: input.model } : {}),
        ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
      }, context)
      return { accepted: true }
    })
    ctx.command('session.entries', z.object({ conversationId: id, limit: z.number().int().min(1).max(100).default(50), cursor: z.record(z.string(), z.unknown()).optional() }), async (args, context) => {
      const input = args as { conversationId: number; limit: number; cursor?: Record<string, unknown> }
      const conversation = await ctx.conversation(input.conversationId, context)
      if (!conversation) throw new Error('Conversation not found')
      return conversation.entries({ order: 'descending' }, input.limit, input.cursor as Cursor | undefined, context)
    })
  },
}
