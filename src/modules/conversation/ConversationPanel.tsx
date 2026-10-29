import type { CSSProperties } from 'react'
import { Button, IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular, IconDownloadOutlineRegular, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChatView } from '../chat/ChatView.tsx'
import { TrajectoryView } from '../trajectory/TrajectoryView.tsx'
import messageCss from '../chat/MessageItem.module.css'
import { Composer } from './Composer.tsx'
import type { EntryRecord } from '@earendil-works/pi-durable'
import type { ChatMessage, Conversation, TodoItem } from '../session/types.ts'
import { TodoPanel } from '../todo/TodoPanel.tsx'
import css from './ConversationRoot.module.css'

const todoText = (key: string, params: Record<string, number> = {}) => ({
  'todo.title': '任务计划', 'todo.status.completed': '已完成', 'todo.status.inProgress': '进行中', 'todo.status.pending': '待处理', 'todo.status.cancelled': '已取消',
  'todo.progress.done': `${params.done ?? 0} 已完成`, 'todo.progress.active': `${params.active ?? 0} 进行中`, 'todo.progress.pending': `${params.pending ?? 0} 待处理`,
}[key] ?? key)

function usageSummary(entries: EntryRecord[]): string {
  let turns = 0, steps = 0, tools = 0, input = 0, output = 0, duration = 0
  for (const entry of entries) {
    const message = entry.model?.[0]
    if (message?.role === 'user') turns++
    if (message?.role === 'toolResult') steps++
    if (message?.role !== 'assistant') continue
    steps++
    duration += message.durationMs ?? 0
    input += message.usage.input
    output += message.usage.output
    tools += message.content.filter(part => part.type === 'toolCall').length
  }
  if (!turns) return ''
  const compact = (value: number): string => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K` : String(value)
  return `${turns} 轮 · ${steps} 步 ｜ LLM ${duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`} · 工具调用 ${tools} ｜ 输入 ${compact(input)} tok · 输出 ${compact(output)} tok`
}

export function ConversationPanel({ conversation, childCount, messages, entries, todos, view, onView, draft, onDraft, onSend, onStop, onDecision, onToggleInspector, error }: {
  conversation: Conversation
  childCount: number
  messages: ChatMessage[]
  entries: EntryRecord[]
  todos: TodoItem[]
  view: 'chat' | 'trajectory'
  onView: (view: 'chat' | 'trajectory') => void
  draft: string
  onDraft: (value: string) => void
  onSend: () => void
  onStop: () => void
  onDecision: (id: string | number, approved: boolean) => Promise<void>
  onToggleInspector: () => void
  error?: string
}) {
  return <div className={css.root} data-phase="active">
    <div className={css.header}>
      <div className={css.titleRow}><div className={css.titleCluster}><div className={css.crumbs}>
        <span className={`${css.crumb} ${css.crumbCurrent}`}>{conversation.name}</span>
        <div className={css.headerActions}><span className={css.crumbSeg}><IconAgentPresetOutlineRegular /><span className={css.crumb}>标准模式</span></span><Button size="sm" variant="ghost" onClick={onToggleInspector}>{childCount} 个子代理<IconChevronDownOutlineRegular /></Button></div>
      </div></div><div className={css.headerUtilities}><Button size="sm" variant="outline" icon={<IconDownloadOutlineRegular />} onClick={() => onView('trajectory')}>Session log</Button></div></div>
      <div className={css.tabs}><div className={css.viewTabs} role="tablist" aria-label="会话视图">
        <button className={`${css.tab} ${view === 'chat' ? css.tabActive : ''}`} role="tab" aria-selected={view === 'chat'} onClick={() => onView('chat')}>对话</button>
        <button className={`${css.tab} ${view === 'trajectory' ? css.tabActive : ''}`} role="tab" aria-selected={view === 'trajectory'} onClick={() => onView('trajectory')}>轨迹</button>
      </div></div>
    </div>
    <div className={css.body} data-conversation-content style={{ '--dsh-conversation-column-width': '100%', '--dsh-content-font-size': '16px', '--dsh-content-font-delta': '2px' } as CSSProperties}>
      <div className={css.scrollBody} data-conversation-scroll>
        <div className={css.viewArea}>{error && <div className={messageCss.turnErrorRow} role="alert"><IconWarningOutlineRegular /><div className={messageCss.turnErrorCopy}><span className={messageCss.turnErrorTitle}>Host 或命令执行失败</span><span className={messageCss.turnErrorMessage}>{error}</span></div></div>}{view === 'chat' ? <ChatView messages={messages} onDecision={onDecision} /> : <TrajectoryView entries={entries} />}</div>
        <div className={css.composerSeat} data-composer-seat><div className={css.composerStack}><TodoPanel todos={todos} t={todoText} /><Composer draft={draft} onDraft={onDraft} onSend={onSend} onStop={onStop} busy={conversation.status !== 'idle' && conversation.status !== 'stopped'} model={conversation.model} stats={usageSummary(entries)} /></div></div>
      </div>
    </div>
  </div>
}
