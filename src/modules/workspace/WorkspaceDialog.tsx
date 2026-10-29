import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkspaceDialog.module.css'

export function WorkspaceDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (path: string) => Promise<void> }) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => { if (!busy) onClose() }
  const add = async () => {
    if (!path.trim() || busy) return
    setBusy(true); setError('')
    try { await onAdd(path.trim()); setPath(''); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : '工作区添加失败') } finally { setBusy(false) }
  }
  return <Modal open={open} onClose={close} title="添加工作区" description="输入本机已有目录的绝对路径。切换后历史仍分别保存，但当前 Host 的后台任务会停止。" closeLabel="关闭添加工作区" className={css.dialog} footer={<><Button variant="outline" disabled={busy} onClick={close}>取消</Button><Button variant="primary" disabled={!path.trim() || busy} onClick={() => { void add() }}>{busy ? '添加中…' : '添加并切换'}</Button></>}>
    <label className={css.field}>工作区路径<input data-modal-autofocus aria-label="工作区路径" value={path} onChange={event => setPath(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add() } }} placeholder="/absolute/path/to/workspace" disabled={busy} /></label>
    {error && <p className={css.error} role="alert">{error}</p>}
  </Modal>
}
