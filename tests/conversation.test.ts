import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable'
import { ConversationPlugin } from '../server/plugins/conversation.ts'
import { PluginContext } from '../server/plugin-runtime.ts'
import { ProviderStore } from '../server/providers.ts'

const context = BACKGROUND_CONTEXT

test('session.create creates a selectable ownerless conversation', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-conversation-'))
  const providers = await ProviderStore.open(dataDir)
  const registry = createRegistry()
  const plugins = new PluginContext(registry, createModels(), providers)
  ConversationPlugin.register(plugins)
  const harness = await Harness.open(new MemoryStorage(), { models: plugins.models, registry }, context)
  plugins.setHarness(harness)
  try {
    const root = await harness.root(context)
    const command = plugins.commands.get('session.create')
    assert.ok(command)
    const result = await command.handler({}, context) as { conversationId: number }
    assert.notEqual(result.conversationId, Number(root.id))
    const created = await harness.conversation(result.conversationId as never, context)
    assert.ok(created)
    const record = await harness.commit(tx => tx.conversation(created.id), context)
    assert.equal(record?.owner, undefined)
  } finally {
    await harness.close(context)
    await rm(dataDir, { recursive: true, force: true })
  }
})
