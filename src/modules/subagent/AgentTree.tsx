import { useMemo, useState } from 'react'
import {
  IconFolderCloseRegular, IconFolderOpenRegular, IconProjectAddOutlineRegular,
  IconSearchOutlineRegular, IconSlidersTwoOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Conversation } from '../session/types.ts'
import browserCss from './WorkspaceBrowser.module.css'
import rowCss from './Rows.module.css'

export function AgentTree({ agents, selectedId, onSelect, onCreate }: {
  agents: Conversation[]
  selectedId: number
  onSelect: (id: number) => void
  onCreate: () => void
}) {
  const [query, setQuery] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [alphabetical, setAlphabetical] = useState(false)
  const sessions = useMemo(() => {
    const rows = agents.filter(agent => !agent.parentId && (!query || agent.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    return alphabetical ? [...rows].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) : rows
  }, [agents, query, alphabetical])
  return <div className={browserCss.root}>
    <div className={browserCss.sectionHeader}>
      {query === null && <span className={browserCss.sectionLabel}>工作区</span>}
      {query === null ? <div className={browserCss.searchSlot}><button type="button" className={browserCss.searchButton} aria-label="搜索会话" onClick={() => setQuery('')}><IconSearchOutlineRegular /></button></div>
        : <div className={`${browserCss.search} ${browserCss.searchExpanded}`}><button type="button" className={browserCss.searchButton} aria-label="关闭搜索" onClick={() => setQuery(null)}><IconSearchOutlineRegular /></button><input autoFocus className={browserCss.searchInput} value={query} placeholder="搜索会话" aria-label="搜索会话" onChange={event => setQuery(event.target.value)} /></div>}
      {query === null && <div className={browserCss.headerActions}>
        <button type="button" className={browserCss.iconButton} aria-label="切换会话排序" aria-pressed={alphabetical} onClick={() => setAlphabetical(value => !value)}><IconSlidersTwoOutlineRegular /></button>
        <button type="button" className={browserCss.iconButton} aria-label="新建会话" onClick={onCreate}><IconProjectAddOutlineRegular /></button>
      </div>}
    </div>
    <div className={browserCss.listArea}><div className={browserCss.treeBody}><div className={browserCss.list}>
      <section className={browserCss.groupSection}>
        <div className={rowCss.projectRow} role="treeitem" aria-expanded={expanded} tabIndex={0} onClick={() => setExpanded(value => !value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setExpanded(value => !value) }}>
          <span className={`${rowCss.slot} ${rowCss.folderActive}`}>{expanded ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}</span>
          <span className={rowCss.projectText}><span className={rowCss.title}>pie-next</span></span>
        </div>
        {expanded && <div role="group">{sessions.map(agent => <div
          key={agent.id}
          role="treeitem"
          aria-selected={selectedId === agent.id}
          tabIndex={0}
          className={`${rowCss.sessionRow} ${selectedId === agent.id ? rowCss.selected : ''}`}
          onClick={() => onSelect(agent.id)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(agent.id) } }}
        >
          <span className={rowCss.slot}>{agent.status !== 'idle' && <StateDot state={agent.status === 'approval' ? 'warning' : agent.status === 'stopped' ? 'idle' : 'ongoing'} />}</span>
          <span className={rowCss.title}>{agent.name}</span>
          {agent.lastActive && agent.lastActive !== '—' && <span className={rowCss.time}>{agent.lastActive}</span>}
        </div>)}</div>}
        {expanded && sessions.length === 0 && <div className={browserCss.searchStatus}>没有匹配的会话</div>}
      </section>
    </div></div></div>
  </div>
}
