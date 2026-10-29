import { useState } from 'react'
import { IconPlusOutlineRegular, StateDot, TerminalBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BackgroundTask } from '../session/types.ts'
import { terminalLabels } from './ToolsPanel.tsx'
import css from './BackgroundPanel.module.css'

const statusText = { running: '进行中', completed: '已完成', failed: '失败', stopped: '已停止', interrupted: '已中断' } as const

export function BackgroundPanel({ tasks, onStart, onStop }: {
  tasks: Record<string, BackgroundTask>
  onStart: (command: string, title?: string) => Promise<void>
  onStop: (id: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [command, setCommand] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const ordered = Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt)
  const current = ordered.find(task => task.id === selectedId) ?? ordered[0]
  const start = async () => {
    if (!command.trim() || pending) return
    setPending(true); setError('')
    try { await onStart(command.trim(), title.trim() || undefined); setCommand(''); setTitle('') } catch (cause) { setError(cause instanceof Error ? cause.message : '后台任务启动失败') } finally { setPending(false) }
  }
  const stop = async (id: string) => {
    setPending(true); setError('')
    try { await onStop(id) } catch (cause) { setError(cause instanceof Error ? cause.message : '后台任务停止失败') } finally { setPending(false) }
  }
  return <div className={css.root}>
    <form className={css.form} onSubmit={event => { event.preventDefault(); void start() }}>
      <label>任务名称<input aria-label="任务名称" value={title} onChange={event => setTitle(event.target.value)} placeholder="可选" /></label>
      <label>Shell 命令<textarea aria-label="Shell 命令" value={command} onChange={event => setCommand(event.target.value)} placeholder="例如：npm run dev" required /></label>
      <button type="submit" className={css.start} disabled={!command.trim() || pending}><IconPlusOutlineRegular />{pending ? '提交中…' : '启动后台任务'}</button>
    </form>
    {error && <p className={css.error} role="alert">{error}</p>}
    <div className={css.tasks}>{ordered.map(task => <button type="button" className={css.task} data-active={task.id === current?.id || undefined} key={task.id} onClick={() => setSelectedId(task.id)}>
      <span className={css.taskHead}><strong>{task.title || task.command}</strong><span className={css.status} data-status={task.status}><StateDot state={task.status === 'running' ? 'ongoing' : task.status === 'completed' ? 'done' : task.status === 'failed' ? 'error' : 'idle'} />{statusText[task.status]}</span></span>
      <span className={css.command}>{task.command}</span>
    </button>)}</div>
    {current ? <section className={css.output} aria-label="后台任务输出"><div className={css.outputHead}><span>PID {current.pid ?? '—'}{current.exitCode !== undefined ? ` · 退出码 ${current.exitCode}` : ''}</span>{current.status === 'running' && <button type="button" className={css.stop} disabled={pending} onClick={() => { void stop(current.id) }}>停止</button>}</div><TerminalBlock key={current.id} command={current.command} output={current.output} running={current.status === 'running'} labels={terminalLabels} /></section> : <p className={css.empty}>暂无后台任务</p>}
  </div>
}
