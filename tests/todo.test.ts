import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable'
import { createModels } from '@earendil-works/pi-ai/models'
import { createTask, sortTasks, TodoDoc, TodoExtension, updateTask, updateTodos } from '../server/plugins/todo.ts'

const context = BACKGROUND_CONTEXT

test('Todo updates atomically and rewinds to the update entry', async () => {
  const registry = createRegistry()
  registry.install(TodoExtension)
  const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, context)
  const root = await harness.root(context)
  await updateTodos(harness, root.id, [{ id: 'one', content: 'first', status: 'in_progress' }], context)
  const firstEntry = await root.commit(async tx => tx.appendEntry(root.id, { kind: 'app.test', data: { version: 1 } }), context)
  await updateTodos(harness, root.id, [{ id: 'one', content: 'first', status: 'completed' }, { id: 'two', content: 'second', status: 'pending' }], context)
  assert.deepEqual((await harness.snapshot(TodoDoc, root.id, context))?.items.map(item => item.status), ['completed', 'pending'])
  assert.deepEqual((await harness.snapshotAsOf(TodoDoc, root.id, firstEntry.id, context))?.items.map(item => item.status), ['in_progress'])
  await harness.close(context)
})

test('AI task tools create tasks and enforce dependencies', () => {
  const first = createTask([], { subject: 'Implement', description: 'Build the feature', agentType: 'worker' })
  const second = createTask(first.items, { subject: 'Verify' })
  assert.equal(second.task.id, '2')
  const blocked = updateTask(second.items, { taskId: '2', addBlockedBy: ['1'] })
  assert.throws(() => updateTask(blocked, { taskId: '2', status: 'in_progress' }), /blocked by 1/)
  assert.throws(() => updateTask(blocked, { taskId: '1', addBlockedBy: ['2'] }), /cycle/)
  const ready = updateTask(updateTask(blocked, { taskId: '1', status: 'completed' }), { taskId: '2', status: 'in_progress', owner: 'agent-2' })
  assert.equal(ready.find(item => item.id === '2')?.owner, 'agent-2')
  assert.deepEqual(sortTasks(ready).map(item => item.id), ['2', '1'])
})
