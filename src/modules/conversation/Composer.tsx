import { useEffect, useRef } from 'react'
import { IconShieldOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ThinkingLevel } from '../session/types.ts'
import { SelectMenu } from '../ui/SelectMenu.tsx'
import css from './InputBar.module.css'

type ModelSelection = { provider: string; modelId: string }

export function Composer({ draft, onDraft, onSend, onStop, busy, model, modelProvider, models, onModel, thinkingLevel, onThinkingLevel, permission, onPermission, stats }: {
  draft: string
  onDraft: (value: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  model: string
  modelProvider?: string
  models: ModelSelection[]
  onModel: (model: ModelSelection) => void
  thinkingLevel?: ThinkingLevel
  onThinkingLevel: (level?: ThinkingLevel) => void
  permission: 'allow-all' | 'approve'
  onPermission: (mode: 'allow-all' | 'approve') => void
  stats: string
}) {
  const editor = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!draft && editor.current?.textContent) editor.current.textContent = '' }, [draft])
  const modelValue = modelProvider ? `${modelProvider}/${model}` : ''
  const missingModel = modelValue !== '' && !models.some(item => `${item.provider}/${item.modelId}` === modelValue)
  const modelOptions = [
    ...(missingModel ? [{ value: modelValue, label: `${model}（不可用）` }] : []),
    ...models.map(item => ({ value: `${item.provider}/${item.modelId}`, label: item.modelId })),
  ]
  return <div className={css.root}>
    <div className={css.card} data-composer-card>
      <div className={css.scroll}><div ref={editor} className={css.input} role="textbox" aria-label="发送消息" aria-multiline contentEditable suppressContentEditableWarning onInput={event => onDraft(event.currentTarget.textContent ?? '')} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend() }
      }} />{!draft && <div className={css.placeholder}>给智能体发消息</div>}</div>
      <div className={css.row}>
        <div className={css.tools}>
          <div className={css.modes}><IconShieldOutlineRegular /><SelectMenu ariaLabel="工具权限" value={permission} options={[{ value: 'allow-all', label: '允许全部' }, { value: 'approve', label: '执行前审批' }]} onChange={mode => onPermission(mode as 'allow-all' | 'approve')} /><SelectMenu ariaLabel="Thinking Level" value={thinkingLevel ?? ''} options={[{ value: '', label: '思考：默认' }, { value: 'off', label: '思考：关闭' }, { value: 'minimal', label: '思考：极简' }, { value: 'low', label: '思考：低' }, { value: 'medium', label: '思考：中' }, { value: 'high', label: '思考：高' }, { value: 'xhigh', label: '思考：超高' }, { value: 'max', label: '思考：最高' }]} onChange={level => onThinkingLevel(level === '' ? undefined : level as ThinkingLevel)} /></div>
        </div>
        <div className={css.trailing}><div className={css.standardControls}><SelectMenu ariaLabel="模型" value={modelValue} placeholder="未配置模型" disabled={models.length === 0} options={modelOptions} onChange={value => {
          const selected = models.find(item => `${item.provider}/${item.modelId}` === value)
          if (selected) onModel(selected)
        }} /></div>
          {busy && <Tooltip label="停止当前运行" side="top" delayMs={500}><button type="button" className={css.primary} aria-label="停止当前运行" onClick={onStop}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" /></svg></button></Tooltip>}
          <Tooltip label="发送消息" side="top" delayMs={500}><button type="button" className={css.primary} aria-label="发送消息" disabled={!draft.trim()} onClick={onSend}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M8.3125.98c.355.073.667.224.95.452.225.181.468.426.717.675l4.727 4.728-1.414 1.414L9 3.956v11.086H7V3.956L2.707 8.25 1.293 6.835 6.02 2.107c.25-.25.493-.495.718-.675.24-.192.547-.388.95-.452.21-.033.416-.025.625 0Z" fill="currentColor" /></svg></button></Tooltip>
        </div>
      </div>
    </div>
    <div className={css.dock} data-composer-dock>{stats}</div>
  </div>
}
