import { create } from 'zustand'
import type { UploadProgress } from '../api/client'
import type { AppSettings, CacheStats, Health, ImageMeta, JobSnapshot, JobStage } from '../api/types'
import { markVersionSeen, unseenReleases } from '../lib/changelog'

/** Where a running "open image" task currently is. */
export type TaskStage = 'upload' | 'verify' | Exclude<JobStage, 'done' | 'failed' | 'cancelled'>

export interface Task {
  /** Increments per task, so callbacks of a replaced task can be ignored. */
  token: number
  fileName: string
  fileSize: number | null
  width: number | null
  height: number | null
  /** Blurred backdrop: a local preview while uploading, or the cached thumbnail when regenerating. */
  previewUrl: string | null
  stage: TaskStage
  /** False when re-tiling an already uploaded original. */
  hasUpload: boolean
  upload: UploadProgress | null
  jobId: string | null
  job: JobSnapshot | null
  startedAt: number
}

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
  action?: { label: string; run: () => void }
  duration: number
}

export type Theme = 'system' | 'dark' | 'light'

/** Viewer-only preferences, kept per browser in localStorage. */
export interface ViewerSettings {
  /** Maximum zoom relative to native resolution (OpenSeadragon maxZoomPixelRatio). */
  maxZoom: number
  zoomPerScroll: number
  animationTime: number
  showMinimap: boolean
  showTileGrid: boolean
  theme: Theme
}

export const defaultViewerSettings: ViewerSettings = {
  maxZoom: 4,
  zoomPerScroll: 1.3,
  animationTime: 0.8,
  showMinimap: true,
  showTileGrid: false,
  theme: 'system',
}

const VIEWER_SETTINGS_KEY = 'tilorama.viewer-settings'

function loadViewerSettings(): ViewerSettings {
  try {
    const raw = localStorage.getItem(VIEWER_SETTINGS_KEY)
    return raw ? { ...defaultViewerSettings, ...(JSON.parse(raw) as Partial<ViewerSettings>) } : defaultViewerSettings
  } catch {
    return defaultViewerSettings
  }
}

function saveViewerSettings(settings: ViewerSettings) {
  try {
    localStorage.setItem(VIEWER_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // storage unavailable (private mode) – settings just won't persist
  }
}

/** The "what is new" window: closed, opened by itself after an update, or opened from the version badge. */
export type ChangelogMode = 'closed' | 'update' | 'all'

function initialChangelogMode(): ChangelogMode {
  if (unseenReleases().length) return 'update'
  markVersionSeen()
  return 'closed'
}

export type BackendState = 'connecting' | 'online' | 'offline'

/** A cached image being removed; drives the progress overlay on its card. */
export interface DeletionState {
  deleted: number
  total: number
  done: boolean
}

interface AppState {
  image: ImageMeta | null
  task: Task | null
  settings: AppSettings | null
  cache: CacheStats | null
  health: Health | null
  backend: BackendState
  recent: ImageMeta[]
  /** Keyed by image id. */
  deleting: Record<string, DeletionState>
  settingsOpen: boolean
  changelog: ChangelogMode
  toasts: Toast[]
  viewer: ViewerSettings

  setViewerSettings: (patch: Partial<ViewerSettings>) => void
  setSettingsOpen: (open: boolean) => void
  setChangelog: (mode: ChangelogMode) => void
  pushToast: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => number
  dismissToast: (id: number) => void
}

let nextToastId = 0

export const useAppStore = create<AppState>()((set) => ({
  image: null,
  task: null,
  settings: null,
  cache: null,
  health: null,
  backend: 'connecting',
  recent: [],
  deleting: {},
  settingsOpen: false,
  changelog: initialChangelogMode(),
  toasts: [],
  viewer: loadViewerSettings(),

  setViewerSettings: (patch) =>
    set((state) => {
      const viewer = { ...state.viewer, ...patch }
      saveViewerSettings(viewer)
      return { viewer }
    }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setChangelog: (mode) => set({ changelog: mode }),
  pushToast: (toast) => {
    const id = ++nextToastId
    const duration = toast.duration ?? (toast.kind === 'error' ? 9000 : 4500)
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, duration, id }] }))
    return id
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  info: (title: string, message?: string) => useAppStore.getState().pushToast({ kind: 'info', title, message }),
  success: (title: string, message?: string) => useAppStore.getState().pushToast({ kind: 'success', title, message }),
  error: (title: string, message?: string, action?: Toast['action']) =>
    useAppStore.getState().pushToast({ kind: 'error', title, message, action }),
}
