import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutlineRegular, IconDataOutlineMedium, IconPersonalizationOutlineMedium, useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives'
import { ProviderSettings } from '../providers/ProviderSettings.tsx'
import type { ProviderProfile } from '../session/types.ts'
import css from './SettingsRoot.module.css'

export function SettingsOverlay({ open, onClose, providers, onProviders, theme, onTheme }: {
  open: boolean
  onClose: () => void
  providers: ProviderProfile[]
  onProviders: (providers: ProviderProfile[], apiKey?: string, editingId?: string) => void | Promise<void>
  theme: string
  onTheme: (theme: string) => void
}) {
  const [active, setActive] = useState('models')
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  useModalLayer(panel, open, onClose)
  if (!open) return null
  return createPortal(<div className={css.overlay} role="presentation">
    <div className={css.mask} aria-hidden="true" onClick={onClose} />
    <div ref={panel} tabIndex={-1} className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={css.navTitle} id={titleId} tabIndex={-1}><h2>工作台设置</h2></div>
      <nav className={css.nav}><div className={css.navList}>
        <button type="button" className={clsx(css.navCell, active === 'models' && css.active)} aria-current={active === 'models' ? 'true' : undefined} onClick={() => setActive('models')}><IconDataOutlineMedium className={css.navIcon} size={16} /><span className={css.navLabel}>模型提供方</span></button>
        <button type="button" className={clsx(css.navCell, active === 'preferences' && css.active)} aria-current={active === 'preferences' ? 'true' : undefined} onClick={() => setActive('preferences')}><IconPersonalizationOutlineMedium className={css.navIcon} size={16} /><span className={css.navLabel}>偏好设置</span></button>
      </div></nav>
      <div className={css.header}><div className={css.actions} /><button type="button" className={css.close} aria-label="关闭设置" onClick={onClose}><IconCloseOutlineRegular size={14} /><span className={css.hiddenLabel}>关闭</span></button></div>
      <div className={css.options}>{active === 'models' ? <ProviderSettings providers={providers} onChange={onProviders} /> : <section><h2>外观与交互</h2><label>界面主题<select value={theme} onChange={event => onTheme(event.target.value)}><option value="light">浅色</option><option value="dark">深色</option></select></label></section>}</div>
    </div>
  </div>, document.body)
}
