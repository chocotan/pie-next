import { useState } from 'react'
import type { EntryRecord } from '@earendil-works/pi-durable'
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai'
import type { TrajectoryCellProps } from './TrajectoryCell.tsx'
import css from './TrajectoryTable.module.css'

export function TrajectoryView({ entries }: { entries: EntryRecord[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const rows: TrajectoryCellProps[] = []
  for (const entry of entries) {
    const message = entry.model?.[0]
    if (!message) continue
    if (entry.kind === 'pi.system') rows.push({ index: entry.id, kind: 'system' as const, text: 'System Prompt · 扩展与工具快照', timeSeconds: null })
    if (entry.kind === 'pi.compaction') rows.push({ index: entry.id, kind: 'compacted' as const, text: contentText(message), timeSeconds: null })
    if (entry.kind === 'pi.reset') rows.push({ index: entry.id, kind: 'context' as const, text: contentText(message), timeSeconds: null })
    if (message.role === 'user') rows.push({ index: entry.id, kind: 'user' as const, text: contentText(message), timeSeconds: null })
    if (message.role === 'assistant') {
      const assistant = message as AssistantMessage
      rows.push({ index: entry.id, kind: 'message' as const, text: contentText(message), timeSeconds: assistant.durationMs ? assistant.durationMs / 1000 : null, input: assistant.usage.input, output: assistant.usage.output, think: assistant.usage.reasoning })
    }
    if (message.role === 'toolResult') {
      const result = message as ToolResultMessage
      rows.push({ index: entry.id, kind: 'tool' as const, text: `${result.toolName} · ${contentText(result)}`, timeSeconds: result.durationMs ? result.durationMs / 1000 : null })
    }
  }
  return <div className={css.tablePane}><table className={css.table} data-scroll-ready="true"><thead><tr><th className={css.eventColumn}><span className={css.eventHeader}>事件</span></th><th className={css.contentColumn}>内容</th></tr></thead><tbody>
    {rows.map(row => <tr key={row.index} data-selected={selected === row.index || undefined} tabIndex={0} onClick={() => setSelected(row.index)} onKeyDown={event => { if (event.key === 'Enter') setSelected(row.index) }}><td className={css.event}><span className={css.turnLabel}>#{row.index}</span><div className={css.eventInner}><span className={css.kindSlot}><span className={`${css.kindTag} ${kindClass(row.kind)}`}><span className={css.kindTagLabel}>{kindLabel(row.kind)}</span></span></span></div></td><td className={css.content}><span className={css.contentText}>{row.text}</span></td></tr>)}
  </tbody></table></div>
}

function kindClass(kind: TrajectoryCellProps['kind']): string {
  return kind === 'system' || kind === 'compacted' ? css.systemNeutral : kind === 'context' ? css.contextGreen : kind === 'message' ? css.assistantVioletBright : kind === 'tool' || kind === 'subtool' ? css.toolAmber : css[kind]
}

function kindLabel(kind: TrajectoryCellProps['kind']): string {
  return ({ system: 'SYSTEM', user: 'USER', context: 'CONTEXT', compacted: 'COMPACTED', message: 'ASSISTANT', tool: 'TOOL', subtool: 'SUBTOOL' } as const)[kind]
}

function contentText(message: { content: unknown }): string {
  const content = message.content
  if (typeof content === 'string') return content.slice(0, 240)
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part !== 'object' || part === null) return ''
    if ('text' in part) return String((part as { text?: unknown }).text ?? '')
    if (part.type === 'toolCall') return `${String((part as { name?: unknown }).name)}(${JSON.stringify((part as { arguments?: unknown }).arguments)})`
    if (part.type === 'thinking') return '[thinking]'
    return ''
  }).join(' ').slice(0, 240)
}
