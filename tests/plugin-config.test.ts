import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PluginConfigStore } from '../server/plugin-config.ts'

test('builtin plugins default to enabled with their tool metadata', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-plugin-config-'))
  try {
    const store = await PluginConfigStore.open(dataDir)
    assert.deepEqual(store.state, { todo: true, subagent: true, background: true, compaction: true, context: true, 'session-title': true })
    assert.deepEqual(store.items.map(({ id, tools }) => ({ id, tools })), [
      { id: 'todo', tools: ['TaskCreate', 'TaskList', 'TaskGet', 'TaskUpdate'] },
      { id: 'subagent', tools: ['subagent'] },
      { id: 'background', tools: ['bg_run', 'bg_status', 'bg_logs', 'bg_kill'] },
      { id: 'compaction', tools: [] },
      { id: 'context', tools: ['AGENTS.md', 'skills/*/SKILL.md'] },
      { id: 'session-title', tools: ['session-title.rename', 'session-title.refresh'] },
    ])
    assert.equal(store.items.find(item => item.id === 'compaction')?.name, '自动 Compact')
    assert.equal((await stat(join(dataDir, 'plugins.json'))).mode & 0o777, 0o600)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('plugin enabled state persists across stores', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-plugin-config-'))
  try {
    const store = await PluginConfigStore.open(dataDir)
    await store.setEnabled('todo', false)
    await store.setEnabled('compaction', false)
    assert.equal(store.items.find(item => item.id === 'todo')?.enabled, false)

    const reopened = await PluginConfigStore.open(dataDir)
    assert.deepEqual(reopened.state, { todo: false, subagent: true, background: true, compaction: false, context: true, 'session-title': true })
    assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'plugins.json'), 'utf8')), reopened.state)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('plugin configuration rejects unknown ids and invalid stored values', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-plugin-config-'))
  try {
    const store = await PluginConfigStore.open(dataDir)
    await assert.rejects(store.setEnabled('unknown', false), /Unknown plugin: unknown/)
    await assert.rejects(store.setEnabled('todo', 'false' as unknown as boolean), /must be boolean/)
    assert.equal(store.state.todo, true)

    await writeFile(join(dataDir, 'plugins.json'), JSON.stringify({ todo: true, subagent: true, background: true, compaction: 'yes' }))
    await assert.rejects(PluginConfigStore.open(dataDir), /Invalid plugin configuration/)
    await writeFile(join(dataDir, 'plugins.json'), JSON.stringify({ todo: true, subagent: true, background: true, compaction: true, unknown: false }))
    await assert.rejects(PluginConfigStore.open(dataDir), /Unknown plugin: unknown/)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
