import { applyImmutable } from '@earendil-works/chord/delta'
import type { ConversationRecord, ConversationView, EntryRecord, JsonObject } from '@earendil-works/pi-durable'
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai'
import type { BackgroundTask, BuiltinPluginId, ChatMessage, Conversation, PluginInfo, ProviderProfile, QueuedMessage, RuntimeSettings, ThinkingLevel, TodoItem, ToolCall } from './types.ts'

export interface WorkbenchSnapshot {
  status: 'loading' | 'ready' | 'error'
  error?: string
  providers: ProviderProfile[]
  models: Array<{ provider: string; modelId: string }>
  workspaces: Array<{ path: string; name: string }>
  currentWorkspace: string
  agents: Conversation[]
  selectedId: number
  messages: Record<number, ChatMessage[]>
  entries: Record<number, EntryRecord[]>
  todos: TodoItem[]
  queued: QueuedMessage[]
  background: Record<string, BackgroundTask>
  permission: 'allow-all' | 'approve'
  plugins: PluginInfo[]
  runtime: RuntimeSettings
}

const emptySnapshot = (): WorkbenchSnapshot => ({ status: 'loading', providers: [], models: [], workspaces: [], currentWorkspace: '', agents: [], selectedId: 1, messages: {}, entries: {}, todos: [], queued: [], background: {}, permission: 'allow-all', plugins: [], runtime: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 60_000 }, compaction: { enabled: true } } })

export class WorkbenchClient {
  private snapshot: WorkbenchSnapshot = emptySnapshot()
  private listeners = new Set<() => void>()
  private socket?: WebSocket
  private subscriptions = new Map<string, unknown>()
  private conversationViews = new Map<number, ConversationView>()
  private approvals = new Map<number, Record<string, { status: string }>>()
  private subagentNames = new Map<number, string>()
  private sessionTitles = new Map<number, string>()
  private closed = true
  private generation = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  readonly getSnapshot = (): WorkbenchSnapshot => this.snapshot

  async open(): Promise<void> {
    const generation = ++this.generation
    this.closed = false
    try {
      const hash = new URLSearchParams(location.hash.slice(1))
      const token = hash.get('token') ?? sessionStorage.getItem('dw-access-token')
      if (token) {
        const response = await fetch('/api/auth', { method: 'POST', headers: { 'x-workbench-token': token } })
        if (!response.ok) throw new Error('访问令牌无效，请使用 Host 输出的完整 URL。')
        sessionStorage.removeItem('dw-access-token')
        history.replaceState(null, '', location.pathname)
      }
      const [workspace, pluginConfig, runtime] = await Promise.all([this.workspaceRequest(), this.pluginRequest(), this.runtimeRequest()])
      const providers = await this.command<{ items: ProviderProfile[]; models: Array<{ provider: string; modelId: string }> }>('provider.list', {})
      let conversations = await this.command<{ items: ConversationRecord[] }>('session.list', {})
      if (conversations.items.length === 0) {
        await this.command('session.create', {})
        conversations = await this.command<{ items: ConversationRecord[] }>('session.list', {})
      }
      const agents = conversations.items.map(recordToAgent)
      this.patch({ providers: providers.items, models: providers.models, workspaces: workspace.items, currentWorkspace: workspace.current, plugins: pluginConfig.items, runtime, agents, selectedId: agents[0]?.id ?? 1 })
      if (generation !== this.generation) return
      this.connect(generation)
      this.patch({ status: 'ready' })
    } catch (cause) {
      if (generation === this.generation) this.patch({ status: 'error', error: cause instanceof Error ? cause.message : 'Host 连接失败' })
    }
  }

  close(): void {
    this.closed = true
    this.generation += 1
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.socket?.close()
    this.socket = undefined
  }

