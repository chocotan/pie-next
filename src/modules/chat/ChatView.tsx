import { useEffect, useRef, useState } from 'react'
import { DisclosureRow, IconApiOutlineRegular, IconBrowseOutlineRegular, IconChecklistOutlineRegular, IconCodeOutlineRegular, MarkdownText, StateDot, UserMessageBubble } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatMessage, ToolCall } from '../session/types.ts'
import { ApprovalCard } from '../approval/ApprovalCard.tsx'
import chatCss from './ChatView.module.css'
import messageCss from './MessageItem.module.css'
import toolCss from './ToolRow.module.css'

const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }

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
      title={call.name}
      running={call.status === 'running'}
      open={open}
      expandable
      onToggle={() => setOpen(value => !value)}
      keepContentWhenOpen
      collapsedContent={<><span className={toolCss.sep} aria-hidden /><span className={toolCss.summary}>{call.summary}</span><span className={toolCss.summarySuffix}>{call.duration}</span></>}
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

export function ChatView({ messages, onDecision }: { messages: ChatMessage[]; onDecision: (id: string | number, approved: boolean) => Promise<void> }) {
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
  }, [messages])
  return <div className={chatCss.frame}><div className={chatCss.root}><div className={chatCss.scroll} ref={scroll}><div className={chatCss.column}>{messages.map(message => {
    if (message.role === 'system') return <StateDot key={message.id} state="idle" />
    if (message.role === 'user') return <div className={messageCss.userRow} key={message.id}><div className={messageCss.userStack}><UserMessageBubble>{message.content}</UserMessageBubble></div></div>
    return <div key={message.id}>
      <MarkdownText text={message.content} labels={markdownLabels} />
      {message.toolCalls?.map(call => <ToolCard key={call.id} call={call} onDecision={onDecision} />)}
    </div>
  })}</div></div></div></div>
}
