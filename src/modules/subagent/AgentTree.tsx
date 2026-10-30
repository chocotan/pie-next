import { useEffect, useRef, useState } from 'react'
import {
  IconChevronRightOutlineRegular, IconCloseOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular, IconPlusOutlineRegular,
  IconProjectAddOutlineRegular, IconSearchOutlineRegular, IconSlidersTwoOutlineRegular, IconTrashOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Conversation } from '../session/types.ts'
import browserCss from './WorkspaceBrowser.module.css'
import rowCss from './Rows.module.css'

export function AgentTree({ agents, selectedId, onSelect, onCreate, workspaces, currentWorkspace, onWorkspace, onAddWorkspace, onDeleteWorkspace, onDeleteSession }: {
  agents: Conversation[]
  selectedId: number
  onSelect: (id: number, workspacePath?: string) => void
  onCreate: () => void
  workspaces: Array<{ path: string; name: string }>
  currentWorkspace: string
  onWorkspace: (path: string) => void
  onAddWorkspace: () => void
  onDeleteWorkspace: (path: string) => void
  onDeleteSession: (agent: Conversation) => void
}) {
  const [query, setQuery] = useState<string | null>(null)
  const sessionCache = useRef(new Map<string, Conversation[]>())
  const selectedCache = useRef(new Map<string, number>())
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [alphabetical, setAlphabetical] = useState(false)
  useEffect(() => {
    if (!currentWorkspace) return
    sessionCache.current.set(currentWorkspace, agents)
    selectedCache.current.set(currentWorkspace, selectedId)
    setExpanded(value => ({ ...value, [currentWorkspace]: true }))
  }, [currentWorkspace, agents, selectedId])
  const sessionsFor = (path: string): Conversation[] => {
    const source = path === currentWorkspace ? agents : sessionCache.current.get(path) ?? []
    const rows = source.filter(agent => !agent.parentId && (!query || agent.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    return alphabetical ? [...rows].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) : rows
  }
  const toggle = (path: string): void => setExpanded(value => ({ ...value, [path]: !(value[path] ?? path === currentWorkspace) }))
  return <div className={browserCss.root}>
    <div className={browserCss.sectionHeader}>
      {query === null && <span className={browserCss.sectionLabel}>工作区</span>}
      {query === null ? <div className={browserCss.searchSlot}><button type="button" className={browserCss.searchButton} aria-label="搜索会话" onClick={() => setQuery('')}><IconSearchOutlineRegular /></button></div>
        : <div className={`${browserCss.search} ${browserCss.searchExpanded}`}><input autoFocus className={browserCss.searchInput} value={query} placeholder="搜索会话" aria-label="搜索会话" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(null) }} /><button type="button" className={browserCss.clearButton} aria-label="返回会话列表" onClick={() => setQuery(null)}><IconCloseOutlineRegular /><span>返回</span></button></div>}
      {query === null && <div className={browserCss.headerActions}>
        <button type="button" className={browserCss.iconButton} aria-label="切换会话排序" aria-pressed={alphabetical} onClick={() => setAlphabetical(value => !value)}><IconSlidersTwoOutlineRegular /></button>
        <button type="button" className={browserCss.iconButton} aria-label="添加工作区" onClick={onAddWorkspace}><IconPlusOutlineRegular /></button>
        <button type="button" className={browserCss.iconButton} aria-label="新建会话" onClick={onCreate}><IconProjectAddOutlineRegular /></button>
      </div>}
    </div>
    <div className={browserCss.listArea}><div className={browserCss.treeBody}><div className={browserCss.list}>
      {workspaces.map(workspace => {
        const current = workspace.path === currentWorkspace
        const open = expanded[workspace.path] ?? current
        const sessions = sessionsFor(workspace.path)
        const selected = current ? selectedId : selectedCache.current.get(workspace.path)
        return <section className={browserCss.groupSection} key={workspace.path}>
          <div className={rowCss.projectRow} role="treeitem" aria-expanded={open} aria-current={current || undefined} tabIndex={0} onClick={() => { if (current) toggle(workspace.path); else onWorkspace(workspace.path) }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (current) toggle(workspace.path); else onWorkspace(workspace.path) } }}>
            <button type="button" className={rowCss.disclosure} aria-label={open ? `收起工作区 ${workspace.name}` : `展开工作区 ${workspace.name}`} aria-expanded={open} onClick={event => { event.stopPropagation(); toggle(workspace.path) }}>
              <IconChevronRightOutlineRegular className={open ? rowCss.disclosureOpen : undefined} />
            </button>
            <span className={`${rowCss.slot} ${current ? rowCss.folderActive : ''}`} aria-hidden="true">{open ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}</span>
            <span className={rowCss.projectText} title={workspace.path}><span className={rowCss.title}>{workspace.name}</span></span>
            <button type="button" className={rowCss.rowDelete} aria-label={`删除工作区 ${workspace.name}`} title={workspaces.length <= 1 ? '至少保留一个工作区' : '从工作区列表删除'} disabled={workspaces.length <= 1} onClick={event => { event.stopPropagation(); onDeleteWorkspace(workspace.path) }}><IconTrashOutlineRegular /></button>
          </div>
          {open && <div role="group">{sessions.map(agent => <div
            key={agent.id}
            role="treeitem"
            aria-selected={selected === agent.id}
            tabIndex={0}
            className={`${rowCss.sessionRow} ${selected === agent.id ? rowCss.selected : ''}`}
            onClick={() => onSelect(agent.id, workspace.path)}
            onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(agent.id, workspace.path) } }}
          >
            <span className={rowCss.slot}>{agent.status !== 'idle' && <StateDot state={agent.status === 'approval' ? 'warning' : agent.status === 'stopped' ? 'idle' : 'ongoing'} />}</span>
            <span className={rowCss.title}>{agent.name}</span>
            {agent.lastActive && agent.lastActive !== '—' && <span className={rowCss.time}>{agent.lastActive}</span>}
            {current && <button type="button" className={rowCss.rowDelete} aria-label={`删除会话 ${agent.name}`} title="删除会话" onClick={event => { event.stopPropagation(); onDeleteSession(agent) }}><IconTrashOutlineRegular /></button>}
          </div>)}</div>}
          {current && open && sessions.length === 0 && <div className={browserCss.searchStatus}>没有匹配的会话</div>}
        </section>
      })}
    </div></div></div>
  </div>
}
