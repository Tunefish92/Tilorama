import { useEffect } from 'react'
import { cancelTask, openFilePicker } from '../app/actions'
import { markVersionSeen } from '../lib/changelog'
import { useAppStore } from '../store/useAppStore'
import { toggleFullscreen, viewerApi } from '../viewer/viewerApi'

const PAN_STEP = 0.2

/** Global shortcuts, active regardless of focus (except while typing in a form field). */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const state = useAppStore.getState()
      if (event.key === 'Escape') {
        if (state.changelog !== 'closed') {
          markVersionSeen()
          state.setChangelog('closed')
        } else if (state.settingsOpen) state.setSettingsOpen(false)
        else if (state.task) cancelTask()
        return
      }
      if (state.changelog !== 'closed' || state.settingsOpen || state.task) return

      const actions: Record<string, () => void> = {
        o: openFilePicker,
        s: () => state.setSettingsOpen(true),
        f: toggleFullscreen,
        '+': viewerApi.zoomIn,
        '=': viewerApi.zoomIn,
        '-': viewerApi.zoomOut,
        '0': viewerApi.fit,
        '1': viewerApi.actualSize,
        r: viewerApi.rotateRight,
        R: viewerApi.rotateLeft,
        h: viewerApi.flipHorizontal,
        v: viewerApi.flipVertical,
        m: () => state.setViewerSettings({ showMinimap: !state.viewer.showMinimap }),
        g: () => state.setViewerSettings({ showTileGrid: !state.viewer.showTileGrid }),
        ArrowLeft: () => viewerApi.pan(-PAN_STEP, 0),
        ArrowRight: () => viewerApi.pan(PAN_STEP, 0),
        ArrowUp: () => viewerApi.pan(0, -PAN_STEP),
        ArrowDown: () => viewerApi.pan(0, PAN_STEP),
      }
      const action = actions[event.key]
      if (action) {
        event.preventDefault()
        action()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
