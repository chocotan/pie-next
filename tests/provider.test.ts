import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProviderStore } from '../server/providers.ts'

test('Provider model discovery uses the stored key for blank replacements', async () => {
  const requests: { url?: string; accept?: string; authorization?: string }[] = []
  const server = createServer((request, response) => {
    requests.push({ url: request.url, accept: request.headers.accept, authorization: request.headers.authorization })
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-b' }] }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-provider-sync-test-'))
  try {
    await writeFile(join(dataDir, 'providers.json'), '[]')
    const store = await ProviderStore.open(dataDir)
    const { port } = server.address() as AddressInfo
    const profile = { id: 'sync-test', name: 'Sync Test', protocol: 'openai-completions' as const, baseUrl: `http://127.0.0.1:${port}/v1/`, models: 'existing-model', enabled: true, hasKey: false }
    await store.save(profile, 'stored-secret')
    const models = await store.discoverModels({ ...profile, models: '' }, '   ')
    assert.deepEqual(models, ['model-b', 'model-a'])
    assert.deepEqual(requests, [{ url: '/v1/models', accept: 'application/json', authorization: 'Bearer stored-secret' }])
    assert.equal(store.list()[0]?.models, 'existing-model')
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('Provider secrets stay server-side and blank edits preserve them', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-provider-test-'))
  try {
    await writeFile(join(dataDir, 'providers.json'), '[]')
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

    await store.save({ id: 'keyless', name: 'Keyless', protocol: 'openai-completions', baseUrl: 'http://127.0.0.1:11434/v1', models: 'local-model', enabled: true, hasKey: false })
    store.syncModels(models)
    const keylessModel = models.getModel('keyless', 'local-model')
    assert.ok(keylessModel)
    const auth = await models.getAuth(keylessModel)
    assert.equal(auth?.auth.headers?.authorization, 'Bearer unused')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
