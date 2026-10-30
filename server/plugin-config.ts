import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type BuiltinPluginId = 'todo' | 'subagent' | 'background' | 'compaction' | 'context' | 'session-title'

export interface BuiltinPluginItem {
  id: BuiltinPluginId
  name: string
  description: string
  tools: string[]
  enabled: boolean
}

const ids: BuiltinPluginId[] = ['todo', 'subagent', 'background', 'compaction', 'context', 'session-title']
const metadata: Record<BuiltinPluginId, Omit<BuiltinPluginItem, 'id' | 'enabled'>> = {
  todo: {
    name: '任务管理',
    description: '为 AI 提供任务创建、查询、状态与依赖管理',
    tools: ['TaskCreate', 'TaskList', 'TaskGet', 'TaskUpdate'],
  },
  subagent: {
    name: '子代理',
    description: '派发持久化子代理，并自动回流执行结果',
    tools: ['subagent'],
  },
  background: {
    name: '后台 Shell',
    description: '启动、检查、读取日志并停止后台 Shell 进程',
    tools: ['bg_run', 'bg_status', 'bg_logs', 'bg_kill'],
  },
  compaction: {
    name: '自动 Compact',
    description: '按阈值或上下文溢出自动压缩，可选择专用模型',
    tools: [],
  },
  'session-title': {
    name: '自动会话标题',
    description: '首条用户消息生成回退标题，并异步调用同一路由模型总结标题',
    tools: ['session-title.rename', 'session-title.refresh'],
  },
  context: {
    name: '上下文与 Skills',
    description: '读取全局/项目 AGENTS.md，并向模型提供 skills 目录以便按需加载',
    tools: ['AGENTS.md', 'skills/*/SKILL.md'],
  },
}
const defaults = (): Record<BuiltinPluginId, boolean> => ({ todo: true, subagent: true, background: true, compaction: true, context: true, 'session-title': true })
const isBuiltinPluginId = (id: string): id is BuiltinPluginId => ids.includes(id as BuiltinPluginId)

function parseState(value: unknown): Record<BuiltinPluginId, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid plugin configuration')
  const stored = value as Record<string, unknown>
  for (const id of Object.keys(stored)) {
    if (!isBuiltinPluginId(id)) throw new Error(`Unknown plugin: ${id}`)
  }
  const state = defaults()
  for (const id of ids) {
    if (stored[id] === undefined) continue
    if (typeof stored[id] !== 'boolean') throw new Error('Invalid plugin configuration')
    state[id] = stored[id]
  }
  return state
}

export class PluginConfigStore {
  private writeQueue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly dataDir: string,
    private enabled: Record<BuiltinPluginId, boolean>,
  ) {}

  static async open(dataDir: string): Promise<PluginConfigStore> {
    const file = join(dataDir, 'plugins.json')
    try {
      const state = parseState(JSON.parse(await readFile(file, 'utf8')))
      await chmod(file, 0o600)
      return new PluginConfigStore(dataDir, state)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      const store = new PluginConfigStore(dataDir, defaults())
      await store.persist(store.enabled)
      return store
    }
  }

  get state(): Record<BuiltinPluginId, boolean> {
    return { ...this.enabled }
  }

  get items(): BuiltinPluginItem[] {
    return ids.map(id => ({ id, ...metadata[id], tools: [...metadata[id].tools], enabled: this.enabled[id] }))
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!isBuiltinPluginId(id)) return Promise.reject(new Error(`Unknown plugin: ${id}`))
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('Plugin enabled state must be boolean'))
    const operation = this.writeQueue.then(async () => {
      const next = { ...this.enabled, [id]: enabled }
      await this.persist(next)
      this.enabled = next
    })
    this.writeQueue = operation.catch(() => {})
    return operation
  }

  private async persist(state: Record<BuiltinPluginId, boolean>): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 })
    const file = join(this.dataDir, 'plugins.json')
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, file)
      await chmod(file, 0o600)
    } catch (cause) {
      await unlink(temporary).catch(() => {})
      throw cause
    }
  }
}
