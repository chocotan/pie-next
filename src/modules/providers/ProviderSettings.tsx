import { useState } from 'react'
import { IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProviderProfile } from '../session/types.ts'
import { ApiKeyInput } from './ApiKeyInput.tsx'
import { EditorFooter } from './EditorFooter.tsx'
import styles from './ModelsSection.module.css'

const blank: ProviderProfile = { id: '', name: '', protocol: 'openai-completions', baseUrl: '', models: '', enabled: true, hasKey: false }
const text = (key: string) => ({ cancel: '取消', save: '保存', saving: '保存中…', keyReveal: '显示当前输入', keyHide: '隐藏输入' }[key] ?? key)

export function ProviderSettings({ providers, onChange }: { providers: ProviderProfile[]; onChange: (providers: ProviderProfile[], apiKey?: string, editingId?: string) => void | Promise<void> }) {
  const [draft, setDraft] = useState<ProviderProfile | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const edit = (provider: ProviderProfile) => { setDraft({ ...provider }); setEditingId(provider.id || null); setKey(''); setError('') }
  const save = () => {
    if (!draft) return
    if (!/^[a-z][a-z0-9-]*$/.test(draft.id)) return setError('Provider ID 需以小写字母开头，只能包含小写字母、数字和连字符。')
    if (editingId === null && providers.some(p => p.id === draft.id)) return setError('Provider ID 已存在。')
    if (!draft.name.trim() || !draft.models.trim()) return setError('请填写显示名称和至少一个模型 ID。')
    try { new URL(draft.baseUrl) } catch { return setError('Base URL 必须是完整的 HTTP(S) 地址。') }
    const next = { ...draft, hasKey: draft.hasKey || key.length > 0 }
    void onChange(editingId === null ? [...providers, next] : providers.map(p => p.id === editingId ? next : p), key || undefined, editingId ?? undefined)
    setDraft(null)
  }
  return <section className={styles.section}>
    <h2 className={styles.title}>模型提供方</h2>
    <p className={styles.intro}>配置 OpenAI、Anthropic 或兼容端点。API Key 只写不读，已有密钥不会回显。</p>
    {draft && <div className={styles.editor}>
      <div className={styles.editorHeader}><h3 className={styles.editorTitle}>{editingId === null ? '添加自定义 Provider' : `编辑 ${draft.name}`}</h3><span className={styles.editorRoute}>{draft.id || 'custom-provider'}</span></div>
      <div className={styles.field}><span className={styles.fieldLabel}>Provider ID</span><input className={styles.input} aria-label="Provider ID" value={draft.id} disabled={editingId !== null} onChange={e => setDraft({ ...draft, id: e.target.value })} placeholder="acme-ai" /></div>
      <div className={styles.field}><span className={styles.fieldLabel}>显示名称</span><input className={styles.input} aria-label="显示名称" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Acme AI" /></div>
      <div className={styles.field}><span className={styles.fieldLabel}>Base URL</span><input className={styles.input} aria-label="Base URL" value={draft.baseUrl} onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" /></div>
      <div className={styles.field}><span className={styles.fieldLabel}>API 协议</span><select className={`${styles.input} ${styles.selectInput}`} aria-label="API 协议" value={draft.protocol} onChange={e => setDraft({ ...draft, protocol: e.target.value })}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></div>
      <div className={styles.field}><span className={styles.fieldLabel}>模型 ID</span><input className={styles.input} aria-label="模型 ID" value={draft.models} onChange={e => setDraft({ ...draft, models: e.target.value })} placeholder="model-a, model-b" /><p className={styles.advancedHint}>多个模型用逗号分隔</p></div>
      <div className={styles.field}><span className={styles.fieldLabel}>API Key</span><ApiKeyInput t={text} value={key} aria-label="API Key" onChange={e => setKey(e.target.value)} placeholder={draft.hasKey ? '已保存；留空表示不修改' : '输入 API Key（可选）'} /></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <EditorFooter t={text} busy={false} submitDisabled={false} submitLabelKey="save" submitBusyLabelKey="saving" onCancel={() => setDraft(null)} onSubmit={save} />
    </div>}
    <ul className={styles.rows}>{providers.map(provider => <li className={styles.rowCard} key={provider.id}>
      <div className={styles.rowHead}><div className={styles.rowIdentity}><span className={`${styles.credentialDot} ${provider.hasKey ? styles.credentialDotConfigured : styles.credentialDotMissing}`} /><span className={styles.rowName}>{provider.name}</span><span className={styles.rowTag}>{provider.protocol}</span></div><div className={styles.rowActions}><button type="button" className={styles.secondaryButton} onClick={() => edit(provider)}>编辑</button><button type="button" className={styles.secondaryButton} onClick={() => onChange(providers.map(p => p.id === provider.id ? { ...p, enabled: !p.enabled } : p))}>{provider.enabled ? '停用' : '启用'}</button></div></div>
      <div className={styles.advancedHint}>{provider.models}<br />{provider.baseUrl}</div>
    </li>)}</ul>
    <div className={styles.addBlock}><div className={styles.addActions}><button type="button" className={styles.addButton} onClick={() => edit({ ...blank })}><IconPlusOutlineRegular />添加 Provider</button></div></div>
  </section>
}
