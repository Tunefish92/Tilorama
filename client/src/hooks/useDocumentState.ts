import { useEffect, useSyncExternalStore } from 'react'
import { useAppStore } from '../store/useAppStore'

/** Applies the theme preference as data-theme on <html> (CSS handles "system" via prefers-color-scheme). */
export function useTheme() {
  const theme = useAppStore((s) => s.viewer.theme)
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
  }, [theme])
}

const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange)
  return () => document.removeEventListener('fullscreenchange', onChange)
}

export function useIsFullscreen(): boolean {
  return useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement != null)
}
