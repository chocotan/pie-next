import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BrandWordmark, Button, FishLogo, IconSettingsOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { shallowEqual, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { AppFrame, createLayoutStore } from './modules/layout/index.ts'
import type { LayoutSessionsSnapshot, RenderLayoutSlot, SidebarOwnerProps } from './modules/layout/types.ts'
import { SidebarRoot } from './modules/sidebar/SidebarRoot.tsx'
import { AgentTree } from './modules/subagent/AgentTree.tsx'
import { ConversationPanel } from './modules/conversation/ConversationPanel.tsx'
import { InspectorPanel } from './modules/inspector/InspectorPanel.tsx'
import { SettingsOverlay } from './modules/settings/SettingsOverlay.tsx'
import { WorkbenchClient, type WorkbenchSnapshot } from './modules/session/client.ts'
import type { ProviderProfile } from './modules/session/types.ts'
import type { EntryRecord } from '@earendil-works/pi-durable'

const layoutStore = createLayoutStore().create()
const sidebarText = (key: string) => ({
  'toggle.open': '展开侧栏', 'toggle.collapse': '收起侧栏', 'brand.localBuild': 'Durable Workbench',
  'session.new': '新建会话', 'session.new.label': '新建会话', 'panels.label': '面板', 'panels.more': '更多', 'version.copied': '已复制',
}[key] ?? key)
const fallbackAgent: WorkbenchSnapshot['agents'][number] = { id: 1, name: 'Root 主会话', role: '编排与集成', status: 'waiting', model: 'deepseek-v4.1-flash', kind: 'root', lastActive: '—', summary: '持久化 Agent 工作台' }

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
  const [inspectorTab, setInspectorTab] = useState<'todo' | 'agents' | 'usage'>('todo')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState('')
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

  const renderSlot: RenderLayoutSlot = (key, owner) => {
    if (key === 'sidebar') return <SidebarRoot collapsed={(owner as SidebarOwnerProps).collapsed} width={(owner as SidebarOwnerProps).width} startSession={() => { void createSession() }} toggleSidebar={layoutStore.actions.toggleSidebar} selectPanel={() => {}} setPinned={() => {}} trackEntryClick={() => {}}
      useRemoteAccess={() => true} usePanels={selectorHook(() => [], () => () => {})} useEntryPins={selectorHook(() => [], () => () => {})} useEntryActions={selectorHook(() => false, () => () => {})}
      useShortcuts={selectorHook(() => [], () => () => {})} usePanelInfo={selectorHook(() => layoutStore.getSnapshot().panelInfo, layoutStore.subscribe)} t={sidebarText}
      renderSlot={(slot, _owner, opts) => {
        if (slot === 'sidebar.workspaces') return <AgentTree agents={snapshot.agents} selectedId={snapshot.selectedId} onSelect={id => { void client.selectConversation(id) }} onCreate={() => { void createSession() }} />
        if (slot === 'sidebar.settings') return <Button size="sm" icon={<IconSettingsOutlineRegular />} aria-label="打开设置" onClick={() => setSettingsOpen(true)}>设置</Button>
        if (slot === 'sidebar.brand.mark') return <FishLogo size={30} />
        if (slot === 'sidebar.brand.name') return <BrandWordmark includeMark={false} size={30} />
        return opts?.fallback ?? null
      }} />
    if (key === 'main') return <ConversationPanel conversation={selected} childCount={snapshot.agents.filter(agent => agent.parentId === selected.id).length} messages={snapshot.messages[snapshot.selectedId] ?? []} entries={snapshot.entries[snapshot.selectedId] ?? []} todos={snapshot.todos} view={view} onView={setView}
      draft={draft} onDraft={setDraft} onSend={send} onStop={stop} onDecision={decide} onToggleInspector={() => { setInspectorTab('agents'); layoutStore.actions.openRightbar(true, false) }} error={snapshot.error ?? actionError} />
    if (key === 'rightbar') return <InspectorPanel tab={inspectorTab} onTab={setInspectorTab} todos={snapshot.todos} onTodo={id => { void client.cycleTodo(id) }} agents={snapshot.agents} onAgent={id => { void client.selectConversation(id) }} usage={usageFor(snapshot.entries[snapshot.selectedId] ?? [], snapshot.selectedId)} onClose={() => layoutStore.actions.closeRightbar()} />
    if (key === 'shell.overlay') return <SettingsOverlay open={settingsOpen} onClose={() => setSettingsOpen(false)} providers={snapshot.providers} onProviders={saveProviders} theme={theme} onTheme={setTheme} />
    return null
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(undefined)
    try { await action() } catch (cause) { setActionError(cause instanceof Error ? cause.message : '命令执行失败') }
  }
  async function createSession(): Promise<void> {
    await run(async () => { await client.createConversation(); setView('chat'); setDraft('') })
  }
  async function send(): Promise<void> {
    const content = draft.trim()
    if (!content) return
    await run(async () => { await client.send(content); setDraft('') })
  }
  async function stop(): Promise<void> { await run(() => client.stop()) }
  async function decide(id: string | number, approved: boolean): Promise<void> { await run(() => client.decide(id, approved)) }
  async function saveProviders(next: ProviderProfile[], apiKey?: string, editingId?: string): Promise<void> {
    await run(async () => {
      for (const profile of next) {
        const previous = snapshot.providers.find(item => item.id === profile.id)
        if (!previous || JSON.stringify(previous) !== JSON.stringify(profile) || (apiKey && profile.id === editingId)) await client.saveProvider(profile, apiKey)
      }
      for (const profile of snapshot.providers) {
        const updated = next.find(item => item.id === profile.id)
        if (updated && updated.enabled !== profile.enabled) await client.setProviderEnabled(profile.id, updated.enabled)
      }
    })
  }

function usageFor(entries: EntryRecord[], conversationId: number): { input: number; output: number; cost: number; conversationId: number } {
  let input = 0, output = 0, cost = 0
  for (const entry of entries) {
    const message = entry.model?.[0]
    if (message?.role !== 'assistant') continue
    input += message.usage.input
    output += message.usage.output
    cost += message.usage.cost.total
  }
  return { input, output, cost, conversationId }
}

  return <AppFrame useStore={useStore} actions={layoutStore.actions} usePanelInfo={selectorHook(() => layoutStore.getSnapshot().panelInfo, layoutStore.subscribe)} useSessions={useSessions} renderSlot={renderSlot} t={sidebarText} productTitle="Durable Workbench" />
}
