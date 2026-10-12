import { api, ApiError, deleteImage, uploadImage, watchJob } from '../api/client'
import type { AppSettings, ImageMeta, JobSnapshot, OpenResult } from '../api/types'
import { formatBytes, formatDuration, formatNumber } from '../lib/format'
import { createPreviewUrl, revokePreviewUrl } from '../lib/preview'
import { toast, useAppStore, type DeletionState, type Task } from '../store/useAppStore'

export const ACCEPTED_FILES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/gif', 'image/avif', 'image/heic', 'image/heif', 'image/svg+xml',
  '.jpg', '.jpeg', '.jfif', '.png', '.webp', '.tif', '.tiff', '.gif', '.avif', '.heic', '.heif', '.svg', '.v',
].join(',')

export const FORMAT_HINT = 'JPEG · PNG · WebP · TIFF · GIF · AVIF/HEIF · SVG'

const store = useAppStore

let taskToken = 0
let uploadAbort: AbortController | null = null
let stopWatching: (() => void) | null = null

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
const isCurrent = (token: number) => store.getState().task?.token === token

function patchTask(token: number, patch: Partial<Task>) {
  store.setState((state) => (state.task?.token === token ? { task: { ...state.task, ...patch } } : state))
}

function startTask(task: Omit<Task, 'token' | 'startedAt'>): number {
  cancelTask({ silent: true })
  const token = ++taskToken
  store.setState({ task: { ...task, token, startedAt: Date.now() } })
  return token
}

function finishTask(token: number) {
  const task = store.getState().task
  if (task?.token !== token) return
  revokePreviewUrl(task.previewUrl)
  stopWatching?.()
  stopWatching = null
  store.setState({ task: null })
}

// ------------------------------------------------------------------ opening

export function openFilePicker() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = ACCEPTED_FILES
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) void openFile(file)
  }
  input.click()
}

/** Upload → (cache hit | tiling job with live progress) → viewer. */
export async function openFile(file: File) {
  const token = startTask({
    fileName: file.name,
    fileSize: file.size,
    width: null,
    height: null,
    previewUrl: null,
    stage: 'upload',
    hasUpload: true,
    upload: { loaded: 0, total: file.size, bytesPerSecond: 0, etaMs: null },
    jobId: null,
    job: null,
  })

  void createPreviewUrl(file).then((url) => {
    if (isCurrent(token)) patchTask(token, { previewUrl: url })
    else revokePreviewUrl(url)
  })

  uploadAbort = new AbortController()
  try {
    const result = await uploadImage(
      file,
      (progress) => patchTask(token, { upload: progress, stage: progress.loaded >= progress.total ? 'verify' : 'upload' }),
      uploadAbort.signal,
    )
    if (isCurrent(token)) followOpenResult(token, result, true)
  } catch (error) {
    if (isAbort(error) || !isCurrent(token)) return
    finishTask(token)
    toast.error('Could not open image', errorMessage(error))
  } finally {
    uploadAbort = null
  }
}

/** Re-tiles the current image's original with the current server settings. */
export async function regenerateCurrentImage() {
  const image = store.getState().image
  if (!image) return
  const token = startTask({
    fileName: image.fileName,
    fileSize: image.fileSize,
    width: image.width,
    height: image.height,
    previewUrl: image.thumbUrl,
    stage: 'queued',
    hasUpload: false,
    upload: null,
    jobId: null,
    job: null,
  })

  try {
    const result = await api.openSource(image.sourceSha)
    if (isCurrent(token)) followOpenResult(token, result, false)
  } catch (error) {
    if (!isCurrent(token)) return
    finishTask(token)
    const message = error instanceof ApiError && error.status === 404
      ? 'The original was evicted from the cache. Please open the file again.'
      : errorMessage(error)
    toast.error('Could not regenerate tiles', message)
  }
}

export async function openRecent(image: ImageMeta) {
  try {
    showImage(await api.image(image.id))
  } catch (error) {
    toast.error('Could not open image', errorMessage(error))
    void refreshRecent()
  }
}

