import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ConversationId } from '@earendil-works/pi-durable'
import { openHost, type Host } from '../server/host.ts'
import { BackgroundDoc, type BackgroundTask } from '../server/plugins/background.ts'

const context = BACKGROUND_CONTEXT

async function settledTask(host: Host, taskId: string): Promise<BackgroundTask> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = (await host.harness.snapshot(BackgroundDoc, host.rootId as ConversationId, context))?.tasks[taskId]
    if (task && task.status !== 'running') return task
    await delay(25)
  }
  assert.fail('Background task did not settle')
}

test('background commands run real shells, retain bounded output, and stop process groups', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'durable-background-workspace-'))
  const dataDir = await mkdtemp(join(tmpdir(), 'durable-background-data-'))
  await writeFile(join(dataDir, 'providers.json'), '[]')
  const previousDataDir = process.env.DURABLE_WORKSPACE_DATA
  process.env.DURABLE_WORKSPACE_DATA = dataDir
  const host = await openHost(workspace)
  try {
    assert.equal(host.context.documents.get('background')?.token, BackgroundDoc)
    assert.deepEqual(await host.harness.snapshot(BackgroundDoc, host.rootId as ConversationId, context), { tasks: {} })
    const start = host.context.commands.get('background.start')
    const stop = host.context.commands.get('background.stop')
    assert.ok(start)
    assert.ok(stop)

    const started = await start.handler({
      conversationId: host.rootId,
      command: "printf 'stdout\\n'; printf 'stderr\\n' >&2; pwd",
      title: 'completion',
    }, context) as { task: BackgroundTask }
    assert.equal(started.task.status, 'running')
    const completed = await settledTask(host, started.task.id)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.exitCode, 0)
    assert.equal(completed.title, 'completion')
    assert.ok(completed.output.includes('stdout\n'))
    assert.ok(completed.output.includes('stderr\n'))
    assert.ok(completed.output.includes(workspace))
    assert.ok(completed.pid)
    assert.ok(completed.endedAt)

    const failedStart = await start.handler({ conversationId: host.rootId, command: 'exit 7' }, context) as { task: BackgroundTask }
    const failed = await settledTask(host, failedStart.task.id)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.exitCode, 7)

    const largeStart = await start.handler({
      conversationId: host.rootId,
      command: "printf discarded; node -e \"process.stdout.write('x'.repeat(60000))\"",
    }, context) as { task: BackgroundTask }
    const large = await settledTask(host, largeStart.task.id)
    assert.equal(large.status, 'completed')
    assert.equal(large.output.length, 50 * 1024)
    assert.ok(!large.output.includes('discarded'))

    const running = await start.handler({ conversationId: host.rootId, command: 'sleep 30' }, context) as { task: BackgroundTask }
    assert.deepEqual(await stop.handler({ conversationId: host.rootId, taskId: running.task.id }, context), { accepted: true })
    const stopped = await settledTask(host, running.task.id)
    assert.equal(stopped.status, 'stopped')
    assert.ok(stopped.endedAt)
  } finally {
    await host.close()
    if (previousDataDir === undefined) delete process.env.DURABLE_WORKSPACE_DATA
    else process.env.DURABLE_WORKSPACE_DATA = previousDataDir
    await rm(workspace, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  }
})
