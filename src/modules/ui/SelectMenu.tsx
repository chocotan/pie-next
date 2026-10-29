import { useState } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SelectMenu.module.css'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function SelectMenu({ value, options, onChange, ariaLabel, placeholder = '请选择', disabled = false, className = '', menuClassName = '' }: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.value === value)
  return <Menu open={open} onClose={() => setOpen(false)} portal autoFocus minWidthFromAnchor className={`${css.root} ${className}`} listClassName={`${css.menu} ${menuClassName}`} selectedId={value} items={options.map(option => ({ id: option.value, label: option.label, disabled: option.disabled }))} onSelect={next => { setOpen(false); onChange(next) }} anchor={<button type="button" className={css.trigger} aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} disabled={disabled} title={selected?.label} onClick={() => setOpen(value => !value)}><span className={css.label}>{selected?.label ?? placeholder}</span><IconChevronDownOutlineRegular /></button>} />
}
