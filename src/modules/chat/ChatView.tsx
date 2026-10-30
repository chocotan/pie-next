import { useEffect, useRef, useState } from 'react'
import { IconApiOutlineRegular, IconBrowseOutlineRegular, IconChecklistOutlineRegular, IconCodeOutlineRegular, IconWarningOutlineRegular, MarkdownText, StateDot, UserMessageBubble } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatMessage, ToolCall } from '../session/types.ts'
import { ApprovalCard } from '../approval/ApprovalCard.tsx'
import chatCss from './ChatView.module.css'
import messageCss from './MessageItem.module.css'
import { ToolRow, type ToolRowState, type ToolRowVariant } from './ToolRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'

const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }
const messageT = (key: string): string => ({ copy: '复制', copied: '已复制' } as Record<string, string>)[key] ?? key

function toolDetail(call: ToolCall): string {
  try {
    const args = JSON.parse(call.args) as Record<string, unknown>
    if (typeof args.command === 'string') return args.command
    if (typeof args.path === 'string') return args.path
    if (typeof args.subject === 'string') return args.subject
    if (typeof args.taskId === 'string') return `任务 ${args.taskId}`
    if (typeof args.action === 'string') return `${args.action}${typeof args.name === 'string' ? ` · ${args.name}` : ''}`
    if (Array.isArray(args.items)) return `${args.items.length} 项任务`
  } catch { /* Show the original arguments when a provider emitted partial JSON. */ }
  return call.args
}

function ToolCard({ call, onDecision }: { call: ToolCall; onDecision: (id: string | number, approved: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const icon = call.name === 'todo_write' ? <IconChecklistOutlineRegular /> : call.name === 'bash' ? <IconApiOutlineRegular /> : call.name === 'read' ? <IconBrowseOutlineRegular /> : <IconCodeOutlineRegular />
  const variant: ToolRowVariant = call.name === 'bash' ? 'bash' : call.name === 'read' ? 'read' : call.name === 'write' ? 'write' : call.name === 'edit' ? 'edit' : call.name === 'grep' || call.name === 'glob' ? 'search' : 'others'
  const state: ToolRowState = call.status === 'error' ? 'error' : call.status === 'done' ? 'ok' : 'running'
  return <>
    <ToolRow
      useDisclosure={() => ({ expanded: open, toggle: () => setOpen(value => !value) })}
      t={key => ({ 'row.preparing': '准备中', 'row.running': '运行中', 'row.failed': '失败', 'row.stopped': '已停止', 'row.inspect': '检查' } as Record<string, string>)[key] ?? key}
      variant={variant}
      toolName={call.name}
      icon={icon}
      title={call.summary}
      summary={toolDetail(call)}
      summarySuffix={call.duration}
      bodyRaw={call.args}
      output={call.result}
      errorSummary={call.result?.split('\n')[0]}
      state={state}
      terminal={call.name === 'bash' ? { card: { command: toolDetail(call), output: call.result, running: call.status === 'running' || call.status === 'approval' }, description: toolDetail(call) } : undefined}
    />
    {call.status === 'approval' && <ApprovalCard call={call} onDecision={onDecision} />}
  </>
}

export function ChatView({ messages, onDecision, loading = false, loadingLabel = '正在生成回复…' }: { messages: ChatMessage[]; onDecision: (id: string | number, approved: boolean) => Promise<void>; loading?: boolean; loadingLabel?: string }) {
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const scroller = (): HTMLElement | null => scroll.current?.closest('[data-conversation-scroll]') as HTMLElement | null ?? scroll.current
  useEffect(() => {
    const node = scroller()
    if (!node) return
    const onScroll = (): void => { follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80 }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const node = scroller()
    if (follow.current && node) node.scrollTop = node.scrollHeight
  }, [messages, loading])
  return <div className={chatCss.frame}><div className={chatCss.root}><div className={chatCss.scroll} ref={scroll}><div className={chatCss.column}>{messages.map(message => {
    if (message.role === 'system') return <StateDot key={message.id} state="idle" />
    if (message.role === 'user') return <div className={messageCss.userRow} key={message.id}><div className={messageCss.userStack}><UserMessageBubble>{message.content}</UserMessageBubble><MessageIconActions text={message.content} clock="start" t={messageT} /></div></div>
    return <div key={message.id}>
      {message.content && <MarkdownText text={message.content} labels={markdownLabels} />}
      {message.error && <div className={messageCss.turnErrorRow} role="alert"><IconWarningOutlineRegular /><div className={messageCss.turnErrorCopy}><span className={messageCss.turnErrorTitle}>模型运行失败</span><span className={messageCss.turnErrorMessage}>{message.error}</span></div></div>}
      {message.toolCalls?.map(call => <ToolCard key={call.id} call={call} onDecision={onDecision} />)}
      {(message.content || message.toolCalls?.length) && <MessageIconActions text={message.content} clock="end" t={messageT} />}
    </div>
  })}{loading && <div className={messageCss.loadingRow} role="status" aria-live="polite"><StateDot state="ongoing" /><span>{loadingLabel}</span></div>}</div></div></div></div>
}
