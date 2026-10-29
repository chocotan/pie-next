// DSH standalone TrajectoryCell with the Durable row contract.
import css from './TrajectoryCell.module.css'

export interface TrajectoryCellProps {
  index: number
  kind: 'system' | 'user' | 'context' | 'compacted' | 'message' | 'tool' | 'subtool'
  text: string
  timeSeconds: number | null
  input?: number
  output?: number
  think?: number
  selected?: boolean
}

const labels = { system: 'SYSTEM', user: 'USER', context: 'CONTEXT', compacted: 'COMPACTED', message: 'ASSISTANT', tool: 'TOOL', subtool: 'SUBTOOL' }
const tagClass = { system: css.tagSystem, user: css.tagUser, context: css.tagContext, compacted: css.tagSystem, message: css.tagMessage, tool: css.tagTool, subtool: css.tagSubtool }

export function TrajectoryCell({ index, kind, text, timeSeconds, input, output, think, selected = false }: TrajectoryCellProps) {
  return <div className={`${css.root} ${selected ? css.selected : ''}`} data-kind={kind} data-selected={selected || undefined}>
    <span className={css.index}>#{index}</span>
    <span className={css.tagSlot}><span className={`${css.tag} ${tagClass[kind]}`}>{labels[kind]}</span></span>
    <span className={css.text}>{text}</span>
    <span className={css.trailing}>
      {kind === 'message' && <><span className={css.metric}>{input ?? ''}</span><span className={css.metric}>{output ?? ''}</span><span className={css.metric}>{think ?? ''}</span></>}
      <span className={css.time}>{timeSeconds === null ? '—' : `${Math.round(timeSeconds * 1000).toLocaleString()} ms`}</span>
    </span>
  </div>
}
