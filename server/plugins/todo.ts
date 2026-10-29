import type { Context } from '@earendil-works/chord'
import { Type } from '@earendil-works/pi-ai'
import { defineDoc, defineExtension, defineTool, section, type ConversationId, type Harness } from '@earendil-works/pi-durable'

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TodoItem = {
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
type TodoState = { items: TodoItem[]; updatedAt: number }
type TodoWriteReceipt = { applied: boolean; output: string }

export const TodoDoc = defineDoc<TodoState>({
  kind: 'app.todos', version: 1, scope: 'conversation', history: 'rewindable', fork: 'asOf',
  initial: () => ({ items: [], updatedAt: 0 }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
})
export const TodoReceipt = defineDoc<TodoWriteReceipt>({
  kind: 'app.todo-write-receipt', version: 1, scope: 'task', initial: () => ({ applied: false, output: '' }), checkpointWhen: () => false,
})

const metadata = Type.Record(Type.String(), Type.String())
const createSchema = Type.Object({
  subject: Type.String({ minLength: 1, maxLength: 400 }),
  description: Type.Optional(Type.String({ maxLength: 32_768 })),
  activeForm: Type.Optional(Type.String({ maxLength: 200 })),
  agentType: Type.Optional(Type.String({ maxLength: 100 })),
  metadata: Type.Optional(metadata),
})
const updateSchema = Type.Object({
  taskId: Type.String(),
  status: Type.Optional(Type.Union(['pending', 'in_progress', 'completed', 'cancelled', 'deleted'].map(value => Type.Literal(value)))),
  subject: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  description: Type.Optional(Type.String({ maxLength: 32_768 })),
  activeForm: Type.Optional(Type.String({ maxLength: 200 })),
  agentType: Type.Optional(Type.String({ maxLength: 100 })),
  owner: Type.Optional(Type.String({ maxLength: 200 })),
  metadata: Type.Optional(metadata),
  addBlocks: Type.Optional(Type.Array(Type.String())),
  addBlockedBy: Type.Optional(Type.Array(Type.String())),
})
export type TaskCreateInput = {
  subject: string
  description?: string
  activeForm?: string
  agentType?: string
  metadata?: Record<string, string>
}
export type TaskUpdateInput = {
  taskId: string
  status?: TodoStatus | 'deleted'
  subject?: string
  description?: string
  activeForm?: string
  agentType?: string
  owner?: string
  metadata?: Record<string, string>
  addBlocks?: string[]
  addBlockedBy?: string[]
}

export function createTask(items: readonly TodoItem[], input: TaskCreateInput): { items: TodoItem[]; task: TodoItem } {
  const subject = input.subject.trim()
  if (!subject) throw new Error('Task subject must not be blank')
  const nextId = String(items.reduce((max, item) => /^\d+$/.test(item.id) ? Math.max(max, Number(item.id)) : max, 0) + 1)
  const task: TodoItem = {
    id: nextId, content: subject, status: 'pending', blockedBy: [],
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.activeForm === undefined ? {} : { activeForm: input.activeForm }),
    ...(input.agentType === undefined ? {} : { agentType: input.agentType }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  }
  return { items: [...items, task], task }
}

export function updateTask(items: readonly TodoItem[], changes: TaskUpdateInput): TodoItem[] {
  const next = structuredClone(items) as TodoItem[]
  const task = next.find(item => item.id === changes.taskId)
  if (!task) throw new Error(`Unknown task: ${changes.taskId}`)
  if (changes.status === 'deleted') {
    return next.filter(item => item.id !== task.id).map(item => ({ ...item, blockedBy: item.blockedBy?.filter(id => id !== task.id) }))
  }
  if (changes.subject !== undefined) {
    if (!changes.subject.trim()) throw new Error('Task subject must not be blank')
    task.content = changes.subject
  }
  for (const key of ['description', 'activeForm', 'agentType', 'owner'] as const) {
    const value = changes[key]
    if (value !== undefined) task[key] = value
  }
  if (changes.metadata) task.metadata = { ...task.metadata, ...changes.metadata }
  task.blockedBy = [...new Set([...task.blockedBy ?? [], ...changes.addBlockedBy ?? []])]
  for (const id of changes.addBlocks ?? []) {
    const blocked = next.find(item => item.id === id)
    if (!blocked) throw new Error(`Unknown task: ${id}`)
    blocked.blockedBy = [...new Set([...blocked.blockedBy ?? [], task.id])]
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Task dependencies must not contain a cycle')
    if (visited.has(id)) return
    const item = next.find(candidate => candidate.id === id)
    if (!item) throw new Error(`Unknown dependency: ${id}`)
    visiting.add(id)
    for (const dependency of item.blockedBy ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const item of next) visit(item.id)
  if (changes.status) task.status = changes.status
  if (changes.status === 'in_progress' || changes.status === 'completed') {
    const open = (task.blockedBy ?? []).filter(id => next.find(item => item.id === id)?.status !== 'completed')
    if (open.length) throw new Error(`Task ${task.id} is blocked by ${open.join(', ')}`)
  }
  return next
}

export function sortTasks(items: readonly TodoItem[]): TodoItem[] {
  const rank = { in_progress: 0, pending: 1, completed: 2, cancelled: 3 } as const
  return [...items].sort((a, b) => rank[a.status] - rank[b.status])
}

function publicTask(item: TodoItem): Record<string, unknown> {
  return { ...item, subject: item.content, blockedBy: item.blockedBy ?? [] }
}
function textResult(text: string) { return { output: [{ type: 'text' as const, text }] } }
function formatTasks(items: readonly TodoItem[]): string {
  if (!items.length) return 'No tasks.'
  return sortTasks(items).map(item => `- [${item.status}] (${item.id}) ${item.content}${item.blockedBy?.length ? ` · blocked by ${item.blockedBy.join(', ')}` : ''}${item.owner ? ` · owner ${item.owner}` : ''}`).join('\n')
}

export const TodoExtension = defineExtension({
  name: 'core.tasks',
  tools: [
    defineTool({
      name: 'TaskCreate',
      description: 'Create a pending session task for multi-step work. Keep task status and dependencies current with TaskUpdate.',
      parameters: createSchema, replay: 'safe',
      execute: async (args, api, context) => {
        const output = await api.commit(async tx => {
          const receipt = await tx.doc(TodoReceipt, api.taskId)
          if (receipt.applied) return receipt.output
          const doc = await tx.doc(TodoDoc, api.conversationId)
          const created = createTask(doc.items, args)
          doc.items = created.items
          doc.updatedAt = api.now()
          receipt.applied = true
          receipt.output = JSON.stringify(publicTask(created.task), null, 2)
          return receipt.output
        }, context)
        return textResult(output)
      },
    }),
    defineTool({
      name: 'TaskList', description: 'List session tasks with active work first, including blockers.',
      parameters: Type.Object({}), replay: 'safe',
      execute: async (_args, api, context) => {
        const doc = await api.snapshot(TodoDoc, api.conversationId, context)
        return textResult(JSON.stringify(sortTasks(doc?.items ?? []).map(publicTask), null, 2))
      },
    }),
    defineTool({
      name: 'TaskGet', description: "Read one task's requirements, status, owner, and dependencies.",
      parameters: Type.Object({ taskId: Type.String() }), replay: 'safe',
      execute: async (args, api, context) => {
        const items = (await api.snapshot(TodoDoc, api.conversationId, context))?.items ?? []
        const task = items.find(item => item.id === args.taskId)
        if (!task) throw new Error(`Unknown task: ${args.taskId}`)
        return textResult(JSON.stringify({ ...publicTask(task), blocks: items.filter(item => item.blockedBy?.includes(task.id)).map(item => item.id) }, null, 2))
      },
    }),
    defineTool({
      name: 'TaskUpdate', description: 'Update a task or delete it with status deleted. Dependencies must exist and remain acyclic.',
      parameters: updateSchema, replay: 'safe',
      execute: async (args, api, context) => {
        const output = await api.commit(async tx => {
          const receipt = await tx.doc(TodoReceipt, api.taskId)
          if (receipt.applied) return receipt.output
          const doc = await tx.doc(TodoDoc, api.conversationId)
          doc.items = updateTask(doc.items, args)
          doc.updatedAt = api.now()
          receipt.applied = true
          receipt.output = JSON.stringify(args.status === 'deleted' ? { taskId: args.taskId, status: 'deleted' } : publicTask(doc.items.find(item => item.id === args.taskId)!), null, 2)
          return receipt.output
        }, context)
        return textResult(output)
      },
    }),
  ],
  sections: [section('tasks', async (input, context) => {
    const doc = await input.read.snapshot(TodoDoc, input.conversationId, context)
    return doc?.items.length ? formatTasks(doc.items) : undefined
  })],
})

export async function updateTodos(harness: Harness, conversationId: ConversationId, items: TodoItem[], context: Context): Promise<void> {
  await harness.commit(async tx => {
    const doc = await tx.doc(TodoDoc, conversationId)
    doc.items = items
    doc.updatedAt = Date.now()
  }, context)
}
