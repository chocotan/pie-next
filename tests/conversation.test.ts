import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { AgentDoc, createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable'
import { ConversationPlugin } from '../server/plugins/conversation.ts'
import { PluginContext } from '../server/plugin-runtime.ts'
import { ProviderStore } from '../server/providers.ts'

const context = BACKGROUND_CONTEXT

test('session.create creates a selectable ownerless conversation', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-conversation-'))
  await writeFile(join(dataDir, 'providers.json'), '[]')
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
    const list = plugins.commands.get('session.list')
    assert.ok(list)
    const visible = await list.handler({}, context) as { items: Array<{ id: number }> }
    assert.deepEqual(visible.items.map(item => Number(item.id)), [result.conversationId])

    const input = plugins.commands.get('session.input')
    assert.ok(input)
    await assert.rejects(input.handler({ conversationId: result.conversationId, requestId: 'missing-model', content: 'hello' }, context), /请先/)
    await providers.save({ id: 'local-test', name: 'Local Test', protocol: 'openai-completions', baseUrl: 'http://127.0.0.1:0/v1', models: 'test-model', enabled: true, hasKey: false })
    await input.handler({ conversationId: result.conversationId, requestId: 'with-model', content: 'hello' }, context)
    const agent = await harness.snapshot(AgentDoc, created.id, context)
    assert.deepEqual(agent?.model, { provider: 'local-test', modelId: 'test-model' })
    const configure = plugins.commands.get('session.configure')
    assert.ok(configure)
    await configure.handler({ conversationId: result.conversationId, thinkingLevel: 'high' }, context)
    assert.equal((await harness.snapshot(AgentDoc, created.id, context))?.thinkingLevel, 'high')
    await configure.handler({ conversationId: result.conversationId, thinkingLevel: null }, context)
    assert.equal((await harness.snapshot(AgentDoc, created.id, context))?.thinkingLevel, undefined)
  } finally {
    await harness.close(context)
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('session.delete removes a conversation from the list and stops its work', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-conversation-'))
  await writeFile(join(dataDir, 'providers.json'), '[]')
  const providers = await ProviderStore.open(dataDir)
  const registry = createRegistry()
  const plugins = new PluginContext(registry, createModels(), providers)
  ConversationPlugin.register(plugins)
  const harness = await Harness.open(new MemoryStorage(), { models: plugins.models, registry }, context)
  plugins.setHarness(harness)
  try {
    await harness.root(context)
    const create = plugins.commands.get('session.create')
    assert.ok(create)
    const created = await create.handler({}, context) as { conversationId: number }
    const remove = plugins.commands.get('session.delete')
    assert.ok(remove)
    await remove.handler({ conversationId: created.conversationId }, context)
    const list = plugins.commands.get('session.list')
    assert.ok(list)
    assert.deepEqual((await list.handler({}, context) as { items: unknown[] }).items, [])
    await assert.rejects(remove.handler({ conversationId: 1 }, context), /internal root/)
  } finally {
    await harness.close(context)
    await rm(dataDir, { recursive: true, force: true })
  }
})
