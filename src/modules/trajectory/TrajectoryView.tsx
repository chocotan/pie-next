import { Fragment, useMemo, useState } from 'react'
import { IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EntryRecord } from '@earendil-works/pi-durable'
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai'
import type { TrajectoryCellProps } from './TrajectoryCell.tsx'
import css from './TrajectoryTable.module.css'

type Row = TrajectoryCellProps & { turn: number }

export function TrajectoryView({ entries }: { entries: EntryRecord[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set())
  const [callsCollapsed, setCallsCollapsed] = useState(false)
  const rows = useMemo(() => {
    const result: Row[] = []
    let turn = 0
    for (const entry of entries) {
      const message = entry.model?.[0]
      if (!message) continue
      if (message.role === 'user') turn++
      const base = { index: entry.id, turn, timeSeconds: null }
      if (entry.kind === 'pi.system') result.push({ ...base, kind: 'system', text: 'System Prompt · 扩展与工具快照' })
      if (entry.kind === 'pi.compaction') result.push({ ...base, kind: 'compacted', text: contentText(message) })
      if (entry.kind === 'pi.reset') result.push({ ...base, kind: 'context', text: contentText(message) })
      if (message.role === 'user') result.push({ ...base, kind: 'user', text: contentText(message) })
      if (message.role === 'assistant') {
        const assistant = message as AssistantMessage
        result.push({ ...base, kind: 'message', text: assistant.stopReason === 'error' ? assistant.errorMessage ?? '模型请求失败' : contentText(message), timeSeconds: assistant.durationMs ? assistant.durationMs / 1000 : null, input: assistant.usage.input, output: assistant.usage.output, think: assistant.usage.reasoning })
      }
      if (message.role === 'toolResult') {
        const tool = message as ToolResultMessage
        result.push({ ...base, kind: 'tool', text: `${tool.toolName} · ${contentText(tool)}`, timeSeconds: tool.durationMs ? tool.durationMs / 1000 : null })
      }
    }
    return result
  }, [entries])
  const turns = useMemo(() => [...new Set(rows.filter(row => row.turn > 0).map(row => row.turn))], [rows])
  const allTurnsCollapsed = turns.length > 0 && turns.every(turn => collapsedTurns.has(turn))
  const visible = rows.filter(row => {
    if (collapsedTurns.has(row.turn) || (callsCollapsed && (row.kind === 'tool' || row.kind === 'subtool'))) return false
    const needle = query.trim().toLocaleLowerCase()
    return !needle || row.text.toLocaleLowerCase().includes(needle) || kindLabel(row.kind).includes(needle)
  })
  const toggleTurn = (turn: number) => {
    setCollapsedTurns(current => {
      const next = new Set(current)
      if (next.has(turn)) next.delete(turn); else next.add(turn)
      return next
    })
  }
  let previousTurn = -1
  return <div className={css.view}>
    <div className={css.toolbar} role="toolbar" aria-label="轨迹工具">
      <div className={css.toolbarActions}>
        <button type="button" className={css.toolbarButton} aria-pressed={allTurnsCollapsed} onClick={() => setCollapsedTurns(allTurnsCollapsed ? new Set() : new Set(turns))}>轮次</button>
        <button type="button" className={css.toolbarButton} aria-pressed={callsCollapsed} onClick={() => setCallsCollapsed(value => !value)}>调用</button>
        <span className={css.eventCount}>{visible.length} 条事件</span>
      </div>
      <label className={css.search}><IconSearchOutlineRegular size={12} /><input type="search" className={css.searchInput} aria-label="搜索轨迹" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    <div className={css.tablePane}><table className={css.table} data-scroll-ready="true"><thead><tr><th className={css.eventColumn}><span className={css.eventHeader}>事件</span></th><th className={css.contentColumn}>内容</th></tr></thead><tbody>
      {visible.map(row => {
        const showTurn = row.turn > 0 && row.turn !== previousTurn
        previousTurn = row.turn
        return <Fragment key={row.index}>{showTurn && <tr className={css.turnHeader}><td colSpan={2}><button type="button" aria-expanded={!collapsedTurns.has(row.turn)} onClick={() => toggleTurn(row.turn)}>第 {row.turn} 轮</button></td></tr>}<tr data-selected={selected === row.index || undefined} tabIndex={0} aria-expanded={selected === row.index} onClick={() => setSelected(current => current === row.index ? null : row.index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(current => current === row.index ? null : row.index) } }}><td className={css.event}><span className={css.turnLabel}>#{row.index}</span><div className={css.eventInner}><span className={css.kindSlot}><span className={`${css.kindTag} ${kindClass(row.kind)}`}><span className={css.kindTagLabel}>{kindLabel(row.kind)}</span></span></span></div></td><td className={css.content}><span className={css.rowMetric}>{metric(row)}</span><span className={css.contentText}>{row.text}</span></td></tr></Fragment>
      })}
      {visible.length === 0 && <tr><td colSpan={2} className={css.noResults}>没有匹配的轨迹事件</td></tr>}
    </tbody></table></div>
  </div>
}

function metric(row: Row): string {
  const parts = []
  if (row.kind === 'message') parts.push(`${row.input ?? 0} in · ${row.output ?? 0} out`)
  if (row.timeSeconds !== null) parts.push(row.timeSeconds >= 1 ? `${row.timeSeconds.toFixed(1)}s` : `${Math.round(row.timeSeconds * 1000)}ms`)
  return parts.join(' · ')
}

function kindClass(kind: TrajectoryCellProps['kind']): string {
  return kind === 'system' || kind === 'compacted' ? css.systemNeutral : kind === 'context' ? css.contextGreen : kind === 'message' ? css.assistantVioletBright : kind === 'tool' || kind === 'subtool' ? css.toolAmber : css[kind]
}

function kindLabel(kind: TrajectoryCellProps['kind']): string {
  return ({ system: '系统', user: '用户', context: '上下文', compacted: '压缩', message: '助手', tool: '工具', subtool: '子工具' } as const)[kind]
}

function contentText(message: { content: unknown }): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part !== 'object' || part === null) return ''
    if ('text' in part) return String((part as { text?: unknown }).text ?? '')
    if (part.type === 'toolCall') return `${String((part as { name?: unknown }).name)}(${JSON.stringify((part as { arguments?: unknown }).arguments)})`
    if (part.type === 'thinking') return '[thinking]'
    return ''
  }).join(' ')
}
