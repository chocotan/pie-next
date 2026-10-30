import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatToolBody } from '../src/modules/chat/tool-body.ts'

test('DSH tool body formats generic JSON and code payloads', () => {
  assert.equal(formatToolBody('others', '{"command":"echo ok"}'), '{\n  "command": "echo ok"\n}')
  assert.equal(formatToolBody('code', '{"code":"return 1"}'), 'return 1')
  assert.equal(formatToolBody('bash', 'partial json'), 'partial json')
})
