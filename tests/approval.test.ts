import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable'
import { createModels } from '@earendil-works/pi-ai/models'
import { ApprovalDoc, interruptPendingApprovals, reconcileApprovals } from '../server/plugins/approval.ts'

const context = BACKGROUND_CONTEXT

test('interrupted tools cannot leave an actionable approval behind', async () => {
  const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry: createRegistry() }, context)
  const root = await harness.root(context)
  await root.commit(async tx => {
    const doc = await tx.doc(ApprovalDoc, root.id)
    doc.requests['41'] = { taskId: 41, callId: 'call-1', toolName: 'bash', arguments: { command: 'rm -rf /tmp/test' }, status: 'pending', createdAt: Date.now() }
  }, context)
  await interruptPendingApprovals(harness, root.id)
  assert.equal((await harness.snapshot(ApprovalDoc, root.id, context))?.requests['41']?.status, 'interrupted')
  await reconcileApprovals(harness)
  await harness.close(context)
})
