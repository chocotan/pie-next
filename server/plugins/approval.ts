import { z } from 'zod'
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context'
import {
  createBashTool, createEditTool, createWriteTool,
} from '@earendil-works/pi-durable/tools'
import {
  defineDoc, defineExtension, hook, ToolTask, wrapTool,
  type ConversationId, type JsonObject, type ToolExecutionApi, type ToolRegistration,
} from '@earendil-works/pi-durable'
import type { HostPlugin } from '../plugin-runtime.ts'

export type ApprovalRequest = {
  taskId: number
  callId: string
  toolName: string
  arguments: JsonObject
  status: 'pending' | 'approved' | 'denied' | 'completed' | 'interrupted'
  createdAt: number
  decidedAt?: number
}

export type ApprovalState = { requests: Record<string, ApprovalRequest>; mode?: 'allow-all' | 'approve' }

export const ApprovalDoc = defineDoc<ApprovalState>({
  kind: 'app.approvals', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ requests: {} }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
})

type Decision = 'approved' | 'denied'

export function requiresApproval(state: ApprovalState | undefined): boolean {
  return state?.mode === 'approve'
}

async function decisionOf(api: ToolExecutionApi, context: Context): Promise<Decision> {
  const key = String(api.taskId)
  const watch = await api.watchDoc(ApprovalDoc, api.conversationId, context)
  if (!watch) throw new Error('Approval document is unavailable')
  const current = watch.value?.requests[key]
  if (current?.status === 'approved' || current?.status === 'denied') return current.status
  return new Promise<Decision>((resolve, reject) => {
    context.abortSignal?.addEventListener('abort', () => { void watch.stop(); reject(new Error('Approval wait was cancelled')) }, { once: true })
    watch.start(async value => {
      const request = value?.requests[key]
      if (request?.status !== 'approved' && request?.status !== 'denied') return
      await watch.stop()
      resolve(request.status)
    })
  })
}

export function guard(tool: ToolRegistration) {
  return wrapTool(tool, wrapped => ({
    ...wrapped,
    execute: async (args, api, context) => {
      const state = await api.snapshot(ApprovalDoc, api.conversationId, context)
      if (!requiresApproval(state)) return wrapped.execute(args, api, context)
      const memoKey = 'approval:decision'
      let decision = await api.memo<Decision>(memoKey, context)
      if (decision === undefined) {
        await api.commit(async tx => {
          const doc = await tx.doc(ApprovalDoc, api.conversationId)
          doc.requests[String(api.taskId)] = {
            taskId: api.taskId, callId: api.callId, toolName: api.registry.tools().find(item => item.tool.name === wrapped.name)?.tool.name ?? wrapped.name,
            arguments: args as JsonObject, status: 'pending', createdAt: api.now(),
          }
        }, context)
        decision = await decisionOf(api, context)
        decision = await api.memo(memoKey, decision, context)
      }
      if (decision === 'denied') {
        return { output: [{ type: 'text' as const, text: 'Tool call denied by user. No execution was started.' }], isError: true }
      }
      return wrapped.execute(args, api, context)
    },
  }))
}

const GuardedBash = createBashTool()
const GuardedWrite = createWriteTool()
const GuardedEdit = createEditTool()

export const ApprovalExtension = defineExtension({
  name: 'approval',
  wraps: [guard(GuardedBash), guard(GuardedWrite), guard(GuardedEdit)],
  hooks: [hook(ToolTask, {
    afterTool: async (_call, result, api, context) => {
      const request = await api.snapshot(ApprovalDoc, api.conversationId, context)
      const current = request?.requests[String(api.taskId)]
      if (!current || current.status !== 'pending') return undefined
      const decision = await api.memo<Decision>('approval:decision', context)
      const status = decision === 'denied' ? 'denied' : result.isError ? 'interrupted' : 'completed'
      await persist(api.conversationId, api.taskId, status)
      return undefined
    },
  })],
})

let persist: (conversationId: ConversationId, taskId: number, status: ApprovalRequest['status']) => Promise<void>

export async function interruptPendingApprovals(harness: import('@earendil-works/pi-durable').Harness, conversationId: ConversationId): Promise<void> {
  await harness.commit(async tx => {
    const doc = await tx.doc(ApprovalDoc, conversationId)
    for (const request of Object.values(doc.requests)) {
      if (request.status === 'pending') { request.status = 'interrupted'; request.decidedAt = Date.now() }
    }
  }, BACKGROUND_CONTEXT)
}

export async function reconcileApprovals(harness: import('@earendil-works/pi-durable').Harness): Promise<void> {
  const conversations = await harness.commit(async tx => (await tx.scanConversations({}, 100)).items, BACKGROUND_CONTEXT)
  for (const conversation of conversations) await interruptPendingApprovals(harness, conversation.id)
}

export const ApprovalPlugin: HostPlugin = {
  id: 'approval',
  register(ctx) {
    persist = async (conversationId, taskId, status) => {
      await ctx.getHarness().commit(async tx => {
        const doc = await tx.doc(ApprovalDoc, conversationId)
        const pending = doc.requests[String(taskId)]
        if (pending) { pending.status = status; pending.decidedAt = Date.now() }
      }, BACKGROUND_CONTEXT)
    }
    ctx.extension(ApprovalExtension)
    ctx.document('approvals', ApprovalDoc, 'approval')
    ctx.command('approval.mode', z.object({ conversationId: z.number().int().positive(), mode: z.enum(['allow-all', 'approve']) }), async (args, context) => {
      const input = args as { conversationId: number; mode: 'allow-all' | 'approve' }
      await ctx.getHarness().commit(async tx => {
        const doc = await tx.doc(ApprovalDoc, input.conversationId as ConversationId)
        doc.mode = input.mode
      }, context)
      return { accepted: true }
    })
    ctx.command('approval.decide', z.object({ conversationId: z.number().int().positive(), taskId: z.number().int().positive(), decision: z.enum(['approved', 'denied']) }), async (args, context) => {
      const input = args as { conversationId: number; taskId: number; decision: Decision }
      await ctx.getHarness().commit(async tx => {
        const doc = await tx.doc(ApprovalDoc, input.conversationId as ConversationId)
        const request = doc.requests[String(input.taskId)]
        if (!request) throw new Error('Approval request not found')
        if (request.status !== 'pending') throw new Error('Approval request was already decided')
        request.status = input.decision
        request.decidedAt = Date.now()
      }, context)
      return { accepted: true }
    })
  },
}
