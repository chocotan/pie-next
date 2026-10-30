import { memo, useMemo, type ReactNode } from 'react'
import clsx from 'clsx'
import { DisclosureRow, IconInspectOutlineRegular, TerminalBlock, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import { terminalLabels } from '../inspector/ToolsPanel.tsx'
import { formatToolBody, type ToolRowVariant } from './tool-body.ts'
import css from './ToolRow.module.css'

export type { ToolRowVariant } from './tool-body.ts'

export type ToolRowState = 'preparing' | 'running' | 'ok' | 'error' | 'stopped'

export interface TerminalRowModel {
  card: { command: string; output?: string | undefined; running?: boolean | undefined }
  description?: string | undefined
}

export interface ToolRowProps {
  useDisclosure: () => { expanded: boolean; toggle: () => void }
  t: (key: string) => string
  variant: ToolRowVariant
  toolName: string
  icon: ReactNode
  title: string
  summary: string
  summarySuffix?: string | null | undefined
  bodyRaw?: string | null | undefined
  output?: string | null | undefined
  errorSummary?: string | null | undefined
  terminal?: TerminalRowModel | null | undefined
  state: ToolRowState
  inspect?: (() => void) | undefined
}

function stateStatus(state: ToolRowState, t: ToolRowProps['t']): string | null {
  if (state === 'preparing') return t('row.preparing')
  if (state === 'running') return t('row.running')
  if (state === 'error') return t('row.failed')
  if (state === 'stopped') return t('row.stopped')
  return null
}

/** DSH ToolRow presentation, with Durable's terminal and generic IN/OUT card variants. */
export const ToolRow = memo(function ToolRow({
  t, variant, toolName, icon, title, summary, summarySuffix, bodyRaw, output, errorSummary, terminal, state, inspect, useDisclosure,
}: ToolRowProps) {
  const { expanded, toggle: toggleExpand } = useDisclosure()
  const inputRaw = bodyRaw ?? null
  const outputText = output ?? null
  const expandable = state !== 'preparing' && (inputRaw !== null || outputText !== null || (terminal != null))
  const open = expanded && expandable
  const bodyText = useMemo(() => open && !terminal && inputRaw !== null ? formatToolBody(variant, inputRaw) : null, [terminal, inputRaw, open, variant])
  const status = stateStatus(state, t)
  const running = state === 'running' || state === 'preparing'
  const normalSummary = terminal?.description ?? summary
  const failureLine = state === 'error' ? errorSummary ?? normalSummary : null
  const summaryText = failureLine ?? normalSummary
  const suffix = state === 'error' || state === 'stopped' ? null : summarySuffix ?? null
  const collapsedContent = summaryText !== '' && <>
    <span className={css.sep} data-shimmer-decoration aria-hidden />
    <span className={clsx(css.summary, state === 'error' && css.errorSummary, state === 'stopped' && css.stoppedSummary)}><TextShimmer>{summaryText}</TextShimmer></span>
    {suffix !== null && <TextShimmer className={css.summarySuffix}>{suffix}</TextShimmer>}
  </>
  return <div className={css.root} data-variant={variant} data-tool={toolName} data-state={state}>
    {status !== null && <span className={css.visuallyHidden}>{status}</span>}
    <DisclosureRow
      rowClassName={css.row}
      leadingClassName={css.leading}
      titleClassName={css.title}
      icon={icon}
      title={title}
      running={running}
      open={open}
      expandable={expandable}
      expandOnRowClick
      keepContentWhenOpen
      onToggle={toggleExpand}
      collapsedContent={collapsedContent}
    >
      {open && <div className={css.bodyWrap}>
        {terminal
          ? <TerminalBlock {...terminal.card} maxLines={Infinity} labels={terminalLabels} className={css.terminalBody} />
          : (bodyText !== null || outputText !== null) && <div className={css.ioCard}>
            {bodyText !== null && <div className={css.ioSection}><span className={css.ioLabel}>IN</span><span className={css.ioText}>{bodyText}</span></div>}
            {bodyText !== null && outputText !== null && <span className={css.ioDivider} aria-hidden />}
            {outputText !== null && <div className={css.ioSection}><span className={css.ioLabel}>OUT</span><span className={css.ioText} data-error={state === 'error' || undefined}>{outputText}</span></div>}
          </div>}
        {inspect !== undefined && <button type="button" className={css.inspectButton} onClick={inspect}><IconInspectOutlineRegular />{t('row.inspect')}</button>}
      </div>}
    </DisclosureRow>
  </div>
})
