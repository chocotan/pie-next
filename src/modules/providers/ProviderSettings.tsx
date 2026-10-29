import { useState } from 'react'
import { IconPlusOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProviderProfile } from '../session/types.ts'
import { SelectMenu } from '../ui/SelectMenu.tsx'
import { ApiKeyInput } from './ApiKeyInput.tsx'
import { EditorFooter } from './EditorFooter.tsx'
import styles from './ModelsSection.module.css'

const blank: ProviderProfile = { id: '', name: '', protocol: 'openai-completions', baseUrl: '', models: '', enabled: true, hasKey: false }
const text = (key: string) => ({ cancel: '取消', save: '保存', saving: '保存中…', keyReveal: '显示当前输入', keyHide: '隐藏输入' }[key] ?? key)

function validationError(draft: ProviderProfile, requireModels: boolean): string | undefined {
  if (!/^[a-z][a-z0-9-]*$/.test(draft.id)) return 'Provider ID 需以小写字母开头，只能包含小写字母、数字和连字符。'
  if (!draft.name.trim()) return '请填写显示名称。'
  if (requireModels && !draft.models.trim()) return '请填写或同步至少一个模型 ID。'
  try {
    const url = new URL(draft.baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
  } catch { return 'Base URL 必须是完整的 HTTP(S) 地址。' }
  return undefined
}

export function ProviderSettings({ providers, onChange, onSync }: {
  providers: ProviderProfile[]
  onChange: (providers: ProviderProfile[], apiKey?: string, editingId?: string) => void | Promise<void>
  onSync: (profile: ProviderProfile, apiKey?: string) => Promise<string[]>
}) {
  const [draft, setDraft] = useState<ProviderProfile | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncedModels, setSyncedModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const pending = busy || syncing
  const edit = (provider: ProviderProfile) => { setDraft({ ...provider }); setEditingId(provider.id || null); setKey(''); setError(''); setSyncedModels([]); setSelectedModels([]) }
  const close = () => { if (!pending) { setDraft(null); setSyncedModels([]); setSelectedModels([]) } }

  const save = async () => {
    if (!draft) return
    const invalid = validationError(draft, true) ?? (editingId === null && providers.some(p => p.id === draft.id) ? 'Provider ID 已存在。' : undefined)
    if (invalid) return setError(invalid)
    setBusy(true); setError('')
    try {
      const next = { ...draft, hasKey: draft.hasKey || key.length > 0 }
      await onChange(editingId === null ? [...providers, next] : providers.map(p => p.id === editingId ? next : p), key || undefined, editingId ?? undefined)
      setDraft(null); setSyncedModels([]); setSelectedModels([])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Provider 保存失败。') } finally { setBusy(false) }
  }

  const sync = async () => {
    if (!draft) return
    const invalid = validationError(draft, false)
    if (invalid) return setError(invalid)
    setSyncing(true); setError('')
    try {
      const models = [...new Set((await onSync(draft, key || undefined)).map(model => model.trim()).filter(Boolean))]
      const existing = new Set(draft.models.split(',').map(model => model.trim()).filter(Boolean))
      setSyncedModels(models)
      setSelectedModels(models.filter(model => !existing.has(model)))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '模型同步失败。') } finally { setSyncing(false) }
  }

  const addSelected = () => {
    if (!draft || selectedModels.length === 0) return
    const existing = draft.models.split(',').map(model => model.trim()).filter(Boolean)
    setDraft({ ...draft, models: [...new Set([...existing, ...selectedModels])].join(', ') })
    setSelectedModels([])
  }

  const toggle = (provider: ProviderProfile) => {
    setError('')
    void Promise.resolve(onChange(providers.map(p => p.id === provider.id ? { ...p, enabled: !p.enabled } : p))).catch(cause => {
      setError(cause instanceof Error ? cause.message : 'Provider 状态更新失败。')
    })
  }

  return <>
    <section className={styles.section}>
      <h2 className={styles.title}>模型提供方</h2>
      <p className={styles.intro}>配置 OpenAI、Anthropic 或兼容端点。API Key 只写不读，已有密钥不会回显。</p>
      {error && !draft && <p className={styles.error} role="alert">{error}</p>}
      <ul className={styles.rows}>{providers.map(provider => <li className={styles.rowCard} key={provider.id}>
        <div className={styles.rowHead}><div className={styles.rowIdentity}><span className={`${styles.credentialDot} ${provider.hasKey ? styles.credentialDotConfigured : styles.credentialDotMissing}`} /><span className={styles.rowName}>{provider.name}</span><span className={styles.rowTag}>{provider.protocol}</span></div><div className={styles.rowActions}><button type="button" className={styles.secondaryButton} onClick={() => edit(provider)}>编辑</button><button type="button" className={styles.secondaryButton} onClick={() => toggle(provider)}>{provider.enabled ? '停用' : '启用'}</button></div></div>
        <div className={styles.advancedHint}>{provider.models}<br />{provider.baseUrl}</div>
      </li>)}</ul>
      <div className={styles.addBlock}><div className={styles.addActions}><button type="button" className={styles.addButton} onClick={() => edit({ ...blank })}><IconPlusOutlineRegular />添加 Provider</button></div></div>
    </section>
    <Modal open={draft !== null} onClose={close} title={editingId === null ? '添加 Provider' : `编辑 ${draft?.name ?? 'Provider'}`} description="配置连接与模型，API Key 仅保存在服务端。" closeLabel="关闭 Provider 编辑" className={styles.editorDialog} contentClassName={styles.editorContent} footer={<EditorFooter t={text} busy={pending} submitDisabled={pending} submitLabelKey="save" submitBusyLabelKey="saving" onCancel={close} onSubmit={() => { void save() }} />}>
      {draft && <div className={styles.editor}>
        <fieldset className={styles.fields} disabled={pending}>
          <div className={styles.field}><span className={styles.fieldLabel}>Provider ID</span><input className={styles.input} aria-label="Provider ID" value={draft.id} disabled={editingId !== null} onChange={e => setDraft({ ...draft, id: e.target.value })} placeholder="acme-ai" /></div>
          <div className={styles.field}><span className={styles.fieldLabel}>显示名称</span><input className={styles.input} aria-label="显示名称" data-modal-autofocus value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Acme AI" /></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Base URL</span><input className={styles.input} aria-label="Base URL" value={draft.baseUrl} onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" /></div>
          <div className={styles.field}><span className={styles.fieldLabel}>API 协议</span><SelectMenu className={styles.input} ariaLabel="API 协议" value={draft.protocol} options={[{ value: 'openai-completions', label: 'OpenAI Chat Completions' }, { value: 'openai-responses', label: 'OpenAI Responses' }, { value: 'anthropic-messages', label: 'Anthropic Messages' }]} onChange={protocol => setDraft({ ...draft, protocol: protocol as ProviderProfile['protocol'] })} /></div>
          <div className={styles.field}><span className={styles.fieldLabel}>API Key</span><ApiKeyInput t={text} value={key} aria-label="API Key" onChange={e => setKey(e.target.value)} placeholder={draft.hasKey ? '已保存；留空表示不修改' : '输入 API Key（可选）'} /></div>
          <div className={styles.field}><span className={styles.fieldLabel}>模型 ID<button type="button" className={styles.linkButton} disabled={pending} onClick={() => { void sync() }}>{syncing ? '同步中…' : '同步模型'}</button></span><input className={styles.input} aria-label="模型 ID" value={draft.models} onChange={e => setDraft({ ...draft, models: e.target.value })} placeholder="model-a, model-b" />
            {syncedModels.length > 0 && <div className={styles.syncedModels}>
              <div className={styles.candidateToolbar}><span className={styles.advancedHint}>已选 {selectedModels.length} 个模型</span><button type="button" className={styles.addModelButton} disabled={pending || selectedModels.length === 0} onClick={addSelected}>添加所选模型</button></div>
              <ul className={`${styles.candidateList} ${styles.syncedModelList}`} aria-label="同步到的模型">{syncedModels.map(model => <li className={styles.candidate} key={model}><label className={styles.candidateLabel}><input type="checkbox" checked={selectedModels.includes(model)} onChange={e => setSelectedModels(current => e.target.checked ? [...current, model] : current.filter(id => id !== model))} /><span className={styles.candidateId} title={model}>{model}</span></label></li>)}</ul>
            </div>}
            <p className={styles.advancedHint}>从 Provider 获取模型列表，或多个模型用逗号分隔。</p></div>
        </fieldset>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>}
    </Modal>
  </>
}
