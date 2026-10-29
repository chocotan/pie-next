import type { ReactNode } from 'react'
import type { BakedActions, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'

/** Identity shared by a navigation entry and its main-slot occupant. */
export type MainPanelId = string

/** Root-scoped navigation state exposed to panel-aware components. */
export interface PanelInfo {
  /** Selected global panel; null displays the current conversation. */
  readonly activePanelId: MainPanelId | null
}

export interface LayoutInfo {
  sidebar: number
  viewportWidth: number
  narrowExpanded: boolean
  rightbar: number | null
  rightbarShown: boolean
  rightbarTrack: boolean
  rightbarFullscreen: boolean
  rightbarInstant: boolean
}

export interface LayoutState {
  panelInfo: {
    /** Null selects the conversation; global panels keep the current session intact. */
    activePanelId: MainPanelId | null
  }
  layoutInfo: LayoutInfo
}

/** Draft-form actions used by the copied DSH store declaration. */
export type LayoutDraftActions = {
  selectPanel: (draft: LayoutState, panelId: MainPanelId | null) => void
  retainMainPanels: (draft: LayoutState, panelIds: readonly string[]) => void
  setSidebar: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setViewportWidth: (draft: LayoutState, width: number) => void
  setRightbar: (draft: LayoutState, px: number) => void
  openRightbar: (draft: LayoutState, track: boolean, fullscreen: boolean) => void
  closeRightbar: (draft: LayoutState) => void
}

export type LayoutActions = BakedActions<LayoutState, LayoutDraftActions>

/** Minimal session projection needed by DocumentTitle; Session runtime stays outside this module. */
export interface LayoutSessionsSnapshot {
  byId: Record<string, {
    id: string
    title: string
    retainedBy: { mainView?: number }
  }>
}

export interface SidebarOwnerProps {
  collapsed: boolean
  width: number
}

export interface RightbarOwnerProps {
  width: number
  viewportWidth: number
  canShow: boolean
}

export interface LayoutSlotOwnerProps {
  sidebar: SidebarOwnerProps
  main: object
  rightbar: RightbarOwnerProps
  'shell.bottom': object
  'shell.overlay': object
  'shell.leading': object
}

/** Parent-injected slot renderer; no DSH slot registry or React runtime is required here. */
export type RenderLayoutSlot = <K extends keyof LayoutSlotOwnerProps>(
  key: K,
  owner: LayoutSlotOwnerProps[K],
  opts?: { entryKey?: string },
) => ReactNode

/** Complete props supplied by the application composition layer. */
export interface AppFrameProps {
  useStore: SnapshotSelectorHook<LayoutState>
  actions: LayoutActions
  usePanelInfo: SnapshotSelectorHook<PanelInfo>
  useSessions: SnapshotSelectorHook<LayoutSessionsSnapshot>
  renderSlot: RenderLayoutSlot
  t: (key: string) => string
  /** Optional product-name override; defaults to the localized DSH title. */
  productTitle?: string
}

export type DocumentTitleProps = Pick<AppFrameProps, 'useSessions' | 'usePanelInfo'> & {
  productTitle: string
}
