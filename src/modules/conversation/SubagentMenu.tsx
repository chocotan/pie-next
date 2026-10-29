import { useState } from 'react'
import { Button, IconChevronDownOutlineRegular, Menu, MenuItemButton, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Conversation } from '../session/types.ts'
import css from './SubagentMenu.module.css'

const statusText = { generating: '运行中', tool: '调用工具', approval: '等待审批', idle: '待命', waiting: '等待中', error: '失败', stopped: '已停止' } as const

export function SubagentMenu({ agents, onSelect }: { agents: Conversation[]; onSelect: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  if (agents.length === 0) return <span className={css.empty}>0 个子代理</span>
  return <Menu open={open} onClose={() => setOpen(false)} portal autoFocus className={css.anchor} listClassName={css.menu} anchor={<Button size="sm" variant="ghost" aria-label="查看子代理" aria-expanded={open} onClick={() => setOpen(value => !value)}>{agents.length} 个子代理<IconChevronDownOutlineRegular /></Button>}>
    {agents.map(agent => <MenuItemButton key={agent.id} onSelect={() => { setOpen(false); onSelect(agent.id) }}>
      <span className={css.agent}><span className={css.identity}><span className={css.name}>{agent.name}</span><span className={css.meta}>{statusText[agent.status]} · {agent.model}</span></span><StateDot state={agent.status === 'idle' || agent.status === 'stopped' ? 'done' : agent.status === 'error' ? 'error' : 'ongoing'} /></span>
    </MenuItemButton>)}
  </Menu>
}
