import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId, PanelInfo, SidebarOwnerProps } from '../layout/types.ts'

/** Serializable metadata for one global panel launcher. */
export interface SidebarPanelMetadata {
  readonly id: MainPanelId
  readonly order: number
  readonly label: string
}

/** Keyboard shortcut projection consumed by the copied DSH controls. */
export interface SidebarShortcut {
  readonly id: string
  readonly keys: readonly string[]
  readonly aria?: string
}

export interface SidebarEntryClick {
  readonly menu_name: 'plugin' | 'cron' | 'more' | 'new_session'
  readonly position: 'sidebar' | 'sidebar_more' | 'titlebar'
}

export interface SidebarPanelActionEntry {
  readonly id: string
  readonly label: string
  readonly pinned: boolean
  readonly active?: boolean
}

export interface SidebarPanelActionsOwnerProps {
  readonly entries: readonly SidebarPanelActionEntry[]
  readonly onOpen: (id: string) => void
  readonly onPinnedChange: (id: string, pinned: boolean) => void
  readonly onDismiss: () => void
}

export interface SidebarPanelIconOwnerProps {
  readonly size: number
  readonly active: boolean
}

export interface SidebarBrandMarkOwnerProps {
  readonly size: number
}

export interface SidebarSectionOwnerProps {
  readonly wide: boolean
  readonly expandSidebar: () => void
}

export interface SidebarWideOwnerProps {
  readonly wide: boolean
}

/** Owner props for every hole declared by SidebarRoot. */
export interface SidebarSlotOwnerProps {
  'sidebar.panellist': SidebarPanelIconOwnerProps
  'sidebar.panellist.actions': SidebarPanelActionsOwnerProps
  'sidebar.workspaces': SidebarSectionOwnerProps
  'sidebar.settings': SidebarWideOwnerProps
  'sidebar.footer.action': SidebarWideOwnerProps
  'sidebar.brand.mark': SidebarBrandMarkOwnerProps
  'sidebar.brand.name': Record<never, never>
  'sidebar.toggle.badge': Record<never, never>
}

export interface SidebarSlotOptions {
  /** Restrict a list slot to one registration id. */
  readonly only?: string
  /** Rendered when a single slot has no occupant. */
  readonly fallback?: ReactNode
}

export type RenderSidebarSlot = <K extends keyof SidebarSlotOwnerProps>(
  key: K,
  owner: SidebarSlotOwnerProps[K],
  opts?: SidebarSlotOptions,
) => ReactNode

export type SidebarKey =
  | 'session.new'
  | 'session.new.label'
  | 'toggle.open'
  | 'toggle.collapse'
  | 'panels.label'
  | 'panels.more'
  | 'version.copied'

/** Services are supplied by the composition layer; presentation stays transport-free. */
export interface SidebarRootComponentProps extends SidebarOwnerProps {
  readonly startSession: (workspaceId?: string) => void
  readonly toggleSidebar: () => void
  readonly selectPanel: (id: MainPanelId) => void
  readonly setPinned: (id: string, pinned: boolean) => void
  readonly trackEntryClick: (attributes: SidebarEntryClick) => void
  readonly useRemoteAccess: (capability: 'session/create') => boolean
  readonly usePanels: SnapshotSelectorHook<readonly SidebarPanelMetadata[]>
  readonly useEntryPins: SnapshotSelectorHook<readonly string[]>
  readonly useEntryActions: SnapshotSelectorHook<boolean>
  readonly useShortcuts: SnapshotSelectorHook<readonly SidebarShortcut[]>
  readonly usePanelInfo: SnapshotSelectorHook<PanelInfo>
  readonly t: (key: SidebarKey) => string
  readonly renderSlot: RenderSidebarSlot
}