  async addWorkspace(path: string): Promise<void> {
    await this.workspaceRequest(path)
    await this.reload()
  }
  async selectWorkspace(path: string): Promise<void> {
    await this.workspaceRequest(path)
    await this.reload()
  }
  async configurePlugin(id: BuiltinPluginId, enabled: boolean): Promise<void> {
    await this.pluginRequest(id, enabled)
    await this.reload()
  }
  async saveRuntime(settings: RuntimeSettings): Promise<void> {
    await this.runtimeRequest(settings)
    await this.reload()
  }
  async compactCurrent(): Promise<void> {
    await this.command('session.compact', { conversationId: this.snapshot.selectedId })
  }
  private async reload(): Promise<void> {
    this.close()
    this.subscriptions.clear()
    this.conversationViews.clear()
    this.approvals.clear()
    this.subagentNames.clear()
    this.sessionTitles.clear()
    this.snapshot = emptySnapshot()
    await this.open()
  }
  private async pluginRequest(id?: BuiltinPluginId, enabled?: boolean): Promise<{ items: PluginInfo[] }> {
    const response = await fetch('/api/plugins', { method: id === undefined ? 'GET' : 'POST', ...(id === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, enabled }) }) })
    const payload = await response.json() as { items?: PluginInfo[]; error?: { message?: string } }
    if (!response.ok) throw new Error(payload.error?.message ?? '插件配置失败')
    return { items: payload.items ?? [] }
  }
  private async runtimeRequest(settings?: RuntimeSettings): Promise<RuntimeSettings> {
    const response = await fetch('/api/runtime', { method: settings === undefined ? 'GET' : 'POST', ...(settings === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) }) })
    const payload = await response.json() as RuntimeSettings & { error?: { message?: string } }
    if (!response.ok) throw new Error(payload.error?.message ?? '运行策略保存失败')
    return payload
  }
  private async workspaceRequest(path?: string): Promise<{ items: Array<{ path: string; name: string }>; current: string }> {
    const response = await fetch('/api/workspaces', { method: path === undefined ? 'GET' : 'POST', ...(path === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }) })
    const payload = await response.json() as { items?: Array<{ path: string; name: string }>; current?: string; error?: { message?: string } }
    if (!response.ok) throw new Error(payload.error?.message ?? '工作区操作失败')
    return { items: payload.items ?? [], current: payload.current ?? '' }
  }

  async removeWorkspace(path: string): Promise<void> {
    const response = await fetch('/api/workspaces', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) })
    const payload = await response.json() as { error?: { message?: string } }
    if (!response.ok) throw new Error(payload.error?.message ?? '删除工作区失败')
    await this.reload()
  }
  async deleteConversation(id: number): Promise<void> {
    await this.command('session.delete', { conversationId: id })
    this.conversationViews.delete(id)
    this.sessionTitles.delete(id)
    this.approvals.delete(id)
    await this.refreshConversations()
    if (this.snapshot.selectedId !== id) return
    const next = this.snapshot.agents.find(agent => !agent.parentId)
    if (next) await this.selectConversation(next.id)
    else await this.createConversation()
  }
  async createConversation(): Promise<void> {
    const result = await this.command<{ conversationId: number }>('session.create', {})
    await this.refreshConversations()
    await this.selectConversation(result.conversationId)
  }
  async send(content: string): Promise<void> {
    await this.command('session.input', { conversationId: this.snapshot.selectedId, requestId: crypto.randomUUID(), content, whenBusy: 'followUp' })
  }
  async stop(): Promise<void> { await this.command('session.abort', { conversationId: this.snapshot.selectedId, background: false }) }
  async setModel(model: { provider: string; modelId: string }): Promise<void> {
    await this.command('session.configure', { conversationId: this.snapshot.selectedId, model })
  }
  async setThinkingLevel(thinkingLevel?: ThinkingLevel): Promise<void> {
    await this.command('session.configure', { conversationId: this.snapshot.selectedId, thinkingLevel: thinkingLevel ?? null })
  }
  async setPermission(mode: 'allow-all' | 'approve'): Promise<void> {
    await this.command('approval.mode', { conversationId: this.snapshot.selectedId, mode })
  }
  async startBackground(command: string, title?: string): Promise<void> {
    await this.command('background.start', { conversationId: this.snapshot.selectedId, command, ...(title?.trim() ? { title: title.trim() } : {}) })
  }
  async stopBackground(taskId: string): Promise<void> {
    await this.command('background.stop', { conversationId: this.snapshot.selectedId, taskId })
  }
  async syncProviderModels(profile: ProviderProfile, apiKey?: string): Promise<string[]> {
    const result = await this.command<{ models: string[] }>('provider.sync-models', { profile, ...(apiKey ? { apiKey } : {}) })
    return result.models
  }
  async selectConversation(id: number): Promise<void> {
    this.unsubscribeDocuments()
    this.patch({ selectedId: id, todos: [], queued: [], background: {}, permission: 'allow-all' })
    this.subscribeConversation(id)
    this.subscribeDocument(id)
  }
  async saveProvider(profile: ProviderProfile, apiKey?: string): Promise<void> {
    await this.command('provider.save', { profile, ...(apiKey ? { apiKey } : {}) })
    await this.refreshProviders()
  }
  async setProviderEnabled(id: string, enabled: boolean): Promise<void> {
    await this.command('provider.enabled', { id, enabled })
    await this.refreshProviders()
  }
  async decide(id: string | number, approved: boolean): Promise<void> {
    await this.command('approval.decide', { conversationId: this.snapshot.selectedId, taskId: Number(id), decision: approved ? 'approved' : 'denied' })
  }

  private async refreshConversations(): Promise<void> {
    const conversations = await this.command<{ items: ConversationRecord[] }>('session.list', {})
    this.patch({ agents: conversations.items.map(record => {
      const agent = recordToAgent(record)
      const view = this.conversationViews.get(agent.id)
      const name = this.subagentNames.get(agent.id) ?? this.sessionTitles.get(agent.id)
      return { ...agent, ...(view ? { model: modelName(view), modelProvider: modelProvider(view), thinkingLevel: thinkingLevel(view) } : {}), ...(name ? { name, summary: name } : {}) }
    }) })
  }

  private async refreshProviders(): Promise<void> {
    const providers = await this.command<{ items: ProviderProfile[]; models: Array<{ provider: string; modelId: string }> }>('provider.list', {})
    this.patch({ providers: providers.items, models: providers.models })
  }

  private connect(generation: number): void {
    if (this.closed || generation !== this.generation) return
    this.socket?.close()
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocol}://${location.host}/ws`)
    this.socket = socket
    socket.onopen = () => {
      if (generation !== this.generation) return
      this.subscribeConversation(this.snapshot.selectedId)
      this.subscribeDocument(this.snapshot.selectedId)
      this.sendSubscription('tasks', 'tasks', this.snapshot.selectedId)
    }
    socket.onmessage = event => {
      if (this.closed || generation !== this.generation || this.socket !== socket) return
      const frame = JSON.parse(String(event.data)) as { type: string; id: string; value?: unknown; ops?: Parameters<typeof applyImmutable>[1] }
      if (frame.type === 'snapshot') {
        this.subscriptions.set(frame.id, frame.value)
        this.applySnapshot(frame.id, frame.value)
      } else if (frame.type === 'delta') {
        const next = applyImmutable(this.subscriptions.get(frame.id), frame.ops ?? [])
        this.subscriptions.set(frame.id, next)
        this.applySnapshot(frame.id, next)
      }
    }
    socket.onclose = () => {
      if (this.closed || generation !== this.generation) return
      this.reconnectTimer = setTimeout(() => this.connect(this.generation), 1500)
    }
  }

  private unsubscribeDocuments(): void {
    for (const id of this.subscriptions.keys()) {
      if (id.startsWith('document:') || id.startsWith('conversation:')) {
        this.socket?.send(JSON.stringify({ type: 'unsubscribe', id }))
        this.subscriptions.delete(id)
      }
    }
  }

  private subscribeConversation(id: number): void { this.sendSubscription(`conversation:${id}`, 'conversation', id) }
  private subscribeDocument(id: number): void {
    const enabled = (plugin: BuiltinPluginId): boolean => this.snapshot.plugins.find(item => item.id === plugin)?.enabled ?? true
    if (enabled('todo')) this.sendSubscription(`document:todos:${id}`, 'document', id, 'todos')
    this.sendSubscription(`document:approvals:${id}`, 'document', id, 'approvals')
    if (enabled('subagent')) this.sendSubscription(`document:subagents:${id}`, 'document', id, 'subagents')
    if (enabled('background')) this.sendSubscription(`document:background:${id}`, 'document', id, 'background')
  }
  private sendSubscription(id: string, channel: string, conversationId: number, document?: string): void {
    this.socket?.send(JSON.stringify({ type: 'subscribe', id, channel, conversationId, document }))
  }

  private applySnapshot(id: string, value: unknown): void {
    if (id.startsWith('conversation:')) {
      const conversationId = Number(id.split(':')[1])
      const view = value as ConversationView
      this.conversationViews.set(conversationId, view)
      const messages = entriesToMessages(view, this.approvals.get(conversationId) ?? {})
      this.patch({ messages: { ...this.snapshot.messages, [conversationId]: messages }, entries: { ...this.snapshot.entries, [conversationId]: [...view.entries] } })
      if (conversationId === this.snapshot.selectedId) this.patch({ queued: queuedMessages(view) })
      const title = sessionTitle(view)
      if (title) this.sessionTitles.set(conversationId, title)
      this.patch({ agents: this.snapshot.agents.map(agent => agent.id === conversationId ? { ...agent, status: liveStatus(view.docs['pi.live']), model: modelName(view), modelProvider: modelProvider(view), thinkingLevel: thinkingLevel(view), ...(title && !agent.parentId ? { name: title, summary: title } : {}) } : agent) })
    } else if (id.startsWith('document:todos:')) {
      const conversationId = Number(id.split(':')[2])
      if (conversationId !== this.snapshot.selectedId) return
      const todos = value as { items?: TodoItem[] } | null
      this.patch({ todos: todos?.items ?? [] })
    } else if (id.startsWith('document:approvals:')) {
      const conversationId = Number(id.split(':')[2])
      if (conversationId !== this.snapshot.selectedId) return
      const state = value as { requests?: Record<string, { status: string }>; mode?: 'allow-all' | 'approve' } | null
      this.approvals.set(conversationId, state?.requests ?? {})
      this.patch({ permission: state?.mode ?? 'allow-all' })
      const view = this.conversationViews.get(conversationId)
      if (view) this.patch({ messages: { ...this.snapshot.messages, [conversationId]: entriesToMessages(view, this.approvals.get(conversationId) ?? {}) } })
    } else if (id.startsWith('document:background:')) {
      const conversationId = Number(id.split(':')[2])
      if (conversationId !== this.snapshot.selectedId) return
      const state = value as { tasks?: Record<string, BackgroundTask> } | null
      this.patch({ background: state?.tasks ?? {} })
    } else if (id.startsWith('document:subagents:')) {
      const conversationId = Number(id.split(':')[2])
      if (conversationId !== this.snapshot.selectedId) return
      const state = value as { agents?: Record<string, { conversationId: number; turns?: number }> } | null
      if (state?.agents) {
        const names = new Map(Object.entries(state.agents).map(([name, child]) => [child.conversationId, name]))
        const turns = new Map(Object.values(state.agents).map(child => [child.conversationId, child.turns ?? 0]))
        this.subagentNames = new Map([...this.subagentNames, ...names])
        this.patch({ agents: this.snapshot.agents.map(agent => names.has(agent.id) ? { ...agent, name: names.get(agent.id) ?? agent.name, turns: turns.get(agent.id) ?? 0 } : agent) })
        void this.refreshConversations()
      }
    }
  }

  private patch(value: Partial<WorkbenchSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...value }
    for (const listener of this.listeners) listener()
  }

  private async command<T>(name: string, args: unknown): Promise<T> {
    const response = await fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, args }) })
    const payload = await response.json() as { result?: T; error?: { message?: string } }
    if (!response.ok) throw new Error(payload.error?.message ?? '命令执行失败')
    return payload.result as T
  }
}

