import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Type } from '@earendil-works/pi-ai'
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context'
import {
  AgentDoc, defineDoc, defineExtension, defineTool,
  type ConversationId, type Cursor, type Harness,
} from '@earendil-works/pi-durable'
import { z } from 'zod'
import type { HostPlugin, PluginContext } from '../plugin-runtime.ts'
import { guard } from './approval.ts'

export type BackgroundTask = {
  id: string
  command: string
  title?: string
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted'
  pid?: number
  output: string
  createdAt: number
  endedAt?: number
  exitCode?: number
}

export type BackgroundState = { tasks: Record<string, BackgroundTask> }

export const BackgroundDoc = defineDoc<BackgroundState>({
  kind: 'app.background', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ tasks: {} }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
})

const OUTPUT_LIMIT = 50 * 1024
const PERSIST_INTERVAL = 250

type ActiveTask = {
  conversationId: ConversationId
  taskId: string
  child: ChildProcess
  output: string
  stopping: boolean
  spawnFailed: boolean
  writes: Promise<void>
  timer?: NodeJS.Timeout
  done: Promise<void>
  resolveDone: () => void
}

function killProcessGroup(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) { child.kill('SIGKILL'); return }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
    killer.once('error', () => { child.kill('SIGKILL') })
    killer.unref()
    return
  }
  try { process.kill(-pid, 'SIGKILL') } catch {
    try { child.kill('SIGKILL') } catch { /* Already exited. */ }
  }
}

function textResult(text: string, isError = false) {
  return { output: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) }
}

