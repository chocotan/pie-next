import { z } from 'zod'
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context'
import { AgentDoc, defineDoc, type ConversationId, type Cursor, type Harness } from '@earendil-works/pi-durable'
import type { HostPlugin, PluginContext } from '../plugin-runtime.ts'

export type SessionTitleState = {
  title: string
  source: 'none' | 'fallback' | 'llm' | 'user'
  entryId?: number
  error?: string
}

export const SessionTitleDoc = defineDoc<SessionTitleState>({
  kind: 'app.session-title', version: 1, scope: 'conversation', history: 'latest', fork: 'current',
  initial: () => ({ title: '', source: 'none' }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
})

// Ported from DSH session-title/normalize.ts: terminal-safe text and UTF-8 code-point truncation.
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
const ESC_SEQUENCE = /\u001B[@-_]/gu
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

function cleanTitleText(input: string): string {
  return input.replace(OSC_SEQUENCE, '').replace(CSI_SEQUENCE, '').replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '').replace(DIRECTIONAL_CONTROL, '').replace(/\s+/gu, ' ').trim()
}

function truncateTitleUtf8(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input
  let used = 0, output = ''
  for (const character of input) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

export function normalizeSessionTitle(input: string, maxBytes = 120): string {
  return truncateTitleUtf8(cleanTitleText(input), maxBytes).trimEnd()
}

export function fallbackSessionTitle(input: string): string {
  const words = cleanTitleText(input).split(' ').filter(Boolean).slice(0, 8)
  return truncateTitleUtf8(words.join(' '), 96).trimEnd()
}

export function titleFromOutput(text: string): string {
  const line = text.split(/\r?\n/u).map(item => item.trim()).find(Boolean) ?? ''
  const emphasis = /^(?<marker>\*{1,3})(?<inner>\S(?:.*\S)?)\k<marker>$/u.exec(line)?.groups
  return normalizeSessionTitle(emphasis && !emphasis.inner!.includes(emphasis.marker!) ? emphasis.inner! : line)
}

const TITLE_SYSTEM_PROMPT = [
  'Create a concise title for an AI coding-assistant session from the supplied human messages.',
  'Return only the title on one line, **in plain text of natural language**, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. No code is allowed.',
  'Use the language of the messages.',
  'Aim for about 8 words in non-CJK languages or 16 CJK characters.',
  'If the messages give little to name, still return a short best-effort title, such as Greeting, instead of explaining.',
].join('\n')

function messageText(content: string | readonly unknown[]): string {
  if (typeof content === 'string') return content
  return content.map(part => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text?: unknown }).text ?? '') : '').join('')
}

export class SessionTitleService {
  private readonly controllers = new Map<number, AbortController>()
  private readonly tasks = new Map<number, Promise<void>>()

  constructor(private readonly ctx: PluginContext) {
    ctx.document('session-title', SessionTitleDoc, 'session-title')
    ctx.command('session-title.rename', z.object({ conversationId: z.number().int().positive(), title: z.string().max(1000) }), async (args, context) => {
      const input = args as { conversationId: number; title: string }
      return { title: await this.rename(input.conversationId as ConversationId, input.title, context) }
    })
    ctx.command('session-title.refresh', z.object({ conversationId: z.number().int().positive() }), async (args, context) => {
      await this.refresh((args as { conversationId: number }).conversationId as ConversationId, context)
      return { accepted: true as const }
    })
  }

  async acceptUserMessage(conversationId: ConversationId, context: Context): Promise<void> {
    const harness = this.ctx.getHarness()
    if (Number(conversationId) === 1) return
    const record = await harness.commit(tx => tx.conversation(conversationId), context)
    if (!record || record.parent || record.owner) return
    const existing = await harness.snapshot(SessionTitleDoc, conversationId, context)
    if (existing?.entryId !== undefined || existing?.source === 'user') return
    const conversation = await harness.conversation(conversationId, context)
    if (!conversation) return
    const first = await firstUserMessage(harness, conversationId, context)
    if (!first) return
    const fallback = fallbackSessionTitle(first.text)
    if (!fallback) return
    let claimed = false
    await harness.commit(async tx => {
      const doc = await tx.doc(SessionTitleDoc, conversationId)
      if (doc.entryId !== undefined || doc.source === 'user') return
      doc.title = fallback
      doc.source = 'fallback'
      doc.entryId = first.id
      delete doc.error
      claimed = true
    }, context)
    if (claimed) void this.generate(conversationId, first.text, first.id)
  }