function recordToAgent(record: ConversationRecord): Conversation {
  const id = Number(record.id)
  return { id, name: record.owner ? `Agent ${id}` : `会话 ${id}`, role: record.owner ? '子智能体' : '独立会话', status: 'idle', model: '未配置模型', kind: record.parent ? 'fork' : record.owner ? 'subagent' : 'root', parentId: record.owner?.conversationId, lastActive: '—', summary: `Durable Conversation ${id}` }
}

export function queuedMessages(view: ConversationView): QueuedMessage[] {
  const items = (view.docs['pi.inbox']?.items as Array<{ id: string | number; mode: string; content?: string | readonly unknown[] }> | undefined) ?? []
  return items.flatMap(item => item.mode === 'followUp' || item.mode === 'steer' ? [{ id: String(item.id), mode: item.mode, content: textContent(item.content ?? '') }] : [])
}

function modelName(view: ConversationView): string {
  const model = view.docs['pi.agent']?.model as { modelId?: string } | undefined
  return model?.modelId ?? '未配置模型'
}

function thinkingLevel(view: ConversationView): ThinkingLevel | undefined {
  return view.docs['pi.agent']?.thinkingLevel as ThinkingLevel | undefined
}

function modelProvider(view: ConversationView): string | undefined {
  const model = view.docs['pi.agent']?.model as { provider?: string } | undefined
  return model?.provider
}