function resolveTask(state: BackgroundState | undefined, taskId: string): BackgroundTask {
  const matches = Object.values(state?.tasks ?? {}).filter(task => task.id === taskId || task.id.startsWith(taskId))
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous background task ID: ${taskId}` : `Unknown background task: ${taskId}`)
  return matches[0]!
}

export class BackgroundService {
  private harness?: Harness
  private readonly active = new Map<string, ActiveTask>()
  private closing = false

  constructor(ctx: PluginContext) {
    const start = defineTool({
      name: 'bg_run',
      description: 'Start a background shell command and return its ID immediately. Use bg_status or bg_logs for deliberate inspection; tasks stop when the host reloads.',
      parameters: Type.Object({ command: Type.String(), description: Type.Optional(Type.String()) }),
      replay: 'unsafe',
      execute: async (args, api, context) => {
        const task = await this.start(api.conversationId, { command: args.command, ...(args.description === undefined ? {} : { title: args.description }) }, context)
        return textResult(JSON.stringify(task))
      },
    })
    const status = defineTool({
      name: 'bg_status',
      description: 'Inspect one background shell task by ID/prefix, or list active and recent tasks. This is not a waiting primitive.',
      parameters: Type.Object({ taskId: Type.Optional(Type.String()) }),
      replay: 'safe',
      execute: async (args, api, context) => {
        const state = await this.store().snapshot(BackgroundDoc, api.conversationId, context)
        const result = args.taskId ? resolveTask(state, args.taskId) : Object.values(state?.tasks ?? {}).sort((a, b) => b.createdAt - a.createdAt)
        return textResult(JSON.stringify(result, null, 2))
      },
    })
    const logs = defineTool({
      name: 'bg_logs',
      description: 'Read a background task output from the head or tail, capped at 50KiB.',
      parameters: Type.Object({ taskId: Type.String(), maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 * 1024 })), tail: Type.Optional(Type.Boolean()) }),
      replay: 'safe',
      execute: async (args, api, context) => {
        const state = await this.store().snapshot(BackgroundDoc, api.conversationId, context)
        const task = resolveTask(state, args.taskId)
        const limit = args.maxBytes ?? 50 * 1024
        const output = (args.tail ?? true) ? task.output.slice(-limit) : task.output.slice(0, limit)
        return textResult(`${output || '(no output yet)'}\n\n[Task ${task.id}; ${task.status}; retained output is capped at 50KiB]`)
      },
    })
    const kill = defineTool({
      name: 'bg_kill',
      description: 'Stop a running background shell process group by task ID or unique prefix.',
      parameters: Type.Object({ taskId: Type.String() }),
      replay: 'unsafe',
      execute: async (args, api, context) => {
        const state = await this.store().snapshot(BackgroundDoc, api.conversationId, context)
        const task = resolveTask(state, args.taskId)
        await this.stop(api.conversationId, task.id, context)
        return textResult(`Background task ${task.id}: ${task.status === 'running' ? 'stopped' : task.status}.`)
      },
    })
    ctx.extension(defineExtension({ name: 'background', tools: [start, status, logs, kill], wraps: [guard(start)] }))
    ctx.document('background', BackgroundDoc, 'background')
    ctx.command('background.start', z.object({
      conversationId: z.number().int().positive(),
      command: z.string().min(1).max(100_000).refine(value => value.trim().length > 0),
      title: z.string().max(200).optional(),
    }), async (args, context) => {
      const input = args as { conversationId: number; command: string; title?: string }
      return { task: await this.start(input.conversationId as ConversationId, input, context) }
    })
    ctx.command('background.stop', z.object({
      conversationId: z.number().int().positive(), taskId: z.string().min(1).max(100),
    }), async (args, context) => {
      const input = args as { conversationId: number; taskId: string }
      await this.stop(input.conversationId as ConversationId, input.taskId, context)
      return { accepted: true as const }
    })
  }

  bind(harness: Harness): void { this.harness = harness }

  private store(): Harness {
    if (!this.harness) throw new Error('Background tasks are not ready')
    return this.harness
  }

  async start(conversationId: ConversationId, input: { command: string; title?: string }, context: Context): Promise<BackgroundTask> {
    if (this.closing) throw new Error('Background tasks are shutting down')
    const harness = this.store()
    if (!await harness.conversation(conversationId, context)) throw new Error('Conversation not found')
    const agent = await harness.snapshot(AgentDoc, conversationId, context)
    const task: BackgroundTask = {
      id: randomUUID(), command: input.command, status: 'running', output: '', createdAt: Date.now(),
      ...(input.title === undefined ? {} : { title: input.title }),
    }
    await harness.commit(async tx => {
      const doc = await tx.doc(BackgroundDoc, conversationId)
      doc.tasks[task.id] = task
    }, context)
    if (this.closing) {
      task.status = 'stopped'
      task.endedAt = Date.now()
      await harness.commit(async tx => { Object.assign((await tx.doc(BackgroundDoc, conversationId)).tasks[task.id]!, task) }, BACKGROUND_CONTEXT)
      return { ...task }
    }

    let child: ChildProcess
    try {
      child = spawn(input.command, {
        cwd: agent?.cwd ?? process.cwd(), shell: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      })
    } catch (error) {
      task.status = 'failed'
      task.output = `Spawn failed: ${error instanceof Error ? error.message : String(error)}`
      task.endedAt = Date.now()
      await harness.commit(async tx => { Object.assign((await tx.doc(BackgroundDoc, conversationId)).tasks[task.id]!, task) }, BACKGROUND_CONTEXT)
      return { ...task }
    }

    let resolveDone!: () => void
    const active: ActiveTask = {
      conversationId, taskId: task.id, child, output: '', stopping: false, spawnFailed: false,
      writes: Promise.resolve(), done: new Promise<void>(resolve => { resolveDone = resolve }), resolveDone,
    }
    this.active.set(task.id, active)
    if (child.pid !== undefined) task.pid = child.pid
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    const append = (chunk: string | Buffer) => this.append(active, chunk.toString())
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', error => {
      active.spawnFailed = true
      this.append(active, `Process error: ${error.message}\n`)
    })
    child.once('close', code => {
      const status = active.stopping ? 'stopped' : active.spawnFailed || code !== 0 ? 'failed' : 'completed'
      void this.finish(active, status, code ?? undefined)
    })
    void this.persist(active)
    return { ...task }
  }

  async stop(conversationId: ConversationId, taskId: string, context: Context): Promise<void> {
    const harness = this.store()
    const state = await harness.snapshot(BackgroundDoc, conversationId, context)
    const task = state?.tasks[taskId]
    if (!task) throw new Error('Background task not found')
    if (task.status !== 'running') return
    const active = this.active.get(taskId)
    if (active && active.conversationId === conversationId) {
      active.stopping = true
      killProcessGroup(active.child)
      await active.done
      return
    }
    await harness.commit(async tx => {
      const current = (await tx.doc(BackgroundDoc, conversationId)).tasks[taskId]
      if (current?.status === 'running') { current.status = 'stopped'; current.endedAt = Date.now() }
    }, context)
  }

  async reconcile(): Promise<void> {
    await this.store().commit(async tx => {
      let cursor: Cursor | undefined
      do {
        const page = await tx.scanConversations({}, 100, cursor)
        for (const conversation of page.items) {
          const doc = await tx.doc(BackgroundDoc, conversation.id)
          for (const task of Object.values(doc.tasks)) {
            if (task.status === 'running') { task.status = 'interrupted'; task.endedAt = Date.now() }
          }
        }
        cursor = page.next
      } while (cursor !== undefined)
    }, BACKGROUND_CONTEXT)
  }

  async close(): Promise<void> {
    this.closing = true
    await Promise.all([...this.active.values()].map(active => {
      active.stopping = true
      killProcessGroup(active.child)
      return active.done
    }))
  }

  private append(active: ActiveTask, text: string): void {
    active.output = (active.output + text).slice(-OUTPUT_LIMIT)
    if (active.timer) return
    active.timer = setTimeout(() => {
      active.timer = undefined
      void this.persist(active)
    }, PERSIST_INTERVAL)
    active.timer.unref()
  }

  private persist(active: ActiveTask, final?: { status: BackgroundTask['status']; exitCode?: number }): Promise<void> {
    active.writes = active.writes.then(async () => {
      if (!this.harness) return
      await this.harness.commit(async tx => {
        const task = (await tx.doc(BackgroundDoc, active.conversationId)).tasks[active.taskId]
        if (!task) return
        task.output = active.output
        if (active.child.pid !== undefined) task.pid = active.child.pid
        if (final) {
          task.status = final.status
          task.endedAt = Date.now()
          if (final.exitCode === undefined) delete task.exitCode
          else task.exitCode = final.exitCode
        }
      }, BACKGROUND_CONTEXT)
    }).catch(() => {})
    return active.writes
  }

  private async finish(active: ActiveTask, status: BackgroundTask['status'], exitCode?: number): Promise<void> {
    if (active.timer) clearTimeout(active.timer)
    active.timer = undefined
    try { await this.persist(active, { status, ...(exitCode === undefined ? {} : { exitCode }) }) } finally {
      this.active.delete(active.taskId)
      active.resolveDone()
    }
  }
}

const services = new WeakMap<PluginContext, BackgroundService>()

export function backgroundService(ctx: PluginContext): BackgroundService {
  let service = services.get(ctx)
  if (!service) { service = new BackgroundService(ctx); services.set(ctx, service) }
  return service
}

export const BackgroundPlugin: HostPlugin = {
  id: 'background',
  register(ctx) { backgroundService(ctx) },
}
