export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : digits)} ${units[exponent]}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–'
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${Math.round(seconds % 60)} s`
}

export function formatMegapixels(width: number, height: number): string {
  const mp = (width * height) / 1e6
  if (mp >= 1000) return `${(mp / 1000).toFixed(2)} GP`
  return `${mp >= 10 ? mp.toFixed(0) : mp.toFixed(1)} MP`
}

export const formatNumber = (value: number) => value.toLocaleString()

export function formatPercent(value: number): string {
  if (value >= 1000) return `${Math.round(value).toLocaleString()} %`
  if (value >= 10) return `${Math.round(value)} %`
  return `${value.toFixed(1)} %`
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
