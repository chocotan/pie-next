import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { HostPlugin } from '../plugin-runtime.ts'

const RuleSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  instruction: z.string().trim().min(1).max(2000),
}).strict()
const SettingsSchema = z.object({
  paused: z.boolean(),
  mode: z.enum(['off', 'observe', 'auto']),
  allowed: z.array(z.string().trim().min(1).max(80)).max(100),
  rules: z.array(RuleSchema).max(50),
}).strict()
type Settings = z.infer<typeof SettingsSchema>
type Stage = 'pending' | 'working' | 'attention' | 'ended'
interface Ticket {
  id: string
  title: string
  scope: string
  requester: string
  ruleIds: string[]
  policyVersion: string
  conversationId?: number
  stage: Stage
  report?: string
  createdAt: string
  endedAt?: string
}
interface State { settings: Settings; tickets: Ticket[] }

const defaults = (): Settings => ({
  paused: false,
  mode: 'observe',
  allowed: [],
  rules: [
    { id: 'copy', name: '文案修正', enabled: true, instruction: '明确要求修正错字、措辞、标点或既有翻译，不改变产品承诺。' },
    { id: 'visual', name: '局部视觉修正', enabled: true, instruction: '明确要求修正局部间距、对齐、溢出或样式，且目标已指定。不做重设计或新交互。' },
  ],
})

function policyVersion(settings: Settings): string {
  return createHash('sha256').update(JSON.stringify({ mode: settings.mode, allowed: settings.allowed, rules: settings.rules })).digest('hex').slice(0, 12)
}

export class SuperagentStore {
  private writeQueue: Promise<void> = Promise.resolve()
  private constructor(private readonly file: string, private state: State) {}

  static async open(dataDir: string): Promise<SuperagentStore> {
    const file = join(dataDir, 'superagent.json')
    try {
      const parsed = SettingsSchema.safeParse(JSON.parse(await readFile(file, 'utf8')).settings)
      const tickets = z.array(z.object({
        id: z.string(), title: z.string(), scope: z.string(), requester: z.string(), ruleIds: z.array(z.string()),
        policyVersion: z.string(), conversationId: z.number().int().positive().optional(), stage: z.enum(['pending', 'working', 'attention', 'ended']),
        report: z.string().optional(), createdAt: z.string(), endedAt: z.string().optional(),
      })).parse(JSON.parse(await readFile(file, 'utf8')).tickets)
      if (!parsed.success) throw new Error('Invalid Superagent settings')
      await chmod(file, 0o600)
      return new SuperagentStore(file, { settings: parsed.data, tickets })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      const store = new SuperagentStore(file, { settings: defaults(), tickets: [] })
      await store.persist(store.state)
      return store
    }
  }

  snapshot(): State & { policyVersion: string; sources: Array<{ id: 'github' | 'feishu'; enabled: false; reason: string }> } {
    return {
      ...structuredClone(this.state),
      policyVersion: policyVersion(this.state.settings),
      sources: [
        { id: 'github', enabled: false, reason: '未接入。pie-next 不监听仓库事件，也不自动创建 PR。' },
        { id: 'feishu', enabled: false, reason: '未接入。外部消息不会进入工单。' },
      ],
    }
  }

  saveSettings(input: unknown): Promise<State & { policyVersion: string }> {
    const settings = SettingsSchema.parse(input)
    if (new Set(settings.rules.map(rule => rule.id)).size !== settings.rules.length) throw new Error('规则 ID 不能重复')
    return this.update(state => ({ ...state, settings }))
  }

  accept(input: { title: string; scope: string; requester: string; ruleIds: string[] }): Promise<Ticket> {
    const settings = this.state.settings
    if (settings.paused) throw new Error('处理已暂停')
    if (settings.mode === 'off') throw new Error('评估已关闭，不能接单')
    const requester = input.requester.trim()
    if (settings.allowed.length > 0 && !settings.allowed.some(id => id.toLowerCase() === requester.toLowerCase())) throw new Error('请求人不在允许列表中')
    const enabled = new Set(settings.rules.filter(rule => rule.enabled).map(rule => rule.id))
    if (input.ruleIds.length === 0 || input.ruleIds.some(id => !enabled.has(id))) throw new Error('只能使用已启用的规则接单')
    const ticket: Ticket = {
      id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      title: input.title.trim(), scope: input.scope.trim(), requester, ruleIds: [...new Set(input.ruleIds)],
      policyVersion: policyVersion(settings), stage: 'pending', createdAt: new Date().toISOString(),
    }
    return this.update(state => ({ ...state, tickets: [ticket, ...state.tickets] })).then(() => ticket)
  }

