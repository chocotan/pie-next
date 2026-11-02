import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable'
import { PluginContext } from '../server/plugin-runtime.ts'
import { ProviderStore } from '../server/providers.ts'
import { RuntimeSettingsStore } from '../server/runtime-settings.ts'
import { SuperagentPlugin, SuperagentStore, superagentStore } from '../server/plugins/superagent.ts'

const context = BACKGROUND_CONTEXT

test('superagent accepts only an enabled rule and binds one conversation', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pie-next-superagent-'))
  await writeFile(join(dataDir, 'providers.json'), '[]')
  const providers = await ProviderStore.open(dataDir)
  const registry = createRegistry()
  const plugins = new PluginContext(registry, createModels(), providers, await RuntimeSettingsStore.open(dataDir))
  superagentStore(await SuperagentStore.open(dataDir))
  SuperagentPlugin.register(plugins)
  const harness = await Harness.open(new MemoryStorage(), { models: plugins.models, registry }, context)
  plugins.setHarness(harness)
  try {
    await superagentStore().saveSettings({ ...superagentStore().snapshot().settings, allowed: ['Ada'] })
    const accept = plugins.commands.get('superagent.accept')!
    await assert.rejects(accept.handler({ title: '修正文案', scope: '只改 README 标题', requester: 'Bob', ruleIds: ['copy'] }, context), /允许列表/)
    const ticket = await accept.handler({ title: '修正文案', scope: '只改 README 标题', requester: 'Ada', ruleIds: ['copy'] }, context) as { id: string; conversationId: number; stage: string }
    assert.equal(ticket.stage, 'working')
    assert.equal(typeof ticket.conversationId, 'number')
    const stored = superagentStore().snapshot().tickets.find(item => item.id === ticket.id)
    assert.equal(stored?.conversationId, ticket.conversationId)
    const stop = plugins.commands.get('superagent.stop')!
    assert.deepEqual(await stop.handler({ id: ticket.id, reason: '停止' }, context), { accepted: true })
    assert.equal(superagentStore().snapshot().tickets[0]?.stage, 'ended')
    assert.equal(superagentStore().snapshot().sources.every(source => source.enabled === false), true)
  } finally {
    await harness.close(context)
    await rm(dataDir, { recursive: true, force: true })
  }
})
