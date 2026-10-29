import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProviderStore } from '../server/providers.ts'

test('Provider secrets stay server-side and blank edits preserve them', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-provider-test-'))
  try {
    const store = await ProviderStore.open(dataDir)
    const profile = { id: 'local-test', name: 'Local Test', protocol: 'openai-completions' as const, baseUrl: 'http://127.0.0.1:11434/v1', models: 'test-model', enabled: true, hasKey: false }
    await store.save(profile, 'secret-for-test')
    const saved = store.list().find(item => item.id === profile.id)
    assert.equal(saved?.hasKey, true)
    assert.equal('apiKey' in saved!, false)
    await store.save({ ...saved!, name: 'Renamed' })
    assert.equal(store.list().find(item => item.id === profile.id)?.hasKey, true)
    const serialized = await readFile(join(dataDir, 'providers.json'), 'utf8')
    assert.equal(JSON.parse(serialized).find((provider: { id: string }) => provider.id === 'local-test').apiKey, 'secret-for-test')
    assert.equal((await stat(join(dataDir, 'providers.json'))).mode & 0o777, 0o600)
    const models = store.createModels()
    assert.ok(models.getModel('local-test', 'test-model'))
    await store.setEnabled('local-test', false)
    store.syncModels(models)
    assert.equal(models.getModel('local-test', 'test-model'), undefined)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
