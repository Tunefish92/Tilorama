import { useEffect } from 'react'
import { api } from '../api/client'
import { loadServerState, refreshCache } from '../app/actions'
import { toast, useAppStore } from '../store/useAppStore'

const ONLINE_INTERVAL = 5000
const OFFLINE_INTERVAL = 2000
const CACHE_REFRESH_EVERY = 6 // polls

/** Polls /api/health, keeps the connection indicator current and (re)loads server state after (re)connecting. */
export function useBackendHealth() {
  useEffect(() => {
    let timer = 0
    let disposed = false
    let polls = 0

    const poll = async () => {
      const previous = useAppStore.getState().backend
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3000)
      try {
        const health = await api.health(controller.signal)
        if (disposed) return
        useAppStore.setState({ health, backend: 'online' })
        if (previous !== 'online') {
          await loadServerState()
          if (previous === 'offline') toast.success('Tile server connected')
        } else if (++polls % CACHE_REFRESH_EVERY === 0) {
          void refreshCache()
        }
      } catch {
        if (disposed) return
        useAppStore.setState({ backend: 'offline' })
        if (previous !== 'offline') {
          toast.error(
            'Tile server not reachable',
            'Start the backend with "dotnet run" in server/Tilorama.Server. Reconnecting automatically…',
          )
        }
      } finally {
        window.clearTimeout(timeout)
      }
      if (!disposed) {
        const delay = useAppStore.getState().backend === 'online' ? ONLINE_INTERVAL : OFFLINE_INTERVAL
        timer = window.setTimeout(poll, delay)
      }
    }

    void poll()
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [])
}
