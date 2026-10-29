import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { openHost, type Host } from './host.ts'

export interface WorkspaceItem {
  path: string
  name: string
}

export interface WorkspacesDto {
  items: WorkspaceItem[]
  current: string
}

type HostOpener = (workspace: string) => Promise<Host>

const item = (path: string): WorkspaceItem => ({ path, name: basename(path) || path })

export class WorkspaceManager {
  static async open(
    workspace: string,
    opener: HostOpener = openHost,
    stateFile = process.env.DURABLE_WORKSPACES_FILE ?? resolve(homedir(), '.durable-workbench', 'workspaces.json'),
  ): Promise<WorkspaceManager> {
    const initial = resolve(workspace)
    let items = [item(initial)]
    let current = initial
    try {
      const saved = JSON.parse(await readFile(stateFile, 'utf8')) as { items?: Array<{ path?: unknown }>; current?: unknown }
      const paths = saved.items?.flatMap(value => typeof value?.path === 'string' && isAbsolute(value.path) ? [resolve(value.path)] : []) ?? []
      items = [...new Set([...paths, initial])].map(item)
      if (typeof saved.current === 'string' && isAbsolute(saved.current)) {
        const savedCurrent = resolve(saved.current)
        if (items.some(value => value.path === savedCurrent)) current = savedCurrent
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }

    const host = await opener(current)
    const manager = new WorkspaceManager(host, items, current, opener, stateFile)
    try {
      await manager.persist()
      return manager
    } catch (cause) {
      await host.close().catch(() => {})
      throw cause
    }
  }

  private constructor(
    private currentHost: Host | undefined,
    private items: WorkspaceItem[],
    private currentPath: string,
    private readonly opener: HostOpener,
    private readonly stateFile: string,
  ) {}

  get host(): Host {
    if (!this.currentHost) throw new Error('Host is not available')
    return this.currentHost
  }

  get state(): WorkspacesDto {
    return { items: this.items.map(value => ({ ...value })), current: this.currentPath }
  }

  async select(path: string): Promise<WorkspacesDto> {
    if (!isAbsolute(path)) throw new Error('Workspace path must be absolute')
    const normalized = resolve(path)
    const info = await stat(normalized)
    if (!info.isDirectory()) throw new Error('Workspace path must be a directory')
    if (normalized === this.currentPath) return this.state

    const nextHost = await this.opener(normalized)
    const nextItems = this.items.some(value => value.path === normalized) ? this.items : [...this.items, item(normalized)]
    try {
      await this.persist(nextItems, normalized)
    } catch (cause) {
      await nextHost.close().catch(() => {})
      throw cause
    }

    const previousHost = this.currentHost
    this.currentHost = nextHost
    this.items = nextItems
    this.currentPath = normalized
    await previousHost?.close()
    return this.state
  }

  async restart(): Promise<void> {    const previousHost = this.currentHost
    this.currentHost = undefined
    try {
      await previousHost?.close()
    } catch (cause) {
      this.currentHost = previousHost
      throw cause
    }
    // A workspace process lock and SQLite storage cannot be opened twice.
    this.currentHost = await this.opener(this.currentPath)
  }

  /** Remove a workspace from the list; the directory and its data on disk are untouched. */
  async remove(path: string): Promise<WorkspacesDto> {
    const normalized = resolve(path)
    if (!this.items.some(value => value.path === normalized)) throw new Error('Workspace not found')
    if (this.items.length <= 1) throw new Error('至少保留一个工作区')
    const nextItems = this.items.filter(value => value.path !== normalized)
    if (normalized !== this.currentPath) {
      await this.persist(nextItems, this.currentPath)
      this.items = nextItems
      return this.state
    }
    const nextCurrent = nextItems[0]!.path
    const nextHost = await this.opener(nextCurrent)
    try {
      await this.persist(nextItems, nextCurrent)
    } catch (cause) {
      await nextHost.close().catch(() => {})
      throw cause
    }
    const previousHost = this.currentHost
    this.currentHost = nextHost
    this.items = nextItems
    this.currentPath = nextCurrent
    await previousHost?.close()
    return this.state
  }

  async close(): Promise<void> {
    await this.currentHost?.close()
    this.currentHost = undefined
  }

  private async persist(items = this.items, current = this.currentPath): Promise<void> {
    await mkdir(dirname(this.stateFile), { recursive: true, mode: 0o700 })
    const temporary = `${this.stateFile}.tmp`
    await writeFile(temporary, JSON.stringify({ items, current }), { mode: 0o600 })
    await rename(temporary, this.stateFile)
  }
}
