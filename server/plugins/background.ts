import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { Type } from '@earendil-works/pi-ai'
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context'
import {
  AgentDoc, defineDoc, defineExtension, defineTool,
  type ConversationId, type Cursor, type Harness,
} from '@earendil-works/pi-durable'
import { z } from 'zod'
import type { HostPlugin, PluginContext } from '../plugin-runtime.ts'
import { guard } from './approval.ts'
import { readTaskLogs, stopProcessTree, waitForChildProcess } from './background-process.ts'

export type BackgroundTask = {
  id: string
  command: string
  title?: string
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted'
  pid?: number
  output: string
  outputPath?: string
  bytesWritten?: number
  error?: string
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

const PREVIEW_LIMIT = 50 * 1024
const OUTPUT_LIMIT = 20 * 1024 * 1024
const PERSIST_INTERVAL = 250

type ActiveTask = {
  conversationId: ConversationId
  task: BackgroundTask
  child: ChildProcess
  stream: WriteStream
  output: string
  stopping?: 'user' | 'failure' | 'shutdown'
  finalizing: boolean
  writes: Promise<void>
  timer?: NodeJS.Timeout
  stop?: Promise<void>
  done: Promise<void>
  resolveDone: () => void
}

function textResult(text: string, isError = false) {
  return { output: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) }
}

