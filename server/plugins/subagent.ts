import { Type, type AssistantMessage } from '@earendil-works/pi-ai'
import {
  AssistantEntry, configure, defineDoc, defineExtension, defineTask, defineTool,
  LiveDoc, type ConversationId, type EntryId, type TaskId,
} from '@earendil-works/pi-durable'
import { z } from 'zod'
import type { HostPlugin } from '../plugin-runtime.ts'

export type Subagent = { conversationId: ConversationId; reported: EntryId[]; turns?: number; lastAnswer?: string }
export type SubagentState = { agents: Record<string, Subagent>; reporters: Record<string, TaskId> }

export const SubagentsDoc = defineDoc<SubagentState>({
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31, kind: 'app.subagents', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ agents: {}, reporters: {} }),
})

const Anchor = defineTask<null, { phase: 'done' }, null>({
  name: 'app.subagent-anchor', version: 1,
  initial: () => ({ phase: 'done' }),
  phases: { done: (_task, runtime, context) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: null } }), context) },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context),
})

type ReporterInput = { name: string; conversationId: ConversationId; message: string; followUp: boolean }
type ReporterState = { phase: 'deliver' } | { phase: 'report'; report?: string }
const Reporter = defineTask<ReporterInput, ReporterState, null>({
  name: 'app.subagent-reporter', version: 1,
  initial: () => ({ phase: 'deliver' }),
  phases: {
    deliver: async (reporter, runtime, context) => {
      const { name, conversationId, message, followUp } = reporter.input
      const child = (await runtime.conversation(conversationId, context))!
      const request = { type: 'input', content: message, whenBusy: followUp ? 'followUp' : 'steer' } as const
      const settled = await (await child.submit({ ...request, requestId: `subagent:${reporter.id}` }, context)).wait(context)
      await runtime.commit(async tx => {
        const next = (report?: string) => ({ status: 'running', checkpoint: { phase: 'report', report } }) as const
        if (settled.status === 'unanswered') return next(settled.reason === 'aborted' ? undefined : `[subagent ${name} failed: ${settled.reason}]`)
        if (settled.type !== 'input') return next()
        const agent = (await tx.doc(SubagentsDoc, runtime.conversationId)).agents[name]!
        if (agent.reported.includes(settled.answer)) return next()
        agent.reported.push(settled.answer)
        const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0] as AssistantMessage
        const text = answer.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')
        agent.turns = (agent.turns ?? 0) + 1
        agent.lastAnswer = text.slice(0, 32_000)
        return next(`[subagent ${name} answered, no reply needed] ${text}`)
      }, context)
    },
    report: async (reporter, runtime, context) => {
      const report = reporter.state.checkpoint.report
      if (report !== undefined) {
        const parent = (await runtime.conversation(runtime.conversationId, context))!
        await parent.submit({ type: 'input', content: report, whenBusy: 'followUp', requestId: `subagent-report:${reporter.id}` }, context)
      }
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: null } }), context)
    },
  },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context),
})