  async rename(conversationId: ConversationId, input: string, context: Context): Promise<string> {
    const title = normalizeSessionTitle(input)
    if (!title) throw new Error('Session title cannot be empty')
    this.controllers.get(Number(conversationId))?.abort()
    await this.ctx.getHarness().commit(async tx => {
      const doc = await tx.doc(SessionTitleDoc, conversationId)
      doc.title = title
      doc.source = 'user'
      delete doc.error
    }, context)
    return title
  }

  async refresh(conversationId: ConversationId, context: Context): Promise<void> {
    const first = await firstUserMessage(this.ctx.getHarness(), conversationId, context)
    if (!first) throw new Error('Session has no eligible user message')
    this.controllers.get(Number(conversationId))?.abort()
    await this.ctx.getHarness().commit(async tx => {
      const doc = await tx.doc(SessionTitleDoc, conversationId)
      doc.source = 'fallback'
      doc.entryId = first.id
      delete doc.error
    }, context)
    void this.generate(conversationId, first.text, first.id)
  }

  async close(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort()
    await Promise.allSettled(this.tasks.values())
  }

  private generate(conversationId: ConversationId, text: string, entryId: number): Promise<void> {
    const id = Number(conversationId)
    this.controllers.get(id)?.abort()
    const controller = new AbortController()
    this.controllers.set(id, controller)
    const task = this.runGenerate(conversationId, text, entryId, controller).finally(() => {
      if (this.controllers.get(id) === controller) this.controllers.delete(id)
      this.tasks.delete(id)
    })
    this.tasks.set(id, task)
    return task
  }

  private async runGenerate(conversationId: ConversationId, text: string, entryId: number, controller: AbortController): Promise<void> {
    const harness = this.ctx.getHarness()
    try {
      if (controller.signal.aborted) return
      if (Buffer.byteLength(text, 'utf8') > 32 * 1024) throw new Error('Title input exceeds 32KiB')
      const agent = await harness.snapshot(AgentDoc, conversationId, BACKGROUND_CONTEXT)
      const ref = agent?.model ?? this.ctx.providers.defaultSelection()
      const model = ref ? this.ctx.models.getModel(ref.provider, ref.modelId) : undefined
      if (!model) throw new Error('No model is available for session title generation')
      const response = await this.ctx.models.completeSimple(model, {
        systemPrompt: TITLE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Generate the session title from this JSON array of human messages:\n${JSON.stringify([{ content: text }])}`, timestamp: Date.now() }],
      }, {
        signal: controller.signal, maxTokens: 128, timeoutMs: 20_000, maxRetries: 0,
        ...(model.reasoning ? { reasoning: 'minimal' as const } : {}),
      })
      if (response.stopReason !== 'stop') throw new Error(response.errorMessage || 'Title generation did not finish')
      const title = titleFromOutput(response.content.filter(part => part.type === 'text').map(part => part.text).join(' '))
      if (!title) throw new Error('Title model produced no text')
      if (controller.signal.aborted) return
      await harness.commit(async tx => {
        const doc = await tx.doc(SessionTitleDoc, conversationId)
        if (doc.source === 'user' || doc.entryId !== entryId) return
        doc.title = title
        doc.source = 'llm'
        delete doc.error
      }, BACKGROUND_CONTEXT)
    } catch (cause) {
      if (controller.signal.aborted) return
      await harness.commit(async tx => {
        const doc = await tx.doc(SessionTitleDoc, conversationId)
        if (doc.source === 'user' || doc.entryId !== entryId) return
        doc.error = cause instanceof Error ? cause.message : 'Title generation failed'
      }, BACKGROUND_CONTEXT).catch(() => {})
    }
  }
}

async function firstUserMessage(harness: Harness, conversationId: ConversationId, context: Context): Promise<{ id: number; text: string } | undefined> {
  const conversation = await harness.conversation(conversationId, context)
  if (!conversation) return undefined
  let cursor: Cursor | undefined
  do {
    const page = await conversation.entries({ order: 'ascending' }, 100, cursor, context)
    for (const entry of page.items) {
      const message = entry.model?.[0]
      if (message?.role !== 'user') continue
      const text = messageText(message.content).trim()
      if (text) return { id: Number(entry.id), text }
    }
    cursor = page.next
  } while (cursor !== undefined)
  return undefined
}

const services = new WeakMap<PluginContext, SessionTitleService>()

export function sessionTitleService(ctx: PluginContext): SessionTitleService {
  let service = services.get(ctx)
  if (!service) { service = new SessionTitleService(ctx); services.set(ctx, service) }
  return service
}

export function existingSessionTitleService(ctx: PluginContext): SessionTitleService | undefined {
  return services.get(ctx)
}

export const SessionTitlePlugin: HostPlugin = {
  id: 'session-title',
  register(ctx) { sessionTitleService(ctx) },
}
