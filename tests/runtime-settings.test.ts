import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openHost } from '../server/host.ts'
import { RuntimeSettingsStore } from '../server/runtime-settings.ts'
import { WorkspaceManager } from '../server/workspaces.ts'

test('runtime settings persist validated retry and compact model policy', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-runtime-settings-'))
  try {
    const store = await RuntimeSettingsStore.open(dataDir)
    await store.save({ retry: { enabled: false, maxRetries: 5, baseDelayMs: 100, maxAgentDelayMs: 5000 }, compaction: { enabled: false }, compactModel: { provider: 'local', modelId: 'small' } })
    const reopened = await RuntimeSettingsStore.open(dataDir)
    assert.equal(reopened.state.retry.maxRetries, 5)
    assert.equal(reopened.state.compaction.enabled, false)
    assert.deepEqual(reopened.state.compactModel, { provider: 'local', modelId: 'small' })
    await assert.rejects(store.save({ retry: { enabled: true, maxRetries: -1, baseDelayMs: 0, maxAgentDelayMs: 0 }, compaction: { enabled: true } }))
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('real host restart releases the workspace lock and applies plugin tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-real-restart-'))
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'AGENTS.md'), 'Use the workspace rules.')
  const previous = process.env.DURABLE_WORKSPACE_DATA
  process.env.DURABLE_WORKSPACE_DATA = dataDir
  const manager = await WorkspaceManager.open(workspace, path => openHost(path), join(root, 'workspaces.json'))
  try {
    const names = () => manager.host.context.registry.snapshot().tools().map(item => item.tool.name)
    for (const tool of ['TaskCreate', 'TaskList', 'TaskGet', 'TaskUpdate', 'subagent', 'bg_run', 'bg_status', 'bg_logs', 'bg_kill']) assert.ok(names().includes(tool), tool)
    assert.ok(manager.host.context.registry.snapshot().extension('app.compact-model'))
    assert.ok(manager.host.context.registry.snapshot().extension('app.context'))
    await manager.host.plugins.setEnabled('background', false)
    await manager.restart()
    assert.ok(!names().includes('bg_run'))
    assert.ok(names().includes('TaskCreate'))
  } finally {
    await manager.close()
    if (previous === undefined) delete process.env.DURABLE_WORKSPACE_DATA
    else process.env.DURABLE_WORKSPACE_DATA = previous
    await rm(root, { recursive: true, force: true })
  }
})
