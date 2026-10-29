import { useState } from 'react'
import { StateDot, TerminalBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCall } from '../session/types.ts'
import css from './ToolsPanel.module.css'

export const terminalLabels = {
  commandLine: (line: number) => `命令第 ${line} 行`, signal: (signal: string) => `信号 ${signal}`, exitCode: (code: number) => `退出码 ${code}`, noExitCode: '无退出码',
  running: '运行中', failed: '失败', done: '完成', copy: '复制', copied: '已复制', noOutput: '无输出', collapseAria: '收起输出', collapse: '收起',
  expandAria: (hidden: number) => `展开 ${hidden} 行输出`, expand: (hidden: number) => `展开 ${hidden} 行`,
}

function commandOf(call: ToolCall): string {
  try {
    const args = JSON.parse(call.args) as { command?: unknown }
    return typeof args.command === 'string' ? args.command : call.args
  } catch { return call.args }
}

export function ToolsPanel({ tools }: { tools: ToolCall[] }) {
  const [selectedId, setSelectedId] = useState<string>()
  const current = tools.find(tool => tool.id === selectedId) ?? tools.at(-1)
  if (!current) return <p className={css.empty}>暂无工具调用</p>
  return <div className={css.root}>
    <div className={css.tabs} role="tablist" aria-label="工具调用">{tools.map(tool => <button type="button" role="tab" aria-selected={tool.id === current.id} className={css.tab} key={tool.id} onClick={() => setSelectedId(tool.id)}><StateDot state={tool.status === 'done' ? 'done' : tool.status === 'error' ? 'error' : 'ongoing'} />{tool.name}</button>)}</div>
    <div className={css.document}>
      <div className={css.meta}>{current.summary} · {current.duration}</div>
      {current.name === 'bash'
        ? <TerminalBlock key={current.id} command={commandOf(current)} output={current.result} running={current.status === 'running' || current.status === 'approval'} labels={terminalLabels} />
        : <div className={css.io}><section><h3>输入</h3><pre>{current.args}</pre></section><section><h3>结果</h3><pre data-error={current.status === 'error' || undefined}>{current.result ?? '等待执行结果…'}</pre></section></div>}
    </div>
  </div>
}
