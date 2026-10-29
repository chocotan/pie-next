import { ICON_SYMBOLS } from '../../vendor/dsh/primitives/icons/artwork.ts'

export function IconSprite() {
  return <svg aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}><defs>
    {Object.entries(ICON_SYMBOLS).map(([id, markup]) => {
      const node = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
      return <symbol key={id} id={id} viewBox={node.getAttribute('viewBox') ?? '0 0 16 16'} dangerouslySetInnerHTML={{ __html: node.innerHTML }} />
    })}
  </defs></svg>
}
