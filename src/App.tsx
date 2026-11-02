import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, IconAgentPresetOutlineRegular, IconSettingsOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { shallowEqual, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { AppFrame, createLayoutStore } from './modules/layout/index.ts'
import type { LayoutSessionsSnapshot, RenderLayoutSlot, SidebarOwnerProps } from './modules/layout/types.ts'
import { SidebarRoot } from './modules/sidebar/SidebarRoot.tsx'
import { AgentTree } from './modules/subagent/AgentTree.tsx'
import { ConversationPanel } from './modules/conversation/ConversationPanel.tsx'
import { InspectorPanel, type InspectorTab } from './modules/inspector/InspectorPanel.tsx'
import { SettingsOverlay } from './modules/settings/SettingsOverlay.tsx'
import { WorkspaceDialog } from './modules/workspace/WorkspaceDialog.tsx'
import { DeleteDialog } from './modules/ui/DeleteDialog.tsx'
import { SuperagentPanel } from './modules/superagent/SuperagentPanel.tsx'
import { WorkbenchClient, type WorkbenchSnapshot } from './modules/session/client.ts'
import type { BuiltinPluginId, ProviderProfile, ThinkingLevel } from './modules/session/types.ts'
import styles from './App.module.css'

const layoutStore = createLayoutStore().create()
const panels = [{ id: 'superagent', order: 20, label: 'Superagent' }]
const sidebarText = (key: string) => ({
  'toggle.open': '展开侧栏', 'toggle.collapse': '收起侧栏', 'brand.localBuild': 'pie-next',
  'session.new': '新建会话', 'session.new.label': '新建会话', 'panels.label': '面板', 'panels.more': '更多', 'version.copied': '已复制',
}[key] ?? key)
const fallbackAgent: WorkbenchSnapshot['agents'][number] = { id: 0, name: '会话', role: '独立会话', status: 'waiting', model: '未配置模型', kind: 'root', lastActive: '—', summary: 'pie-next 持久化 Agent 工作台' }

function selectorHook<T>(getSnapshot: () => T, subscribe: (fn: () => void) => () => void): SnapshotSelectorHook<T> {
  return <S,>(selector: (value: T) => S, equal?: (left: S, right: S) => boolean): S => {
    const cache = useRef<{ source: T; result: S } | null>(null)
    return useSyncExternalStore(subscribe, () => {
      const source = getSnapshot()
      if (cache.current !== null && Object.is(cache.current.source, source)) return cache.current.result
      const result = selector(source)
      if (cache.current !== null && (equal ?? shallowEqual)(cache.current.result, result)) return cache.current.result
      cache.current = { source, result }
      return result
    }, () => selector(getSnapshot()))
  }
}

export function App() {
  const clientRef = useRef<WorkbenchClient | null>(null)
  if (!clientRef.current) clientRef.current = new WorkbenchClient()
  const client = clientRef.current
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const [theme, setTheme] = useState(() => localStorage.getItem('dw-theme') ?? 'light')
  const [view, setView] = useState<'chat' | 'trajectory'>('chat')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('tasks')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [deleting, setDeleting] = useState<{ kind: 'session'; id: number; name: string } | { kind: 'workspace'; path: string; name: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | undefined>()
  const selected = snapshot.agents.find(agent => agent.id === snapshot.selectedId) ?? fallbackAgent
  const useStore = selectorHook(layoutStore.getSnapshot, layoutStore.subscribe)
  const sessionSnapshot: LayoutSessionsSnapshot = { byId: Object.fromEntries(snapshot.agents.map(agent => [agent.id, { id: String(agent.id), title: agent.summary, retainedBy: { mainView: agent.id === snapshot.selectedId ? 1 : 0 } }])) }
  const useSessions = selectorHook(() => sessionSnapshot, () => () => {})

  useEffect(() => { void client.open(); return () => client.close() }, [client])
  useEffect(() => {
    if (theme === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
    else document.body.removeAttribute('data-ds-dark-theme')
    localStorage.setItem('dw-theme', theme)
  }, [theme])

  const pluginEnabled = (id: BuiltinPluginId): boolean => snapshot.plugins.find(plugin => plugin.id === id)?.enabled ?? true
  const renderSlot: RenderLayoutSlot = (key, owner) => {
    if (key === 'sidebar') return <SidebarRoot collapsed={(owner as SidebarOwnerProps).collapsed} width={(owner as SidebarOwnerProps).width} startSession={() => { void createSession() }} toggleSidebar={layoutStore.actions.toggleSidebar} selectPanel={id => { layoutStore.actions.selectPanel(id); void client.loadSuperagent() }} setPinned={() => {}} trackEntryClick={() => {}}
      useRemoteAccess={() => true} usePanels={selectorHook(() => panels, () => () => {})} useEntryPins={selectorHook(() => [], () => () => {})} useEntryActions={selectorHook(() => false, () => () => {})}
      useShortcuts={selectorHook(() => [], () => () => {})} usePanelInfo={selectorHook(() => layoutStore.getSnapshot().panelInfo, layoutStore.subscribe)} t={sidebarText}
      renderSlot={(slot, _owner, opts) => {
        if (slot === 'sidebar.workspaces') return <AgentTree agents={snapshot.agents} selectedId={snapshot.selectedId} onSelect={selectSession} onCreate={() => { void createSession() }} workspaces={snapshot.workspaces} currentWorkspace={snapshot.currentWorkspace} onWorkspace={path => { void switchWorkspace(path) }} onAddWorkspace={() => setWorkspaceOpen(true)} onDeleteWorkspace={path => { const workspace = snapshot.workspaces.find(item => item.path === path); if (workspace) setDeleting({ kind: 'workspace', path, name: workspace.name }) }} onDeleteSession={agent => setDeleting({ kind: 'session', id: agent.id, name: agent.name })} />
        if (slot === 'sidebar.panellist' && opts?.only === 'superagent') return <IconAgentPresetOutlineRegular size={(_owner as { size?: number }).size ?? 16} />
        if (slot === 'sidebar.settings') return <Button size="sm" icon={<IconSettingsOutlineRegular />} aria-label="打开设置" onClick={() => setSettingsOpen(true)}>设置</Button>
        if (slot === 'sidebar.brand.mark') return <span className={styles.brandMark}>π</span>
        if (slot === 'sidebar.brand.name') return <span className={styles.brandName}>pie-next</span>
        return opts?.fallback ?? null
      }} />
    if (key === 'main' && layoutStore.getSnapshot().panelInfo.activePanelId === 'superagent') return <SuperagentPanel state={snapshot.superagent} onAccept={input => client.acceptSuperagent(input)} onStop={(id, reason) => client.stopSuperagent(id, reason)} onSave={settings => client.saveSuperagent(settings)} onOpen={id => { layoutStore.actions.selectPanel(null); void selectSession(id) }} onBack={() => layoutStore.actions.selectPanel(null)} />
    if (key === 'main') return <ConversationPanel tasksEnabled={pluginEnabled('todo')} subagentsEnabled={pluginEnabled('subagent')} conversation={selected} parent={selected.parentId === undefined ? undefined : snapshot.agents.find(agent => agent.id === selected.parentId)} subagents={snapshot.agents.filter(agent => agent.parentId === selected.id)} onSelectAgent={selectSession} messages={snapshot.messages[snapshot.selectedId] ?? []} entries={snapshot.entries[snapshot.selectedId] ?? []} todos={snapshot.todos} queued={snapshot.queued} view={view} onView={setView}
      draft={draft} onDraft={setDraft} onSend={send} submitting={submitting} onStop={stop} onRemoveQueued={id => { void run(() => client.removeQueued(id)) }} models={snapshot.models} onModel={model => { void changeModel(model) }} thinkingLevel={selected.thinkingLevel} onThinkingLevel={level => { void changeThinkingLevel(level) }} permission={snapshot.permission} onPermission={mode => { void changePermission(mode) }} onDecision={decide} onToggleTasks={() => { setInspectorTab('tasks'); layoutStore.actions.setRightbar(320); layoutStore.actions.openRightbar(true, false) }} onToggleInspector={() => { setInspectorTab('background'); layoutStore.actions.setRightbar(320); layoutStore.actions.openRightbar(true, false) }} error={snapshot.error ?? actionError} />
    if (key === 'rightbar') return <InspectorPanel plugins={snapshot.plugins} tab={inspectorTab} onTab={setInspectorTab} todos={snapshot.todos} agents={snapshot.agents} onAgent={selectSession} background={snapshot.background} onStartBackground={(command, title) => client.startBackground(command, title)} onStopBackground={id => client.stopBackground(id)} onClose={() => layoutStore.actions.closeRightbar()} />
    if (key === 'shell.overlay') return <><SettingsOverlay open={settingsOpen} onClose={() => setSettingsOpen(false)} providers={snapshot.providers} onProviders={saveProviders} onSync={(profile, apiKey) => client.syncProviderModels(profile, apiKey)} plugins={snapshot.plugins} models={snapshot.models} runtime={snapshot.runtime} onPlugin={(id, enabled) => client.configurePlugin(id, enabled)} onRuntime={settings => client.saveRuntime(settings)} onCompact={() => client.compactCurrent()} theme={theme} onTheme={setTheme} /><WorkspaceDialog open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} onAdd={path => client.addWorkspace(path)} />{deleting && <DeleteDialog open title={deleting.kind === 'session' ? '删除会话' : '删除工作区'} description={deleting.kind === 'session' ? `“${deleting.name}” 将从会话列表移除，并停止正在运行的任务。本地历史仍保留在 SQLite 中。` : `“${deleting.name}” 将从工作区列表移除，目录与本地数据不会被删除。`} onClose={() => setDeleting(null)} onConfirm={() => deleting.kind === 'session' ? client.deleteConversation(deleting.id) : client.removeWorkspace(deleting.path)} />}</>
    return null
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(undefined)
    try { await action() } catch (cause) { setActionError(cause instanceof Error ? cause.message : '命令执行失败') }
  }
  async function switchWorkspace(path: string): Promise<void> { await run(() => client.selectWorkspace(path)) }
  async function createSession(): Promise<void> {
    await run(async () => { await client.createConversation(); setView('chat'); setDraft('') })
  }
  async function send(): Promise<void> {
    const content = draft.trim()
    if (!content || submitting) return
    setSubmitting(true)
    try { await run(async () => { await client.send(content); setDraft('') }) } finally { setSubmitting(false) }
  }
  async function stop(): Promise<void> { await run(() => client.stop()) }
  async function changeModel(model: { provider: string; modelId: string }): Promise<void> { await run(() => client.setModel(model)) }
  async function changeThinkingLevel(level?: ThinkingLevel): Promise<void> { await run(() => client.setThinkingLevel(level)) }
  async function changePermission(mode: 'allow-all' | 'approve'): Promise<void> { await run(() => client.setPermission(mode)) }
  function selectSession(id: number, workspacePath?: string): void {
    setActionError(undefined)
    if (workspacePath && workspacePath !== snapshot.currentWorkspace) {
      void run(async () => { await client.selectWorkspace(workspacePath); await client.selectConversation(id) })
    } else void client.selectConversation(id)
  }
  async function decide(id: string | number, approved: boolean): Promise<void> { await run(() => client.decide(id, approved)) }
  async function saveProviders(next: ProviderProfile[], apiKey?: string, editingId?: string): Promise<void> {
    setActionError(undefined)
    try {
      for (const profile of next) {
        const previous = snapshot.providers.find(item => item.id === profile.id)
        if (!previous || JSON.stringify(previous) !== JSON.stringify(profile) || (apiKey && profile.id === editingId)) await client.saveProvider(profile, apiKey)
      }
      for (const profile of snapshot.providers) {
        const updated = next.find(item => item.id === profile.id)
        if (updated && updated.enabled !== profile.enabled) await client.setProviderEnabled(profile.id, updated.enabled)
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Provider 保存失败')
      throw cause
    }
  }

  return <AppFrame useStore={useStore} actions={layoutStore.actions} usePanelInfo={selectorHook(() => layoutStore.getSnapshot().panelInfo, layoutStore.subscribe)} useSessions={useSessions} renderSlot={renderSlot} t={sidebarText} productTitle="pie-next" />
}
