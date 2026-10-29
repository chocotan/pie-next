import { useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DeleteDialog.module.css'

export function DeleteDialog({ open, title, description, onClose, onConfirm }: {
  open: boolean
  title: string
  description: string
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = (): void => { if (!busy) onClose() }
  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    try { await onConfirm(); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败') } finally { setBusy(false) }
  }
  return <Modal open={open} onClose={close} title={title} closeLabel="关闭删除确认" description={description}
    footer={<div className={css.footer}><button type="button" className={css.cancel} disabled={busy} onClick={close}>取消</button><button type="button" className={css.danger} data-modal-autofocus disabled={busy} onClick={() => { void confirm() }}>{busy ? '删除中…' : '删除'}</button></div>}>
    {error && <p className={css.error} role="alert">{error}</p>}
  </Modal>
}
