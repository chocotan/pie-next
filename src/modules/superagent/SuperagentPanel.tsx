import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SuperagentPanel.module.css'

export interface SuperagentRule { id: string; name: string; enabled: boolean; instruction: string }
export interface SuperagentTicket {
  id: string; title: string; scope: string; requester: string; ruleIds: string[]; policyVersion: string
  conversationId?: number; stage: 'pending' | 'working' | 'attention' | 'ended'; report?: string; createdAt: string; endedAt?: string
}
export interface SuperagentState {
  settings: { paused: boolean; mode: 'off' | 'observe' | 'auto'; allowed: string[]; rules: SuperagentRule[] }
  tickets: SuperagentTicket[]
  policyVersion: string
  sources: Array<{ id: 'github' | 'feishu'; enabled: false; reason: string }>
}
type Tab = 'overview' | 'tickets' | 'policy'

const stageLabel = { pending: '待启动', working: '执行中', attention: '待人工决定', ended: '已结束' }

export function SuperagentPanel({ state, onAccept, onStop, onSave, onOpen, onBack }: {
  state?: SuperagentState
  onAccept: (input: { title: string; scope: string; requester: string; ruleIds: string[] }) => Promise<void>
  onStop: (id: string, reason: string) => Promise<void>
  onSave: (settings: SuperagentState['settings']) => Promise<void>
  onOpen: (conversationId: number) => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<Tab>('overview')
  const [draft, setDraft] = useState<SuperagentState['settings'] | undefined>(state?.settings)
  const [form, setForm] = useState({ title: '', scope: '', requester: '', ruleIds: [] as string[] })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => setDraft(state?.settings), [state?.settings])
  if (!state || !draft) return <section className={css.root}><p>正在读取 Superagent…</p></section>
  const attention = state.tickets.filter(ticket => ticket.stage === 'attention')
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') } finally { setBusy('') }
  }
  return <section className={css.root} aria-label="Superagent">
    <header className={css.header}><div><button type="button" onClick={onBack}>返回会话</button><h1>Superagent</h1><p>本地工单与授权。GitHub、飞书和自动 PR 未接入。</p></div><span>策略 {state.policyVersion}</span></header>
    <nav aria-label="Superagent 页面">{(['overview', 'tickets', 'policy'] as const).map(id => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{{ overview: '总览', tickets: '工单', policy: '策略' }[id]}</button>)}</nav>
    {error && <p role="alert">{error}</p>}
    {tab === 'overview' && <div className={css.grid}>
      <article><h2>需要我处理 {attention.length}</h2>{attention.length === 0 ? <p>没有等待人工决定的工单。</p> : attention.map(ticket => <p key={ticket.id}><strong>{ticket.title}</strong><br />{ticket.report}</p>)}</article>
      <article><h2>来源</h2>{state.sources.map(source => <p key={source.id}><strong>{source.id === 'github' ? 'GitHub' : '飞书'}</strong> · 未启用<br />{source.reason}</p>)}</article>
      <article><h2>执行</h2><p>{state.settings.paused ? '处理已暂停' : '处理中'} · 模式 {state.settings.mode}</p><p>工单 {state.tickets.length} · 执行中 {state.tickets.filter(ticket => ticket.stage === 'working').length}</p></article>
    </div>}
    {tab === 'tickets' && <div className={css.split}>
      <form onSubmit={event => { event.preventDefault(); void run('accept', async () => { await onAccept(form); setForm({ title: '', scope: '', requester: '', ruleIds: [] }) }) }}>
        <h2>人工接单</h2>
        <label>标题<input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required /></label>
        <label>范围<textarea value={form.scope} onChange={event => setForm({ ...form, scope: event.target.value })} required /></label>
        <label>请求人<input value={form.requester} onChange={event => setForm({ ...form, requester: event.target.value })} required /></label>
        <fieldset><legend>匹配规则</legend>{draft.rules.filter(rule => rule.enabled).map(rule => <label key={rule.id}><input type="checkbox" checked={form.ruleIds.includes(rule.id)} onChange={event => setForm({ ...form, ruleIds: event.target.checked ? [...form.ruleIds, rule.id] : form.ruleIds.filter(id => id !== rule.id) })} />{rule.name}</label>)}</fieldset>
        <Button type="submit" disabled={Boolean(busy)}>{busy === 'accept' ? '接单中…' : '接单并创建会话'}</Button>
      </form>
      <ul>{state.tickets.map(ticket => <li key={ticket.id}><div><strong>{ticket.title}</strong><span>{stageLabel[ticket.stage]}</span></div><p>{ticket.scope}</p><small>{ticket.requester} · {ticket.ruleIds.join(', ')} · {ticket.policyVersion}</small>{ticket.report && <p>{ticket.report}</p>}<div>{ticket.conversationId && <button type="button" onClick={() => onOpen(ticket.conversationId!)}>打开会话</button>}{ticket.stage !== 'ended' && <button type="button" onClick={() => { void run(ticket.id, () => onStop(ticket.id, '由人工停止')) }}>停止</button>}</div></li>)}</ul>
    </div>}
    {tab === 'policy' && <form className={css.policy} onSubmit={event => { event.preventDefault(); void run('save', () => onSave(draft)) }}>
      <label><input type="checkbox" checked={draft.paused} onChange={event => setDraft({ ...draft, paused: event.target.checked })} />暂停处理</label>
      <label>评估模式<select value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value as SuperagentState['settings']['mode'] })}><option value="off">关闭</option><option value="observe">观察</option><option value="auto">自动</option></select></label>
      <label>允许的请求人（每行一个，空表示不限制）<textarea value={draft.allowed.join('\n')} onChange={event => setDraft({ ...draft, allowed: event.target.value.split('\n').map(item => item.trim()).filter(Boolean) })} /></label>
      {draft.rules.map((rule, index) => <fieldset key={rule.id}><label><input type="checkbox" checked={rule.enabled} onChange={event => setDraft({ ...draft, rules: draft.rules.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item) })} />{rule.name}</label><textarea value={rule.instruction} onChange={event => setDraft({ ...draft, rules: draft.rules.map((item, itemIndex) => itemIndex === index ? { ...item, instruction: event.target.value } : item) })} /></fieldset>)}
      <Button type="submit" disabled={Boolean(busy)}>保存策略</Button>
    </form>}
  </section>
}
