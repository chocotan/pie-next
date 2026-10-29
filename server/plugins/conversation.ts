import { z } from 'zod'
import { updateTodos } from './todo.ts'
import type { ConversationId, Cursor } from '@earendil-works/pi-durable'
import { interruptPendingApprovals } from './approval.ts'
import type { HostPlugin } from '../plugin-runtime.ts'

const id = z.number().int().positive()
const todoStatus = z.enum(['pending', 'in_progress', 'completed', 'cancelled'])
const todoItems = z.array(z.object({ id: z.string().min(1), content: z.string().trim().min(1).max(500), status: todoStatus, assignedConversationId: z.number().int().positive().optional() })).max(100)

export const ConversationPlugin: HostPlugin = {
  id: 'conversation',
  register(ctx) {
    ctx.command('session.list', z.object({}), async (_args, context) => {
      const records = await ctx.getHarness().commit(async tx => (await tx.scanConversations({}, 100)).items, context)
      return { items: records }
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
      const submission = await conversation.submit({ type: 'input', content: input.content, requestId: input.requestId, whenBusy: input.whenBusy }, context)
      return { submissionId: submission.id }
    })
    ctx.command('session.abort', z.object({ conversationId: id, background: z.boolean().default(false) }), async (args, context) => {
      const input = args as { conversationId: number; background: boolean }
      const conversation = await ctx.conversation(input.conversationId, context)
      if (!conversation) throw new Error('Conversation not found')
      await conversation.abort(context, { background: input.background })
      await interruptPendingApprovals(ctx.getHarness(), input.conversationId as ConversationId)
      return { accepted: true }
    })
    ctx.command('session.configure', z.object({ conversationId: id, model: z.object({ provider: z.string().min(1), modelId: z.string().min(1) }) }), async (args, context) => {
      const input = args as { conversationId: number; model: { provider: string; modelId: string } }
      const conversation = await ctx.conversation(input.conversationId, context)
      if (!conversation) throw new Error('Conversation not found')
      await conversation.configure({ model: input.model }, context)
      return { accepted: true }
    })
    ctx.command('session.entries', z.object({ conversationId: id, limit: z.number().int().min(1).max(100).default(50), cursor: z.record(z.string(), z.unknown()).optional() }), async (args, context) => {
      const input = args as { conversationId: number; limit: number; cursor?: Record<string, unknown> }
      const conversation = await ctx.conversation(input.conversationId, context)
      if (!conversation) throw new Error('Conversation not found')
      return conversation.entries({ order: 'descending' }, input.limit, input.cursor as Cursor | undefined, context)
    })
    ctx.command('todo.update', z.object({ conversationId: id, items: todoItems }), async (args, context) => {
      const input = args as { conversationId: number; items: Parameters<typeof updateTodos>[2] }
      await updateTodos(ctx.getHarness(), input.conversationId as ConversationId, input.items, context)
      return { accepted: true }
    })
  },
}
