import { useEffect, useRef } from 'react'
import { IconChevronDownOutlineRegular, IconPlusOutlineMedium, IconShieldOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './InputBar.module.css'

export function Composer({ draft, onDraft, onSend, onStop, busy, model, stats }: {
  draft: string
  onDraft: (value: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  model: string
  stats: string
}) {
  const editor = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!draft && editor.current?.textContent) editor.current.textContent = '' }, [draft])
  return <div className={css.root}>
    <div className={css.card} data-composer-card>
      <div className={css.scroll}><div ref={editor} className={css.input} role="textbox" aria-label="发送消息" aria-multiline contentEditable suppressContentEditableWarning onInput={event => onDraft(event.currentTarget.textContent ?? '')} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend() }
      }} />{!draft && <div className={css.placeholder}>给智能体发消息</div>}</div>
      <div className={css.row}>
        <div className={css.tools}>
          <Tooltip label="命令与附件" side="top" delayMs={500}><button type="button" className={css.add} aria-label="命令与附件"><IconPlusOutlineMedium size={14} /></button></Tooltip>
          <div className={css.modes}><IconShieldOutlineRegular /><span>Workspace Write</span><IconChevronDownOutlineRegular /></div>
        </div>
        <div className={css.trailing}><div className={css.standardControls}><span className={css.select}>{model}</span>{busy && <span className={css.pending} aria-label="正在运行" />}</div>
          {busy && <Tooltip label="停止当前运行" side="top" delayMs={500}><button type="button" className={css.primary} aria-label="停止当前运行" onClick={onStop}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" /></svg></button></Tooltip>}
          <Tooltip label="发送消息" side="top" delayMs={500}><button type="button" className={css.primary} aria-label="发送消息" disabled={!draft.trim()} onClick={onSend}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M8.3125.98c.355.073.667.224.95.452.225.181.468.426.717.675l4.727 4.728-1.414 1.414L9 3.956v11.086H7V3.956L2.707 8.25 1.293 6.835 6.02 2.107c.25-.25.493-.495.718-.675.24-.192.547-.388.95-.452.21-.033.416-.025.625 0Z" fill="currentColor" /></svg></button></Tooltip>
        </div>
      </div>
    </div>
    <div className={css.dock} data-composer-dock>{stats}</div>
  </div>
}
