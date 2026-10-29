import type { Context } from '@earendil-works/chord'
import type { ConversationDocToken, ConversationId, Extension, Harness, JsonObject, Registry } from '@earendil-works/pi-durable'
import type { ZodType } from 'zod'
import type { MutableModels } from '@earendil-works/pi-ai/models'
import type { ProviderStore } from './providers.ts'

export type CommandHandler = (args: unknown, context: Context) => Promise<unknown>
export interface HostPlugin {
  id: string
  register(context: PluginContext): void | Promise<void>
}

export class PluginContext {
  readonly commands = new Map<string, { schema: ZodType; handler: CommandHandler; owner: string }>()
  readonly documents = new Map<string, { token: ConversationDocToken<JsonObject>; owner: string }>()
  private harness?: Harness

  constructor(readonly registry: Registry, readonly models: MutableModels, readonly providers: ProviderStore) {}

  setHarness(harness: Harness): void { this.harness = harness }
  getHarness(): Harness { if (!this.harness) throw new Error('Harness is not ready'); return this.harness }

  command(name: string, schema: ZodType, handler: CommandHandler, owner = 'core'): void {
    if (this.commands.has(name)) throw new Error(`Duplicate RPC command: ${name}`)
    this.commands.set(name, { schema, handler, owner })
  }

  document(key: string, token: ConversationDocToken<JsonObject>, owner: string): void {
    if (this.documents.has(key)) throw new Error(`Duplicate public document: ${key}`)
    this.documents.set(key, { token, owner })
  }

  extension(extension: Extension): void { this.registry.install(extension) }

  conversation(id: number, context: Context) {
    return this.getHarness().conversation(id as ConversationId, context)
  }
}
