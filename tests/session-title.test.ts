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
import { fallbackSessionTitle, SessionTitleDoc, SessionTitlePlugin, sessionTitleService, titleFromOutput } from '../server/plugins/session-title.ts'

const context = BACKGROUND_CONTEXT

test('DSH title normalization keeps plain text and UTF-8 safe fallbacks', () => {
  assert.equal(titleFromOutput('**修复登录缺陷**\n额外解释'), '修复登录缺陷')
  assert.equal(fallbackSessionTitle('one two three four five six seven eight nine'), 'one two three four five six seven eight')
  assert.equal(titleFromOutput('\u001b[31m红色标题\u001b[0m'), '红色标题')
})

test('first user message gets a fallback then one asynchronous LLM title', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pie-next-title-'))
  await writeFile(join(dataDir, 'providers.json'), '[]')
  const providers = await ProviderStore.open(dataDir)
  const selection = (await providers.save({ id: 'local-test', name: 'Local', protocol: 'openai-completions', baseUrl: 'http://127.0.0.1:0/v1', models: 'title-model', enabled: true, hasKey: false }), providers.defaultSelection()!)
  const models = createModels()
  providers.syncModels(models)
  let calls = 0
  models.completeSimple = async () => {
    calls++
    return { content: [{ type: 'text', text: '**修复登录缺陷**' }], stopReason: 'stop' } as never
  }
  const registry = createRegistry()
  const plugins = new PluginContext(registry, models, providers)
  SessionTitlePlugin.register(plugins)
  const service = sessionTitleService(plugins)
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context)
  plugins.setHarness(harness)
  try {
    const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: selection } }, context)
    await harness.commit(async tx => {
      await tx.doc(SessionTitleDoc, conversation.id)
      await tx.appendEntry(conversation.id, { kind: 'pi.user', model: [{ role: 'user', content: '请帮我排查并修复登录页面的认证缺陷', timestamp: Date.now() }] })
    }, context)
    await service.acceptUserMessage(conversation.id, context)
    assert.equal((await harness.snapshot(SessionTitleDoc, conversation.id, context))?.source, 'fallback')
    await service.close()
    const generated = await harness.snapshot(SessionTitleDoc, conversation.id, context)
    assert.equal(generated?.title, '修复登录缺陷')
    assert.equal(generated?.source, 'llm')
    assert.equal(calls, 1)
    await service.acceptUserMessage(conversation.id, context)
    assert.equal(calls, 1)
    await service.rename(conversation.id, '手动标题', context)
    assert.equal((await harness.snapshot(SessionTitleDoc, conversation.id, context))?.source, 'user')
  } finally {
    await service.close()
    await harness.close(context)
    await rm(dataDir, { recursive: true, force: true })
  }
})
