import { Button, IconAgentPresetOutlineRegular, IconChecklistOutlineRegular, IconCloseOutlineRegular, IconQueueOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BackgroundTask, Conversation, PluginInfo, TodoItem } from '../session/types.ts'
import { TasksPanel } from './TasksPanel.tsx'
import { BackgroundPanel } from './BackgroundPanel.tsx'
import dockCss from './dockkit.module.css'
import todoCss from '../todo/TodoPanel.module.css'

export type InspectorTab = 'tasks' | 'agents' | 'background'

export function InspectorPanel({ plugins, tab, onTab, todos, agents, onAgent, background, onStartBackground, onStopBackground, onClose }: {
  plugins: PluginInfo[]
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  todos: TodoItem[]
  agents: Conversation[]
  onAgent: (id: number) => void
  background: Record<string, BackgroundTask>
  onStartBackground: (command: string, title?: string) => Promise<void>
  onStopBackground: (id: string) => Promise<void>
  onClose: () => void
}) {
  const enabled = (id: string): boolean => plugins.find(plugin => plugin.id === id)?.enabled ?? true
  const tabs: Array<{ id: InspectorTab; enabled: boolean }> = [{ id: 'tasks', enabled: enabled('todo') }, { id: 'agents', enabled: enabled('subagent') }, { id: 'background', enabled: enabled('background') }]
  const activeTab = tabs.find(item => item.id === tab && item.enabled)?.id ?? tabs.find(item => item.enabled)?.id
  return <div className={dockCss.pane}>
    <div className={dockCss.tabStrip}><div className={`${dockCss.stripTabs} ${dockCss.inspectorTabs}`} role="tablist" aria-label="运行状态检查器">
      {enabled('todo') && <button type="button" className={`${dockCss.tab} ${activeTab === 'tasks' ? dockCss.tabActive : ''}`} role="tab" aria-selected={activeTab === 'tasks'} onClick={() => onTab('tasks')}><IconChecklistOutlineRegular /><span className={dockCss.tabTitle}>任务</span></button>}
      {enabled('subagent') && <button type="button" className={`${dockCss.tab} ${activeTab === 'agents' ? dockCss.tabActive : ''}`} role="tab" aria-selected={activeTab === 'agents'} onClick={() => onTab('agents')}><IconAgentPresetOutlineRegular /><span className={dockCss.tabTitle}>子代理</span></button>}
      {enabled('background') && <button type="button" className={`${dockCss.tab} ${activeTab === 'background' ? dockCss.tabActive : ''}`} role="tab" aria-selected={activeTab === 'background'} onClick={() => onTab('background')}><IconQueueOutlineRegular /><span className={dockCss.tabTitle}>后台任务</span></button>}
    </div><Button size="sm" variant="ghost" aria-label="关闭检查器" icon={<IconCloseOutlineRegular />} onClick={onClose} /></div>
    <div className={dockCss.paneBody}>
      {!activeTab && <p className={dockCss.empty}>面板插件均已停用，可在设置中重新启用。</p>}
      {activeTab === 'tasks' && <TasksPanel todos={todos} />}
      {activeTab === 'agents' && (agents.some(agent => agent.parentId) ? <ul className={todoCss.list}>{agents.filter(agent => agent.parentId).map(agent => <li className={todoCss.item} key={agent.id}><span role="button" tabIndex={0} className={todoCss.content} onClick={() => onAgent(agent.id)} onKeyDown={event => { if (event.key === 'Enter') onAgent(agent.id) }}><IconAgentPresetOutlineRegular />{agent.name} · {agent.model}{agent.turns ? ` · ${agent.turns} 轮` : ''}</span><StateDot state={agent.status === 'idle' ? 'done' : agent.status === 'error' ? 'error' : 'ongoing'} /></li>)}</ul> : <p className={dockCss.empty}>暂无子代理</p>)}
      {activeTab === 'background' && <BackgroundPanel tasks={background} onStart={onStartBackground} onStop={onStopBackground} />}
    </div>
  </div>
}
