export type AgentStatus = 'generating' | 'tool' | 'approval' | 'idle' | 'waiting' | 'error' | 'stopped'
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface Conversation {
  id: number
  name: string
  role: string
  status: AgentStatus
  model: string
  parentId?: number
  kind: 'root' | 'subagent' | 'fork'
  lastActive: string
  summary: string
}

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  assignedConversationId?: number
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
  toolCalls?: ToolCall[]
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
