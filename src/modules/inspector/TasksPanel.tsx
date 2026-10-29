import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TodoItem } from '../session/types.ts'
import css from './TasksPanel.module.css'

const statusText = { pending: '待处理', in_progress: '进行中', completed: '已完成', cancelled: '已取消' } as const

export function TasksPanel({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return <p className={css.empty}>暂无任务，模型可通过 TaskCreate 创建。</p>
  const done = todos.filter(item => item.status === 'completed').length
  const complete = done === todos.length
  return <section className={css.card} aria-label="当前任务">
    <div className={css.head}><h3>当前任务</h3><span className={css.badge} data-complete={complete || undefined}>{complete ? '已完成' : `进行中 ${done}/${todos.length}`}</span></div>
    <ul className={css.list}>{todos.map(item => <li key={item.id} data-status={item.status}><span className={css.content}>{item.content}{item.blockedBy?.length ? <small>阻塞于 {item.blockedBy.join('、')}</small> : null}</span><span className={css.status}><StateDot state={item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'ongoing' : 'idle'} />{statusText[item.status]}</span></li>)}</ul>
  </section>
}
