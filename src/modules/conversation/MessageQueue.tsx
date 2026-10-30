import { IconCloseOutlineRegular, IconQueueOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueuedMessage } from '../session/types.ts'
import css from './MessageQueue.module.css'

export function MessageQueue({ items, onRemove }: { items: QueuedMessage[]; onRemove: (submissionId: string) => void }) {
  if (items.length === 0) return null
  return <section className={css.root} aria-label="待发送消息" aria-live="polite">
    <div className={css.header}><IconQueueOutlineRegular /><strong>排队中 {items.length} 条</strong><span>将按顺序发送</span></div>
    <ol className={css.list}>{items.map((item, index) => <li key={item.id}><span className={css.index}>{index + 1}</span><span className={css.content} title={item.content}>{item.content}</span><span className={css.mode}>{item.mode === 'steer' ? '插队' : '等待'}</span><button type="button" className={css.remove} aria-label={`删除排队消息 ${index + 1}`} title="删除排队消息" onClick={() => onRemove(item.id)}><IconCloseOutlineRegular /></button></li>)}</ol>
  </section>
}
