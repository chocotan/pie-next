import { useEffect, useRef, useState } from 'react'
import { DisclosureRow, IconApiOutlineRegular, IconBrowseOutlineRegular, IconChecklistOutlineRegular, IconCodeOutlineRegular, IconWarningOutlineRegular, MarkdownText, StateDot, UserMessageBubble } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatMessage, ToolCall } from '../session/types.ts'
import { ApprovalCard } from '../approval/ApprovalCard.tsx'
import chatCss from './ChatView.module.css'
import messageCss from './MessageItem.module.css'
import toolCss from './ToolRow.module.css'

const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }

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
  const state = call.status === 'approval' ? 'waiting' : call.status
  return <div className={toolCss.root} data-tool={call.name} data-state={state}>
    <DisclosureRow
      rowClassName={toolCss.row}
      leadingClassName={toolCss.leading}
      titleClassName={toolCss.title}
      icon={icon}
      title={call.summary}
      running={call.status === 'running'}
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => setOpen(value => !value)}
      keepContentWhenOpen
      collapsedContent={<><span className={toolCss.sep} aria-hidden /><span className={toolCss.summary}>{toolDetail(call)}</span><span className={toolCss.summarySuffix}>{call.duration}</span></>}
    >
      <div className={toolCss.bodyWrap}>
        <div className={toolCss.ioCard}>
          <div className={toolCss.ioSection}><span className={toolCss.ioLabel}>IN</span><span className={toolCss.ioText}>{call.args}</span></div>
          {call.result && <><span className={toolCss.ioDivider} aria-hidden /><div className={toolCss.ioSection}><span className={toolCss.ioLabel}>OUT</span><span className={toolCss.ioText} data-error={call.status === 'error' || undefined}>{call.result}</span></div></>}
        </div>
        {call.details && <div className={toolCss.imageExtra}>{call.details}</div>}
      </div>
    </DisclosureRow>
    {call.status === 'approval' && <ApprovalCard call={call} onDecision={onDecision} />}
  </div>
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
    if (message.role === 'user') return <div className={messageCss.userRow} key={message.id}><div className={messageCss.userStack}><UserMessageBubble>{message.content}</UserMessageBubble></div></div>
    return <div key={message.id}>
      {message.content && <MarkdownText text={message.content} labels={markdownLabels} />}
      {message.error && <div className={messageCss.turnErrorRow} role="alert"><IconWarningOutlineRegular /><div className={messageCss.turnErrorCopy}><span className={messageCss.turnErrorTitle}>模型运行失败</span><span className={messageCss.turnErrorMessage}>{message.error}</span></div></div>}
      {message.toolCalls?.map(call => <ToolCard key={call.id} call={call} onDecision={onDecision} />)}
    </div>
  })}{loading && <div className={messageCss.loadingRow} role="status" aria-live="polite"><StateDot state="ongoing" /><span>{loadingLabel}</span></div>}</div></div></div></div>
}