function resolveTask(state: BackgroundState | undefined, taskId: string): BackgroundTask {
  const matches = Object.values(state?.tasks ?? {}).filter(task => task.id === taskId || task.id.startsWith(taskId))
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous background task ID: ${taskId}` : `Unknown background task: ${taskId}`)
  return matches[0]!
}

/** One Host activation owns live children; persisted PIDs never confer ownership after restart. */
export class BackgroundService {
  private harness?: Harness
  private dataDir?: string
  private readonly active = new Map<string, ActiveTask>()
  private readonly admissions = new Set<Promise<BackgroundTask>>()
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
      description: 'Read a background task output from the head or tail, capped at 50KiB with byte-accurate truncation.',
      parameters: Type.Object({ taskId: Type.String(), maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 * 1024 })), tail: Type.Optional(Type.Boolean()) }),
      replay: 'safe',
      execute: async (args, api, context) => {
        const state = await this.store().snapshot(BackgroundDoc, api.conversationId, context)
        const task = resolveTask(state, args.taskId)
        const limit = args.maxBytes ?? 50 * 1024
        if (!task.outputPath) return textResult(`${task.output || '(no output yet)'}\n\n[Legacy preview; ${task.status}]`)
        const result = await readTaskLogs(task.outputPath, limit, args.tail ?? true)
        return textResult(`${result.text || '(no output yet)'}\n\n[Task ${task.id}; ${task.status}; ${result.bytesRead}/${result.totalBytes} bytes; truncated=${result.truncated}; ${task.outputPath}]`)
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
        return textResult(`Background task ${task.id}: stopped.`)
      },
    })
    ctx.extension(defineExtension({ name: 'background', tools: [start, status, logs, kill], wraps: [guard(start)] }))
    ctx.document('background', BackgroundDoc, 'background')
    ctx.command('background.start', z.object({
      conversationId: z.number().int().positive(),
      command: z.string().min(1).max(100_000).refine(value => value.trim().length > 0 && !value.includes('\0')),
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

  bind(harness: Harness, dataDir: string): void {
    this.harness = harness
    this.dataDir = dataDir
  }

  private store(): Harness {
    if (!this.harness || !this.dataDir) throw new Error('Background tasks are not ready')
    return this.harness
  }

  start(conversationId: ConversationId, input: { command: string; title?: string }, context: Context): Promise<BackgroundTask> {
    const admission = this.startAdmitted(conversationId, input, context)
    this.admissions.add(admission)
    void admission.finally(() => this.admissions.delete(admission)).catch(() => {})
    return admission
  }

  private async startAdmitted(conversationId: ConversationId, input: { command: string; title?: string }, context: Context): Promise<BackgroundTask> {
    if (this.closing) throw new Error('Background tasks are shutting down')
    const harness = this.store()
    if (!await harness.conversation(conversationId, context)) throw new Error('Conversation not found')
    const agent = await harness.snapshot(AgentDoc, conversationId, context)
    const id = randomUUID()
    const outputPath = join(this.dataDir!, 'tasks', `${id}.output`)
    const task: BackgroundTask = {
      id, command: input.command, status: 'running', output: '', outputPath, bytesWritten: 0, createdAt: Date.now(),
      ...(input.title === undefined ? {} : { title: input.title }),
    }
    await mkdir(join(this.dataDir!, 'tasks'), { recursive: true, mode: 0o700 })
    const stream = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 })
    await once(stream, 'open')
    await harness.commit(async tx => {
      const doc = await tx.doc(BackgroundDoc, conversationId)
      doc.tasks[id] = { ...task }
    }, context)
    let child: ChildProcess | undefined
    let active: ActiveTask | undefined
    try {
      if (this.closing) throw new Error('Background tasks are shutting down')
      child = spawn(input.command, {
        cwd: agent?.cwd ?? process.cwd(), shell: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      })
      let resolveDone!: () => void
      active = {
        conversationId, task, child, stream, output: '', finalizing: false,
        writes: Promise.resolve(), done: new Promise<void>(resolve => { resolveDone = resolve }), resolveDone,
      }
      this.active.set(id, active)
      if (child.pid !== undefined) task.pid = child.pid
      const append = (chunk: Buffer): void => {
        const current = active!
        if (current.finalizing || current.stopping === 'failure' || stream.destroyed) return
        const remaining = Math.max(0, OUTPUT_LIMIT - (task.bytesWritten ?? 0))
        const bytes = chunk.subarray(0, remaining)
        if (bytes.length) {
          task.bytesWritten = (task.bytesWritten ?? 0) + bytes.length
          current.output = `${current.output}${bytes.toString('utf8')}`.slice(-PREVIEW_LIMIT)
          if (!stream.write(bytes)) { child!.stdout?.pause(); child!.stderr?.pause() }
          this.schedulePersist(current)
        }
        if (chunk.length > remaining) this.fail(current, `Output exceeded cap of ${OUTPUT_LIMIT} bytes`)
      }
      stream.on('drain', () => { child!.stdout?.resume(); child!.stderr?.resume() })
      stream.on('error', error => { if (active) this.fail(active, `Output file write failed: ${error.message}`) })
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      active.done = this.finish(active, waitForChildProcess(child))
      await once(child, 'spawn')
      if (this.closing) throw new Error('Background tasks are shutting down')
      await this.persist(active)
      return { ...task }
    } catch (error) {
      if (active) {
        active.task.error ??= error instanceof Error ? error.message : String(error)
        active.stopping ??= 'failure'
        await this.requestStop(active).catch(() => {})
        await active.done
      } else {
        stream.destroy()
        await finished(stream).catch(() => {})
      }
      throw error
    }
  }

  async stop(conversationId: ConversationId, taskId: string, context: Context): Promise<void> {
    const harness = this.store()
    const state = await harness.snapshot(BackgroundDoc, conversationId, context)
    const task = state?.tasks[taskId]
    if (!task) throw new Error('Background task not found')
    if (task.status !== 'running') return
    const active = this.active.get(taskId)
    if (active && active.conversationId === conversationId) {
      active.stopping ??= 'user'
      await this.requestStop(active)
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
    await Promise.allSettled([...this.admissions])
    const results = await Promise.allSettled([...this.active.values()].map(async active => {
      active.stopping ??= 'shutdown'
      await this.requestStop(active)
      await active.done
    }))
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(result => (result as PromiseRejectedResult).reason), 'Background task shutdown failed')
  }

  private fail(active: ActiveTask, message: string): void {
    active.task.error ??= message
    active.stopping = 'failure'
    void this.requestStop(active).catch(error => { active.task.error = `${active.task.error}; ${String(error)}` })
  }

  private requestStop(active: ActiveTask): Promise<void> {
    active.stop ??= stopProcessTree(active.child)
    return active.stop
  }

  private schedulePersist(active: ActiveTask): void {
    if (active.timer) return
    active.timer = setTimeout(() => {
      active.timer = undefined
      void this.persist(active).catch(error => this.fail(active, `Output preview commit failed: ${String(error)}`))
    }, PERSIST_INTERVAL)
    active.timer.unref()
  }

  private persist(active: ActiveTask, final = false): Promise<void> {
    active.writes = active.writes.catch(() => {}).then(async () => {
      if (!this.harness) return
      await this.harness.commit(async tx => {
        const task = (await tx.doc(BackgroundDoc, active.conversationId)).tasks[active.task.id]
        if (!task) return
        task.output = active.output
        task.outputPath = active.task.outputPath
        task.bytesWritten = active.task.bytesWritten
        if (active.child.pid !== undefined) task.pid = active.child.pid
        if (active.task.error) task.error = active.task.error
        if (final) {
          task.status = active.task.status
          task.endedAt = active.task.endedAt
          if (active.task.exitCode === undefined) delete task.exitCode
          else task.exitCode = active.task.exitCode
        }
      }, BACKGROUND_CONTEXT)
    })
    return active.writes
  }

  private async finish(active: ActiveTask, exit: Promise<number | null>): Promise<void> {
    const task = active.task
    try {
      try { task.exitCode = await exit ?? undefined }
      catch (error) { task.error ??= `Spawn failed: ${String(error)}` }
      await this.requestStop(active)
    } catch (error) {
      task.error = `${task.error ? `${task.error}; ` : ''}Tree cleanup failed: ${String(error)}`
    } finally {
      active.finalizing = true
      if (active.timer) clearTimeout(active.timer)
      active.timer = undefined
      try {
        if (!active.stream.destroyed) {
          const closed = finished(active.stream)
          active.stream.end()
          await closed
        }
      } catch (error) {
        task.error ??= `Output close failed: ${String(error)}`
      }
      task.status = task.error ? 'failed' : active.stopping ? 'stopped' : task.exitCode === 0 ? 'completed' : 'failed'
      task.endedAt = Date.now()
      if (task.status === 'failed') task.error ??= `Command exited with code ${task.exitCode ?? 'null'}`
      try {
        await this.persist(active, true)
      } catch (error) {
        task.status = 'failed'
        task.error = `Terminal metadata write failed: ${String(error)}`
        await this.persist(active, true).catch(() => {})
      } finally {
        this.active.delete(task.id)
        active.resolveDone()
      }
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
