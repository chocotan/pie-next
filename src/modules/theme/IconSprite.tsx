import { useEffect, useRef } from 'react'
import { ICON_SYMBOLS } from '../../vendor/dsh/primitives/icons/artwork.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DROPPED_ATTRIBUTES = new Set(['width', 'height', 'xmlns', 'class', 'aria-hidden'])

export function IconSprite() {
  const sprite = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const definitions = sprite.current?.querySelector('defs')
    if (!definitions) return
    for (const [id, markup] of Object.entries(ICON_SYMBOLS)) {
      const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
      const symbol = document.createElementNS(SVG_NS, 'symbol')
      for (const { name, value } of root.attributes) if (!DROPPED_ATTRIBUTES.has(name)) symbol.setAttribute(name, value)
      symbol.id = id
      symbol.append(...[...root.childNodes].map(node => document.importNode(node, true)))
      definitions.append(symbol)
    }
    return () => { definitions.replaceChildren() }
  }, [])
  return <svg ref={sprite} aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}><defs /></svg>
}
