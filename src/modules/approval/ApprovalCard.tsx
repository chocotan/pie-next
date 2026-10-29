// Copied from DSH ApprovalCard; only the request and answer bindings changed.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCall } from '../session/types.ts'
import css from './ApprovalPanel.module.css'

export function ApprovalCard({ call, onDecision }: { call: ToolCall; onDecision: (id: string | number, approved: boolean) => Promise<void> }) {
  const [answered, setAnswered] = useState(false)
  const waiting = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const answer = (approved: boolean): void => {
    if (waiting.current) return
    waiting.current = true
    setAnswered(true)
    void onDecision(call.taskId ?? call.id, approved).catch(() => {
      if (!active.current) return
      waiting.current = false
      setAnswered(false)
    })
  }
  const keydown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const element = event.target as Element
    if (event.defaultPrevented || !event.currentTarget.contains(document.activeElement)
      || element.closest('input, textarea, select, button, [contenteditable="true"]') !== null) return
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    answer(event.key === 'Enter')
  }
  return <div className={css.root} data-approval-key={call.id} aria-busy={answered} onKeyDown={keydown}>
    <div className={css.card}>
      <div className={css.strip}><StateDot state={answered ? 'ongoing' : 'warning'} />等待你的决定</div>
      <div className={css.body} tabIndex={0} role="group" aria-label="工具审批详情">
        <div className={css.headline}>允许 {call.name} 执行此操作吗？</div>
        <p className={css.description}>操作将在当前工作区执行，仅批准这一次，不修改永久权限。</p>
        <div className={css.command}>{call.args}</div>
      </div>
      <div className={css.actionRow}>
        <Button variant="outline" className={css.reject} disabled={answered} onClick={() => answer(false)}>拒绝</Button>
        <Button variant="primary" disabled={answered} onClick={() => answer(true)}>批准一次</Button>
      </div>
    </div>
  </div>
}
