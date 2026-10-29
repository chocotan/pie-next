export type AgentStatus = 'generating' | 'tool' | 'approval' | 'idle' | 'waiting' | 'error' | 'stopped'
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface Conversation {
  id: number
  name: string
  role: string
  status: AgentStatus
  model: string
  modelProvider?: string
  thinkingLevel?: ThinkingLevel
  parentId?: number
  kind: 'root' | 'subagent' | 'fork'
  turns?: number
  lastActive: string
  summary: string
}

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  description?: string
  activeForm?: string
  agentType?: string
  owner?: string
  metadata?: Record<string, string>
  blockedBy?: string[]
  assignedConversationId?: number
}

export interface QueuedMessage {
  id: string
  content: string
  mode: 'steer' | 'followUp'
}

export interface BackgroundTask {
  id: string
  command: string
  title?: string
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted'
  pid?: number
  output: string
  createdAt: number
  endedAt?: number
  exitCode?: number
}

export interface ToolCall {
  id: string
  taskId?: number
  name: string
  summary: string
  status: 'done' | 'running' | 'approval' | 'error'
  args: string
  result?: string
  duration: string
  details?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  error?: string
  toolCalls?: ToolCall[]
}

export type BuiltinPluginId = 'todo' | 'subagent' | 'background' | 'compaction' | 'context'
export interface PluginInfo {
  id: BuiltinPluginId
  name: string
  description: string
  tools: string[]
  enabled: boolean
}

export interface RuntimeSettings {
  retry: { enabled: boolean; maxRetries: number; baseDelayMs: number; maxAgentDelayMs: number }
  compaction: { enabled: boolean }
  compactModel?: { provider: string; modelId: string }
}

export interface ProviderProfile {
  id: string
  name: string
  protocol: string
  baseUrl: string
  models: string
  enabled: boolean
  hasKey: boolean
}
