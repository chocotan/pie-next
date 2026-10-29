import { useEffect, useState } from 'react'
import type { BuiltinPluginId, PluginInfo, RuntimeSettings } from '../session/types.ts'
import { SelectMenu } from '../ui/SelectMenu.tsx'
import css from './PluginSettings.module.css'

export function PluginSettings({ plugins, models, runtime, onToggle, onRuntime, onCompact }: {
  plugins: PluginInfo[]
  models: Array<{ provider: string; modelId: string }>
  runtime: RuntimeSettings
  onToggle: (id: BuiltinPluginId, enabled: boolean) => Promise<void>
  onRuntime: (settings: RuntimeSettings) => Promise<void>
  onCompact: () => Promise<void>
}) {
  const [draft, setDraft] = useState(runtime)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => setDraft(runtime), [runtime])
  const compactionEnabled = plugins.find(plugin => plugin.id === 'compaction')?.enabled ?? true
  const compactValue = draft.compactModel ? `${draft.compactModel.provider}/${draft.compactModel.modelId}` : ''
  const modelOptions = [
    { value: '', label: '跟随当前会话模型' },
    ...(compactValue && !models.some(model => `${model.provider}/${model.modelId}` === compactValue) ? [{ value: compactValue, label: `${compactValue}（不可用）` }] : []),
    ...models.map(model => ({ value: `${model.provider}/${model.modelId}`, label: `${model.provider}/${model.modelId}` })),
  ]
  const run = async (key: string, action: () => Promise<void>, message?: string) => {
    if (busy) return
    setBusy(key); setError(''); setNotice('')
    try { await action(); if (message) setNotice(message) } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') } finally { setBusy('') }
  }
  return <div className={css.root}>
    <section className={css.section} aria-labelledby="builtin-plugins">
      <h2 id="builtin-plugins">内置插件</h2>
      <p className={css.intro}>插件直接为 AI 提供工具。启停后会自动重载当前工作区；正在运行的后台 Shell 会中断。</p>
      <div className={css.plugins}>{plugins.map(plugin => <article className={css.plugin} key={plugin.id}>
        <div className={css.pluginHead}><div><h3>{plugin.name}</h3><span className={css.pluginId}>{plugin.id}</span></div><button type="button" className={css.toggle} data-enabled={plugin.enabled} disabled={Boolean(busy)} aria-label={`${plugin.enabled ? '停用' : '启用'}${plugin.name}`} onClick={() => { void run(`plugin:${plugin.id}`, () => onToggle(plugin.id, !plugin.enabled)) }}>{busy === `plugin:${plugin.id}` ? '重载中…' : plugin.enabled ? '已启用' : '已停用'}</button></div>
        <p>{plugin.description}</p>
        {plugin.tools.length > 0 && <div className={css.tools}>{plugin.tools.map(tool => <code key={tool}>{tool}</code>)}</div>}
      </article>)}</div>
    </section>

    <section className={css.section} aria-labelledby="runtime-policy">
      <h2 id="runtime-policy">运行策略</h2>
      <p className={css.intro}>使用 Durable 原生重试与上下文压缩，设置保存后重载生效。</p>
      <div className={css.policyCard}>
        <div className={css.policyTitle}><h3>Retry</h3><label className={css.check}><input type="checkbox" checked={draft.retry.enabled} onChange={event => setDraft({ ...draft, retry: { ...draft.retry, enabled: event.target.checked } })} />自动重试</label></div>
        <div className={css.fields}>
          <label>最大重试次数<input type="number" min={0} max={20} value={draft.retry.maxRetries} onChange={event => setDraft({ ...draft, retry: { ...draft.retry, maxRetries: Number(event.target.value) } })} /></label>
          <label>初始退避（毫秒）<input type="number" min={0} max={60000} step={100} value={draft.retry.baseDelayMs} onChange={event => setDraft({ ...draft, retry: { ...draft.retry, baseDelayMs: Number(event.target.value) } })} /></label>
          <label>最大退避（毫秒）<input type="number" min={0} max={600000} step={1000} value={draft.retry.maxAgentDelayMs} onChange={event => setDraft({ ...draft, retry: { ...draft.retry, maxAgentDelayMs: Number(event.target.value) } })} /></label>
        </div>
      </div>
      <div className={css.policyCard} data-disabled={!compactionEnabled || undefined}>
        <div className={css.policyTitle}><h3>Compact</h3><label className={css.check}><input type="checkbox" disabled={!compactionEnabled} checked={draft.compaction.enabled && compactionEnabled} onChange={event => setDraft({ ...draft, compaction: { enabled: event.target.checked } })} />自动 Compact</label></div>
        <label className={css.modelField}>Compact 模型<SelectMenu ariaLabel="Compact 模型" value={compactValue} disabled={!compactionEnabled} options={modelOptions} onChange={value => {
          const selected = models.find(model => `${model.provider}/${model.modelId}` === value)
          setDraft({ ...draft, compactModel: selected })
        }} /></label>
        {!compactionEnabled && <p className={css.hint}>Compact 插件已停用，自动 Compact 当前关闭。</p>}
        <button type="button" className={css.secondary} disabled={Boolean(busy) || !compactionEnabled} onClick={() => { void run('compact', onCompact, '已提交当前会话的 Compact 任务。') }}>{busy === 'compact' ? '提交中…' : '立即 Compact 当前会话'}</button>
      </div>
      <div className={css.actions}><button type="button" className={css.primary} disabled={Boolean(busy)} onClick={() => { void run('runtime', () => onRuntime(draft)) }}>{busy === 'runtime' ? '保存并重载中…' : '保存运行策略'}</button></div>
      {error && <p className={css.error} role="alert">{error}</p>}
      {notice && <p className={css.notice} role="status">{notice}</p>}
    </section>
  </div>
}
