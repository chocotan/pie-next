import { Button, Checkbox, IconAgentPresetOutlineRegular, IconChecklistOutlineRegular, IconCloseOutlineRegular, IconDataOutlineRegular, JsonTree, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { TodoPanel } from '../todo/TodoPanel.tsx'
import type { Conversation, TodoItem } from '../session/types.ts'
import dockCss from './dockkit.module.css'
import todoCss from '../todo/TodoPanel.module.css'

const labels = { copyValue: '复制值', copyJson: '复制 JSON', copyPath: '复制路径', copyPrettyJson: '复制格式化 JSON', copyCompactJson: '复制紧凑 JSON', copied: '已复制', copyFailed: '复制失败', collapseNode: '折叠', expandNode: '展开', copyButtonTitle: (action: string) => `复制选项：${action}` }
const todoText = (key: string, params: Record<string, number> = {}) => ({ 'todo.title': '任务计划', 'todo.status.completed': '已完成', 'todo.status.inProgress': '进行中', 'todo.status.pending': '待处理', 'todo.status.cancelled': '已取消', 'todo.progress.done': `${params.done ?? 0} 已完成`, 'todo.progress.active': `${params.active ?? 0} 进行中`, 'todo.progress.pending': `${params.pending ?? 0} 待处理` }[key] ?? key)

export function InspectorPanel({ tab, onTab, todos, onTodo, agents, onAgent, usage, onClose }: {
  tab: 'todo' | 'agents' | 'usage'
  onTab: (tab: 'todo' | 'agents' | 'usage') => void
  todos: TodoItem[]
  onTodo: (id: string) => void
  agents: Conversation[]
  onAgent: (id: number) => void
  usage: { input: number; output: number; cost: number; conversationId: number }
  onClose: () => void
}) {
  return <div className={dockCss.pane}>
    <div className={dockCss.tabStrip}><div className={dockCss.stripTabs} role="tablist" aria-label="运行状态检查器">
      <div className={`${dockCss.tab} ${tab === 'todo' ? dockCss.tabActive : ''}`} role="tab" tabIndex={0} aria-selected={tab === 'todo'} onClick={() => onTab('todo')} onKeyDown={event => { if (event.key === 'Enter') onTab('todo') }}><IconChecklistOutlineRegular /><span className={dockCss.tabTitle}>Todo</span></div>
      <div className={`${dockCss.tab} ${tab === 'agents' ? dockCss.tabActive : ''}`} role="tab" tabIndex={0} aria-selected={tab === 'agents'} onClick={() => onTab('agents')} onKeyDown={event => { if (event.key === 'Enter') onTab('agents') }}><IconAgentPresetOutlineRegular /><span className={dockCss.tabTitle}>Agents</span></div>
      <div className={`${dockCss.tab} ${tab === 'usage' ? dockCss.tabActive : ''}`} role="tab" tabIndex={0} aria-selected={tab === 'usage'} onClick={() => onTab('usage')} onKeyDown={event => { if (event.key === 'Enter') onTab('usage') }}><IconDataOutlineRegular /><span className={dockCss.tabTitle}>Usage</span></div>
    </div><Button size="sm" variant="ghost" aria-label="关闭检查器" icon={<IconCloseOutlineRegular />} onClick={onClose} /></div>
    <div className={dockCss.paneBody}>
      {tab === 'todo' && <><TodoPanel todos={todos} t={todoText} /><ul className={todoCss.list}>{todos.map(item => <li className={todoCss.item} key={item.id}><Checkbox checked={item.status === 'completed'} onChange={() => onTodo(item.id)} label={item.content} /><StateDot state={item.status === 'in_progress' ? 'ongoing' : item.status === 'completed' ? 'done' : 'idle'} /></li>)}</ul></>}
      {tab === 'agents' && <ul className={todoCss.list}>{agents.filter(agent => agent.parentId).map(agent => <li className={todoCss.item} key={agent.id}><span role="button" tabIndex={0} className={todoCss.content} onClick={() => onAgent(agent.id)} onKeyDown={event => { if (event.key === 'Enter') onAgent(agent.id) }}><IconAgentPresetOutlineRegular />{agent.name} · {agent.role}</span><StateDot state={agent.status === 'idle' ? 'done' : agent.status === 'approval' ? 'warning' : 'ongoing'} /></li>)}</ul>}
      {tab === 'usage' && <JsonTree data={{ cost: `$${usage.cost.toFixed(3)}`, tokens: { input: usage.input, output: usage.output }, conversationId: usage.conversationId }} label="Token 与费用" labels={labels} />}
    </div>
  </div>
}