const subagentTool = defineTool({
  name: 'subagent',
  description: 'Manage persistent, multi-turn background subagents. The child keeps its conversation, so later sends continue the same thread. Actions: spawn(name,message), send(name,message; followUp optional), result(name), list, stop(name), status(name optional). Answers are reported back to you when they arrive.',
  parameters: Type.Object({
    action: Type.Union([Type.Literal('spawn'), Type.Literal('send'), Type.Literal('stop'), Type.Literal('status'), Type.Literal('result'), Type.Literal('list')]),
    name: Type.Optional(Type.String()), message: Type.Optional(Type.String()), followUp: Type.Optional(Type.Boolean()),
  }),
  replay: 'unsafe',
  execute: async (args, api, context) => {
    const { action, name, message, followUp } = args
    const reply = (text: string, conversationId?: ConversationId) => ({
      output: [{ type: 'text' as const, text }],
      ...(conversationId === undefined || name === undefined ? {} : { details: { name, conversationId } }),
    })
    const registry = (await api.snapshot(SubagentsDoc, api.conversationId, context)) ?? { agents: {}, reporters: {} }
    const busyOf = async (conversationId: ConversationId): Promise<boolean> => (await api.snapshot(LiveDoc, conversationId, context))?.run !== undefined
    if (action === 'list') {
      const rows = await Promise.all(Object.entries(registry.agents).map(async ([each, agent]) => ({ name: each, turns: agent.turns ?? 0, busy: await busyOf(agent.conversationId), answer: agent.lastAnswer })))
      return reply(rows.length === 0 ? 'No subagents.' : JSON.stringify(rows, null, 2))
    }
    if (action === 'result') {
      if (!name) return reply('result needs a name.')
      const found = Object.hasOwn(registry.agents, name) ? registry.agents[name] : undefined
      if (!found) return reply(`No subagent named ${name}.`)
      return reply(JSON.stringify({ name, turns: found.turns ?? 0, busy: await busyOf(found.conversationId), lastAnswer: found.lastAnswer ?? null }, null, 2), found.conversationId)
    }
    if (action === 'status') {
      const names = name === undefined ? Object.keys(registry.agents) : [name]
      const lines: string[] = []
      for (const each of names) {
        const found = Object.hasOwn(registry.agents, each) ? registry.agents[each] : undefined
        if (!found) continue
        lines.push(`${each}: ${await busyOf(found.conversationId) ? 'working' : 'idle'} · ${found.turns ?? 0} turns`)
      }
      return reply(lines.length === 0 ? 'No subagents.' : lines.join('\n'))
    }
    if (!name) return reply(`${action} needs a name.`)
    const agent = Object.hasOwn(registry.agents, name) ? registry.agents[name] : undefined
    if (action !== 'spawn' && !agent) return reply(`No subagent named ${name}.`)
    if (action === 'stop') {
      await (await api.conversation(agent!.conversationId, context))!.abort(context)
      return reply(`Stopped ${name}.`, agent!.conversationId)
    }
    if (!message) return reply(`${action} needs a message.`)
    const result = await api.commit(async tx => {
      const state = await tx.doc(SubagentsDoc, api.conversationId)
      const background = { ownership: { kind: 'conversation' }, background: true } as const
      if (action === 'spawn') {
        if (Object.hasOwn(state.agents, name)) return `${name} already exists; use send.`
        const anchor = await tx.createTask(Anchor, null, background)
        const child = await tx.createConversation({ ownership: { kind: 'task', taskId: anchor } })
        await configure(tx, child.id, {
          extensions: { remove: [SubagentExtension] },
          instructions: `You are the subagent "${name}". Answer the main agent's requests.` })
        state.agents[name] = { conversationId: child.id, reported: [] }
      }
      const conversationId = state.agents[name]!.conversationId
      state.reporters[api.taskId] = await tx.createTask(Reporter, { name, conversationId, message, followUp: action === 'send' && followUp === true }, background)
      return action === 'send' ? `Sent to ${name}.` : `Started ${name}.`
    }, context)
    const current = (await api.snapshot(SubagentsDoc, api.conversationId, context))?.agents[name]
    return reply(result, current?.conversationId)
  },
})

export const SubagentExtension = defineExtension({ name: 'subagent', tasks: [Anchor, Reporter], tools: [subagentTool] })

export const SubagentPlugin: HostPlugin = {
  id: 'subagent',
  register(ctx) {
    ctx.extension(SubagentExtension)
    ctx.document('subagents', SubagentsDoc, 'subagent')
    ctx.command('subagent.list', z.object({ conversationId: z.number().int().positive() }), async (args, context) => {
      const state = await ctx.getHarness().snapshot(SubagentsDoc, (args as { conversationId: number }).conversationId as ConversationId, context)
      return state ?? { agents: {}, reporters: {} }
    })
  },
}
