import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Host } from '../server/host.ts'
import { WorkspaceManager } from '../server/workspaces.ts'

interface FakeHost {
  path: string
  closed: boolean
  closeError?: Error
  close(): Promise<void>
}

function fakeOpener(events: string[], failPath?: string) {
  const hosts: FakeHost[] = []
  const open = async (path: string): Promise<Host> => {
    if (path === failPath) throw new Error('cannot open workspace')
    events.push(`open:${path}`)
    const host: FakeHost = {
      path,
      closed: false,
      close: async () => {
        if (host.closeError) throw host.closeError
        host.closed = true
        events.push(`close:${path}`)
      },
    }
    hosts.push(host)
    return host as unknown as Host
  }
  return { hosts, open }
}

test('workspace add and select replace the host and persist state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-workspaces-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  const stateFile = join(root, 'state', 'workspaces.json')
  await mkdir(first)
  await mkdir(second)
  const events: string[] = []
  const { hosts, open } = fakeOpener(events)
  const manager = await WorkspaceManager.open(first, open, stateFile)
  try {
    await manager.select(second)
    assert.equal(manager.host, hosts[1] as unknown as Host)
    assert.equal(hosts[0].closed, true)
    assert.deepEqual(events, [`open:${first}`, `open:${second}`, `close:${first}`])

    await manager.select(first)
    assert.deepEqual(manager.state, {
      items: [{ path: first, name: 'first' }, { path: second, name: 'second' }],
      current: first,
    })
    assert.deepEqual(events, [
      `open:${first}`,
      `open:${second}`,
      `close:${first}`,
      `open:${first}`,
      `close:${second}`,
    ])
    const saved = JSON.parse(await readFile(stateFile, 'utf8')) as unknown
    assert.deepEqual(saved, manager.state)
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace selection deduplicates paths and does not reopen the current host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-workspaces-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  await mkdir(first)
  await mkdir(second)
  const { hosts, open } = fakeOpener([])
  const manager = await WorkspaceManager.open(first, open, join(root, 'workspaces.json'))
  try {
    await manager.select(first)
    await manager.select(second)
    await manager.select(second)
    assert.equal(hosts.length, 2)
    assert.equal(manager.state.items.length, 2)
    assert.equal(new Set(manager.state.items.map(value => value.path)).size, 2)
    assert.equal(hosts[0].closed, true)
    assert.equal(hosts[1].closed, false)
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('failed workspace add leaves the current host active', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-workspaces-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  await mkdir(first)
  await mkdir(second)
  const { hosts, open } = fakeOpener([], second)
  const manager = await WorkspaceManager.open(first, open, join(root, 'workspaces.json'))
  try {
    const initial = manager.state
    await assert.rejects(manager.select('relative/path'), /must be absolute/)
    await assert.rejects(manager.select(second), /cannot open workspace/)
    assert.equal(manager.host, hosts[0] as unknown as Host)
    assert.equal(hosts[0].closed, false)
    assert.deepEqual(manager.state, initial)
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace restart reopens only the current path without changing persisted state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-workspaces-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  const stateFile = join(root, 'state', 'workspaces.json')
  await mkdir(first)
  await mkdir(second)
  const events: string[] = []
  const { hosts, open } = fakeOpener(events)
  const manager = await WorkspaceManager.open(first, open, stateFile)
  try {
    await manager.select(second)
    const before = manager.state
    const saved = await readFile(stateFile, 'utf8')
    await manager.restart()
    assert.equal(manager.host, hosts[2] as unknown as Host)
    assert.equal(hosts[1].closed, true)
    assert.deepEqual(manager.state, before)
    assert.equal(await readFile(stateFile, 'utf8'), saved)
    assert.deepEqual(events, [
      `open:${first}`,
      `open:${second}`,
      `close:${first}`,
      `close:${second}`,
      `open:${second}`,
    ])
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('failed workspace restart closes the old host and preserves workspace state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-workspaces-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const { hosts, open } = fakeOpener([])
  let fail = false
  const manager = await WorkspaceManager.open(workspace, async path => {
    if (fail) throw new Error('restart failed')
    return open(path)
  }, join(root, 'workspaces.json'))
  try {
    const before = manager.state
    fail = true
    await assert.rejects(manager.restart(), /restart failed/)
    assert.throws(() => manager.host, /Host is not available/)
    assert.equal(hosts[0].closed, true)
    assert.deepEqual(manager.state, before)
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace restart restores the old host if closing it fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-workspaces-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const { hosts, open } = fakeOpener([])
  const manager = await WorkspaceManager.open(workspace, open, join(root, 'workspaces.json'))
  try {
    const before = manager.state
    hosts[0].closeError = new Error('close failed')
    await assert.rejects(manager.restart(), /close failed/)
    assert.equal(manager.host, hosts[0] as unknown as Host)
    assert.equal(hosts.length, 1)
    assert.deepEqual(manager.state, before)
    hosts[0].closeError = undefined
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('removing a non-current workspace only drops its list entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-workspaces-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  const stateFile = join(root, 'state', 'workspaces.json')
  await mkdir(first)
  await mkdir(second)
  const events: string[] = []
  const { hosts, open } = fakeOpener(events)
  const manager = await WorkspaceManager.open(first, open, stateFile)
  try {
    await manager.select(second)
    const state = await manager.remove(first)
    assert.deepEqual(state, { items: [{ path: second, name: 'second' }], current: second })
    assert.equal(manager.host, hosts[1] as unknown as Host)
    assert.equal(await readFile(stateFile, 'utf8'), JSON.stringify(state))
    assert.deepEqual(events, [`open:${first}`, `open:${second}`, `close:${first}`])
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('removing the current workspace switches the host to the next one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-workspaces-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  await mkdir(first)
  await mkdir(second)
  const events: string[] = []
  const { hosts, open } = fakeOpener(events)
  const manager = await WorkspaceManager.open(first, open, join(root, 'workspaces.json'))
  try {
    await manager.select(second)
    const state = await manager.remove(second)
    assert.deepEqual(state, { items: [{ path: first, name: 'first' }], current: first })
    assert.equal(manager.host, hosts[2] as unknown as Host)
    assert.equal(hosts[1].closed, true)
    assert.deepEqual(events, [`open:${first}`, `open:${second}`, `close:${first}`, `open:${first}`, `close:${second}`])
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace removal refuses the last workspace and unknown paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-workspaces-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const { open } = fakeOpener([])
  const manager = await WorkspaceManager.open(workspace, open, join(root, 'workspaces.json'))
  try {
    await assert.rejects(manager.remove(workspace), /至少保留一个工作区/)
    await assert.rejects(manager.remove(join(root, 'missing')), /Workspace not found/)
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})
