import {
  isTerminal,
  type AppSettings,
  type CacheStats,
  type Health,
  type ImageMeta,
  type JobSnapshot,
  type OpenResult,
} from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const OFFLINE_MESSAGE = 'The tile server is not reachable. Is the backend running?'

/** Extracts a readable message from an RFC 7807 problem response. */
function problemMessage(body: string, status: number): string {
  try {
    const problem = JSON.parse(body) as { detail?: string; title?: string; errors?: Record<string, string[]> }
    if (problem.errors) return Object.values(problem.errors).flat().join(' ')
    return problem.detail ?? problem.title ?? `Request failed (HTTP ${status})`
  } catch {
    return `Request failed (HTTP ${status})`
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(OFFLINE_MESSAGE, 0)
  }
  if (!response.ok) throw new ApiError(problemMessage(await response.text(), response.status), response.status)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  health: (signal?: AbortSignal) => request<Health>('/api/health', { signal }),
  settings: () => request<AppSettings>('/api/settings'),
  saveSettings: (settings: AppSettings) => request<AppSettings>('/api/settings', json('PUT', settings)),
  cache: () => request<CacheStats>('/api/cache'),
  clearCache: () => request<CacheStats>('/api/cache', { method: 'DELETE' }),
  recent: () => request<ImageMeta[]>('/api/images'),
  image: (id: string) => request<ImageMeta>(`/api/images/${encodeURIComponent(id)}`),
  openSource: (sha: string) => request<OpenResult>(`/api/sources/${encodeURIComponent(sha)}/open`, { method: 'POST' }),
  cancelJob: (jobId: string) => request<void>(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }),
}

export interface DeleteProgress {
  deletedFiles: number
  totalFiles: number
}

/** Deletes a cached image; the server streams its progress as one JSON object per line. */
export async function deleteImage(id: string, onProgress: (progress: DeleteProgress) => void): Promise<void> {
  let response: Response
  try {
    response = await fetch(`/api/images/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, 0)
  }
  if (!response.ok || !response.body) throw new ApiError(problemMessage(await response.text(), response.status), response.status)

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) onProgress(JSON.parse(line) as DeleteProgress)
    }
  }
}

export interface UploadProgress {
  loaded: number
  total: number
  bytesPerSecond: number
  etaMs: number | null
}

/**
 * Streams the raw file to the server. XHR instead of fetch, because only XHR reports upload progress.
 */
export function uploadImage(
  file: File,
  onProgress: (progress: UploadProgress) => void,
  signal: AbortSignal,
): Promise<OpenResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let lastLoaded = 0
    let lastTime = performance.now()
    let rate = 0

    xhr.open('POST', '/api/images')
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))

    xhr.upload.onprogress = (event) => {
      const now = performance.now()
      const dt = now - lastTime
      if (dt > 50) {
        const instant = ((event.loaded - lastLoaded) / dt) * 1000
        rate = rate ? rate * 0.7 + instant * 0.3 : instant // smoothed, so the ETA doesn't jump around
        lastLoaded = event.loaded
        lastTime = now
      }
      const total = event.lengthComputable ? event.total : file.size
      onProgress({
        loaded: event.loaded,
        total,
        bytesPerSecond: rate,
        etaMs: rate > 0 ? ((total - event.loaded) / rate) * 1000 : null,
      })
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as OpenResult)
      else reject(new ApiError(problemMessage(xhr.responseText, xhr.status), xhr.status))
    }
    xhr.onerror = () => reject(new ApiError(OFFLINE_MESSAGE, 0))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort(), { once: true })

    xhr.send(file)
  })
}

/**
 * Follows a tiling job via Server-Sent Events. EventSource reconnects on its own after hiccups;
 * `onLost` fires only when the stream is gone for good (e.g. server restarted, job unknown).
 */
export function watchJob(jobId: string, onUpdate: (job: JobSnapshot) => void, onLost: () => void): () => void {
  const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`)
  source.onmessage = (event) => {
    const job = JSON.parse(event.data as string) as JobSnapshot
    onUpdate(job)
    if (isTerminal(job.stage)) source.close()
  }
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) onLost()
  }
  return () => source.close()
}