function followOpenResult(token: number, result: OpenResult, fromUpload: boolean) {
  if (result.status === 'ready' && result.image) {
    finishTask(token)
    showImage(result.image)
    if (fromUpload) toast.success('Opened from cache', 'Tiles for this image already existed.')
    return
  }

  patchTask(token, {
    stage: 'queued',
    jobId: result.jobId,
    width: result.source?.width ?? null,
    height: result.source?.height ?? null,
  })
  stopWatching = watchJob(
    result.jobId!,
    (job) => onJobUpdate(token, job),
    () => {
      if (!isCurrent(token)) return
      finishTask(token)
      toast.error('Lost connection to the tiling job', 'The server may have restarted. Please open the image again.')
    },
  )
}

function onJobUpdate(token: number, job: JobSnapshot) {
  if (!isCurrent(token)) return
  switch (job.stage) {
    case 'done':
      finishTask(token)
      if (job.image) {
        showImage(job.image)
        toast.success('Tiles ready', `${formatNumber(job.image.tileCount)} tiles generated in ${formatDuration(job.elapsedMs)}`)
      }
      void refreshCache()
      break
    case 'failed':
      finishTask(token)
      toast.error('Tiling failed', job.error ?? job.message)
      break
    case 'cancelled':
      finishTask(token)
      break
    default:
      patchTask(token, { stage: job.stage, job, width: job.width, height: job.height })
  }
}

export function cancelTask({ silent = false } = {}) {
  const task = store.getState().task
  if (!task) return
  uploadAbort?.abort()
  const jobId = task.job?.jobId ?? task.jobId
  if (jobId) void api.cancelJob(jobId).catch(() => undefined)
  finishTask(task.token)
  if (!silent) toast.info('Cancelled', task.fileName)
}

function showImage(image: ImageMeta) {
  store.setState({ image })
  document.title = `${image.fileName} · Tilorama`
  void refreshRecent()
}

export function closeImage() {
  store.setState({ image: null })
  document.title = 'Tilorama'
  void refreshRecent()
}

// ------------------------------------------------------- settings & cache

export async function loadServerState() {
  const [settings, cache, recent] = await Promise.all([api.settings(), api.cache(), api.recent()])
  store.setState({ settings, cache, recent })
}

export async function refreshCache() {
  try {
    store.setState({ cache: await api.cache() })
  } catch {
    // health polling reports connectivity problems
  }
}

export async function refreshRecent() {
  try {
    store.setState({ recent: await api.recent() })
  } catch {
    // health polling reports connectivity problems
  }
}

export async function saveSettings(settings: AppSettings): Promise<boolean> {
  try {
    store.setState({ settings: await api.saveSettings(settings) })
    void refreshCache()
    return true
  } catch (error) {
    toast.error('Settings not saved', errorMessage(error))
    return false
  }
}

/** How long the finished card stays ("Removed") and fades out before the list refreshes. */
const REMOVED_LINGER_MS = 700

export async function deleteRecent(image: ImageMeta) {
  if (store.getState().deleting[image.id]) return
  const setDeletion = (deletion: DeletionState | null) =>
    store.setState((state) => {
      const deleting = { ...state.deleting }
      if (deletion) deleting[image.id] = deletion
      else delete deleting[image.id]
      return { deleting }
    })

  setDeletion({ deleted: 0, total: 0, done: false })
  try {
    let total = 0
    await deleteImage(image.id, (progress) => {
      total = progress.totalFiles
      setDeletion({ deleted: progress.deletedFiles, total, done: false })
    })
    setDeletion({ deleted: total, total, done: true })
    await new Promise((resolve) => window.setTimeout(resolve, REMOVED_LINGER_MS))
    if (store.getState().image?.id === image.id) closeImage()
    await Promise.all([refreshRecent(), refreshCache()])
    toast.success('Removed from cache', `${image.fileName} · ${formatBytes(image.sizeBytes)} freed`)
  } catch (error) {
    toast.error('Could not delete', errorMessage(error))
  } finally {
    setDeletion(null)
  }
}

export async function clearCache() {
  try {
    const cache = await api.clearCache()
    store.setState({ cache, image: null, recent: [] })
    document.title = 'Tilorama'
    toast.success('Cache cleared')
  } catch (error) {
    toast.error('Could not clear the cache', errorMessage(error))
  }
}
