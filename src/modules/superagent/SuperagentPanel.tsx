import { useEffect, useState } from 'react'
import { Button, IconChevronLeftOutlineRegular, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
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
const stageLabel = { pending: '待启动', working: '执行中', attention: '待决定', ended: '已结束' }

export function SuperagentPanel({ state, onAccept, onStop, onSave, onOpen, onBack }: {
  state?: SuperagentState
  onAccept: (input: { title: string; scope: string; requester: string; ruleIds: string[] }) => Promise<void>
  onStop: (id: string, reason: string) => Promise<void>
  onSave: (settings: SuperagentState['settings']) => Promise<void>
  onOpen: (conversationId: number) => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<Tab>('overview')
  const [draft, setDraft] = useState(state?.settings)
  const [form, setForm] = useState({ title: '', scope: '', requester: '', ruleIds: [] as string[] })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => setDraft(state?.settings), [state?.settings])
  if (!state || !draft) return <section className={css.page}><p className={css.muted}>正在读取 Superagent…</p></section>
  const attention = state.tickets.filter(ticket => ticket.stage === 'attention')
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') } finally { setBusy('') }
  }
  return <section className={css.page} aria-label="Superagent">
    <header className={css.header}>
      <div><Button size="sm" variant="ghost" icon={<IconChevronLeftOutlineRegular />} onClick={onBack}>返回会话</Button><div className={css.titleRow}><h1>Superagent</h1><span>策略 {state.policyVersion}</span></div><p>本地工单与授权。GitHub、飞书和自动 PR 未接入。</p></div>
    </header>
    <nav className={css.tabs} aria-label="Superagent 页面">{(['overview', 'tickets', 'policy'] as const).map(id => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{{ overview: '总览', tickets: '工单', policy: '策略' }[id]}</button>)}</nav>
    {error && <p className={css.alert} role="alert"><IconWarningOutlineRegular />{error}</p>}
    {tab === 'overview' && <div className={css.metrics}>
      <article><span>待人工决定</span><strong>{attention.length}</strong><p>{attention[0]?.title ?? '没有等待处理的工单'}</p></article>
      <article><span>执行中</span><strong>{state.tickets.filter(ticket => ticket.stage === 'working').length}</strong><p>{state.settings.paused ? '处理已暂停' : `模式 ${{ off: '关闭', observe: '观察', auto: '自动' }[state.settings.mode]}`}</p></article>
      <article><span>外部来源</span><strong>0</strong><p>GitHub 与飞书均未启用</p></article>
    </div>}
    {tab === 'tickets' && <div className={css.work}>
      <form className={css.card} onSubmit={event => { event.preventDefault(); void run('accept', async () => { await onAccept(form); setForm({ title: '', scope: '', requester: '', ruleIds: [] }) }) }}>
        <h2>人工接单</h2>
        <label>标题<input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required /></label>
        <label>范围<textarea value={form.scope} onChange={event => setForm({ ...form, scope: event.target.value })} required /></label>
        <label>请求人<input value={form.requester} onChange={event => setForm({ ...form, requester: event.target.value })} required /></label>
        <fieldset><legend>匹配规则</legend><div>{draft.rules.filter(rule => rule.enabled).map(rule => <label key={rule.id} className={css.check}><input type="checkbox" checked={form.ruleIds.includes(rule.id)} onChange={event => setForm({ ...form, ruleIds: event.target.checked ? [...form.ruleIds, rule.id] : form.ruleIds.filter(id => id !== rule.id) })} /><span>{rule.name}</span></label>)}</div></fieldset>
        <Button type="submit" disabled={Boolean(busy)}>{busy === 'accept' ? '接单中…' : '接单并创建会话'}</Button>
      </form>
      <ul className={css.list}>{state.tickets.length === 0 && <li className={css.card}><p className={css.muted}>还没有工单。</p></li>}{state.tickets.map(ticket => <li className={css.card} key={ticket.id}><div className={css.ticketHead}><h3>{ticket.title}</h3><span data-stage={ticket.stage}>{stageLabel[ticket.stage]}</span></div><p>{ticket.scope}</p><small>{ticket.requester} · {ticket.ruleIds.join('、')} · {ticket.policyVersion}</small>{ticket.report && <p className={css.report}>{ticket.report}</p>}<div className={css.actions}>{ticket.conversationId && <Button size="sm" variant="ghost" onClick={() => onOpen(ticket.conversationId!)}>打开会话</Button>}{ticket.stage !== 'ended' && <Button size="sm" variant="ghost" disabled={busy === ticket.id} onClick={() => { void run(ticket.id, () => onStop(ticket.id, '由人工停止')) }}>停止</Button>}</div></li>)}</ul>
    </div>}
    {tab === 'policy' && <form className={`${css.card} ${css.policy}`} onSubmit={event => { event.preventDefault(); void run('save', () => onSave(draft)) }}>
      <h2>授权策略</h2>
      <label className={css.check}><input type="checkbox" checked={draft.paused} onChange={event => setDraft({ ...draft, paused: event.target.checked })} /><span>暂停处理</span></label>
      <label>评估模式<select value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value as SuperagentState['settings']['mode'] })}><option value="off">关闭</option><option value="observe">观察</option><option value="auto">自动</option></select></label>
      <label>允许的请求人<textarea value={draft.allowed.join('\n')} placeholder="每行一个；留空表示不限制" onChange={event => setDraft({ ...draft, allowed: event.target.value.split('\n').map(item => item.trim()).filter(Boolean) })} /></label>
      {draft.rules.map((rule, index) => <fieldset key={rule.id}><label className={css.check}><input type="checkbox" checked={rule.enabled} onChange={event => setDraft({ ...draft, rules: draft.rules.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item) })} /><span>{rule.name}</span></label><textarea aria-label={`${rule.name}说明`} value={rule.instruction} onChange={event => setDraft({ ...draft, rules: draft.rules.map((item, itemIndex) => itemIndex === index ? { ...item, instruction: event.target.value } : item) })} /></fieldset>)}
      <Button type="submit" disabled={Boolean(busy)}>{busy === 'save' ? '保存中…' : '保存策略'}</Button>
    </form>}
  </section>
}