function liveStatus(live: JsonObject | undefined): Conversation['status'] {
  if (!live) return 'idle'
  if (live.runFailure) return 'error'
  if (live.generation) return 'generating'
  if (Array.isArray(live.tools) && live.tools.length > 0) return 'tool'
  if (live.run) return 'waiting'
  return 'idle'
}

function sessionTitle(view: ConversationView): string | undefined {
  for (const entry of view.entries) {
    const message = entry.model?.[0]
    if (message?.role !== 'user') continue
    const title = textContent(message.content).trim()
    if (title) return title.length > 60 ? `${title.slice(0, 60)}…` : title
  }
  return undefined
}

export function entriesToMessages(view: ConversationView, approvals: Record<string, { status: string }>): ChatMessage[] {
  const entries = view.entries
  const liveTools = new Map<string, { taskId?: number; status: string; output?: string; details?: unknown }>((view.docs['pi.live']?.tools as Array<{ callId: string; taskId?: number; status: string; output?: string; details?: unknown }> | undefined)?.map(tool => [tool.callId, tool]) ?? [])
  const messages: ChatMessage[] = []
  const results = new Map<string, ToolResultMessage>()
  for (const entry of entries) {
    const message = entry.model?.[0]
    if (message?.role === 'toolResult') results.set(message.toolCallId, message)
  }
  for (const entry of entries) {
    const message = entry.model?.[0]
    if (!message) continue
    if (message.role === 'user') {
      messages.push({ id: String(entry.id), role: 'user', content: textContent(message.content), createdAt: time(message.timestamp) })
    } else if (message.role === 'assistant') {
      const assistant = message as AssistantMessage
      messages.push({ id: String(entry.id), role: 'assistant', content: assistant.content.filter(part => part.type === 'text').map(part => part.text).join(''), createdAt: time(assistant.timestamp), error: assistant.stopReason === 'error' ? assistant.errorMessage ?? '模型请求失败' : undefined, toolCalls: assistant.content.flatMap(part => {
        if (part.type !== 'toolCall') return []
        const result = results.get(part.id)
        const live = liveTools.get(part.id)
        const approval = live?.taskId === undefined ? undefined : approvals[String(live.taskId)]
        const status: ToolCall['status'] = approval?.status === 'pending' && live?.status === 'running' ? 'approval' : result ? (result.isError ? 'error' : 'done') : live?.status === 'done' ? 'done' : 'running'
        return [{ id: part.id, taskId: live?.taskId, name: part.name, summary: approval?.status === 'pending' ? '等待批准：执行操作' : toolSummary(part.name), status, args: JSON.stringify(part.arguments, null, 2), result: result ? textContent(result.content) : live?.output, duration: result?.durationMs ? `${result.durationMs} ms` : '执行中', details: approval ? `审批状态：${approval.status}` : undefined }]
      }) })
    }
  }
  const generation = view.docs['pi.live']?.generation as { message?: AssistantMessage } | undefined
  const partial = generation?.message
  if (partial) messages.push({ id: `live-${view.conversation.id}`, role: 'assistant', content: partial.content.filter(part => part.type === 'text').map(part => part.text).join(''), createdAt: time(partial.timestamp) })
  return messages
}

function textContent(content: string | readonly unknown[]): string {
  if (typeof content === 'string') return content
  return content.map(part => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text?: unknown }).text ?? '') : '').join('')
}

function toolSummary(name: string): string {
  return ({ todo_write: '更新任务计划', todo_read: '读取任务计划', TaskCreate: '创建任务', TaskList: '读取任务列表', TaskGet: '读取任务详情', TaskUpdate: '更新任务', bg_run: '启动后台 Shell', bg_status: '查看后台任务', bg_logs: '读取后台日志', bg_kill: '停止后台 Shell', read: '读取工作区文件', write: '写入工作区文件', edit: '编辑工作区文件', bash: '执行工作区命令' } as Record<string, string>)[name] ?? `调用 ${name}`
}

function time(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