  bind(id: string, conversationId: number): Promise<void> {
    return this.update(state => ({ ...state, tickets: state.tickets.map(ticket => ticket.id === id ? { ...ticket, conversationId, stage: ticket.stage === 'pending' ? 'working' : ticket.stage } : ticket) })).then(() => {})
  }

  report(id: string, report: string, attention: boolean): Promise<void> {
    return this.update(state => ({ ...state, tickets: state.tickets.map(ticket => {
      if (ticket.id !== id || ticket.stage === 'ended') return ticket
      return { ...ticket, report: report.trim(), stage: attention ? 'attention' : 'working' }
    }) })).then(() => {})
  }

  stop(id: string, reason: string): Promise<void> {
    return this.update(state => ({ ...state, tickets: state.tickets.map(ticket => ticket.id === id && ticket.stage !== 'ended'
      ? { ...ticket, stage: 'ended', report: reason.trim() || '由人工停止', endedAt: new Date().toISOString() } : ticket) })).then(() => {})
  }

  private update(change: (state: State) => State): Promise<State & { policyVersion: string }> {
    const operation = this.writeQueue.then(async () => {
      const next = change(structuredClone(this.state))
      await this.persist(next)
      this.state = next
      return { ...structuredClone(next), policyVersion: policyVersion(next.settings) }
    })
    this.writeQueue = operation.then(() => {}, () => {})
    return operation
  }

  private async persist(state: State): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${process.pid}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.file)
      await chmod(this.file, 0o600)
    } catch (cause) {
      await unlink(temporary).catch(() => {})
      throw cause
    }
  }
}

let store: SuperagentStore | undefined
export function superagentStore(value?: SuperagentStore): SuperagentStore {
  if (value) store = value
  if (!store) throw new Error('Superagent is not ready')
  return store
}

const ticketInput = z.object({ title: z.string().trim().min(1).max(200), scope: z.string().trim().min(1).max(4000), requester: z.string().trim().min(1).max(80), ruleIds: z.array(z.string()).min(1).max(20) })

export const SuperagentPlugin: HostPlugin = {
  id: 'superagent',
  register(ctx) {
    ctx.command('superagent.state', z.object({}), async () => superagentStore().snapshot())
    ctx.command('superagent.settings', SettingsSchema, async args => superagentStore().saveSettings(args))
    ctx.command('superagent.accept', ticketInput, async (args, context) => {
      const ticket = await superagentStore().accept(args as z.infer<typeof ticketInput>)
      const conversation = await ctx.getHarness().createConversation({ ownership: { kind: 'ownerless' }, agent: { model: ctx.providers.defaultSelection() } }, context)
      await superagentStore().bind(ticket.id, Number(conversation.id))
      const rules = superagentStore().snapshot().settings.rules.filter(rule => ticket.ruleIds.includes(rule.id))
      await conversation.submit({
        type: 'input', requestId: `superagent:${ticket.id}`, whenBusy: 'followUp',
        content: [`[Superagent 工单 ${ticket.id}]`, `标题：${ticket.title}`, `范围：${ticket.scope}`, `请求人：${ticket.requester}`, `策略版本：${ticket.policyVersion}`, '匹配规则：', ...rules.map(rule => `- ${rule.name}：${rule.instruction}`), '只完成授权范围。完成后用一句话报告结果；需要人工决定时明确说明问题，不要扩大范围。'].join('\n'),
      }, context)
      return superagentStore().snapshot().tickets.find(item => item.id === ticket.id)
    })
    ctx.command('superagent.report', z.object({ id: z.string(), report: z.string().trim().min(1).max(4000), attention: z.boolean().default(false) }), async args => {
      const input = args as { id: string; report: string; attention: boolean }
      await superagentStore().report(input.id, input.report, input.attention)
      return { accepted: true }
    })
    ctx.command('superagent.stop', z.object({ id: z.string(), reason: z.string().max(500).default('') }), async (args, context) => {
      const input = args as { id: string; reason: string }
      const ticket = superagentStore().snapshot().tickets.find(item => item.id === input.id)
      if (!ticket) throw new Error('工单不存在')
      if (ticket.conversationId) {
        const conversation = await ctx.conversation(ticket.conversationId, context)
        await conversation?.abort(context, { background: true })
      }
      await superagentStore().stop(input.id, input.reason)
      return { accepted: true }
    })
  },
}
