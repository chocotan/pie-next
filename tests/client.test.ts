import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entriesToMessages, queuedMessages } from '../src/modules/session/client.ts'

test('assistant model errors remain visible in chat messages', () => {
  const messages = entriesToMessages({
    entries: [{ id: 1, model: [{ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'provider unavailable', timestamp: 1 }] }],
    docs: {},
  } as never, {})
  assert.equal(messages[0].error, 'provider unavailable')
})

test('durable inbox maps queued user messages in order', () => {
  const queue = queuedMessages({ docs: { 'pi.inbox': { items: [
    { id: 1, mode: 'followUp', content: 'first' },
    { id: 2, mode: 'write', entry: {} },
    { id: 3, mode: 'steer', content: [{ type: 'text', text: 'second' }] },
  ] } } } as never)
  assert.deepEqual(queue, [{ id: '1', mode: 'followUp', content: 'first' }, { id: '3', mode: 'steer', content: 'second' }])
})
