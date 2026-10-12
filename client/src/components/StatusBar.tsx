import { CircleAlert, CircleCheck, Crosshair, HardDrive, Layers, LoaderCircle, RotateCw, SquareCenterlineDashedVertical } from 'lucide-react'
import { formatBytes, formatMegapixels, formatNumber, formatPercent } from '../lib/format'
import { useAppStore, type TaskStage } from '../store/useAppStore'
import { useViewerStats } from '../store/useViewerStats'
import './StatusBar.css'

function Connection() {
  const backend = useAppStore((s) => s.backend)
  const version = useAppStore((s) => s.health?.vipsVersion)
  const label = {
    connecting: 'Connecting to tile server…',
    online: `Tile server · libvips ${version ?? ''}`,
    offline: 'Tile server offline · reconnecting…',
  }[backend]
  return (
    <span className={`status-item status-conn is-${backend}`} title={label}>
      <span className="status-conn__dot" />
      <span className="status-conn__label">{label}</span>
    </span>
  )
}

function ImageInfo() {
  const image = useAppStore((s) => s.image)
  if (!image) return null
  const { tiling } = image
  return (
    <>
      <span className="status-item status-hide-sm" title="Image size">
        {image.loader.toUpperCase()} · {formatNumber(image.width)} × {formatNumber(image.height)} px · {formatMegapixels(image.width, image.height)}
      </span>
      <span className="status-item status-hide-md" title="Tile pyramid">
        <Layers size={13} />
        {tiling.tileSize} px {tiling.format.toUpperCase()} · levels {image.minLevel}–{image.maxLevel} · {formatNumber(image.tileCount)} tiles
      </span>
    </>
  )
}

const TASK_LABELS: Record<TaskStage, string> = {
  upload: 'Uploading',
  verify: 'Verifying',
  queued: 'Queued',
  analyzing: 'Analyzing',
  tiling: 'Generating tiles',
  thumbnail: 'Creating preview',
  finalizing: 'Finalizing',
}

function TaskInfo() {
  const task = useAppStore((s) => s.task)
  if (!task) return null
  const percent =
    task.stage === 'upload' && task.upload
      ? (task.upload.loaded / Math.max(task.upload.total, 1)) * 100
      : task.stage === 'tiling'
        ? (task.job?.percent ?? 0)
        : null
  return (
    <span className="status-item status-task">
      <LoaderCircle size={13} className="spinner" />
      {TASK_LABELS[task.stage]}
      {percent != null && (
        <>
          <span className="status-meter">
            <span style={{ width: `${percent}%` }} />
          </span>
          <span className="mono">{Math.round(percent)} %</span>
        </>
      )}
    </span>
  )
}

function Cursor() {
  const cursor = useViewerStats((s) => s.cursor)
  const hasImage = useAppStore((s) => s.image !== null)
  if (!hasImage) return null
  return (
    <span className="status-item status-cursor mono" title="Image pixel under the cursor">
      <Crosshair size={13} />
      {cursor ? (
        <>
          <span>X {formatNumber(cursor.x)}</span>
          <span>Y {formatNumber(cursor.y)}</span>
        </>
      ) : (
        <span className="status-faint">–</span>
      )}
    </span>
  )
}

function View() {
  const zoom = useViewerStats((s) => s.zoom)
  const rotation = useViewerStats((s) => s.rotation)
  const flipped = useViewerStats((s) => s.flipped)
  const hasImage = useAppStore((s) => s.image !== null)
  if (!hasImage) return null
  return (
    <>
      {rotation !== 0 && (
        <span className="status-item mono" title="Rotation">
          <RotateCw size={13} /> {rotation}°
        </span>
      )}
      {flipped && (
        <span className="status-item" title="Mirrored">
          <SquareCenterlineDashedVertical size={13} /> Flipped
        </span>
      )}
      <span className="status-item status-zoom mono" title="Zoom (100 % = one image pixel per screen pixel)">
        {zoom ? formatPercent(zoom * 100) : '–'}
      </span>
    </>
  )
}

function Tiles() {
  const loading = useViewerStats((s) => s.loadingView)
  const loaded = useViewerStats((s) => s.tilesLoaded)
  const failed = useViewerStats((s) => s.tilesFailed)
  const done = useViewerStats((s) => s.viewTilesLoaded)
  const total = useViewerStats((s) => s.viewTilesNeeded)
  const hasImage = useAppStore((s) => s.image !== null)
  if (!hasImage) return null
  return (
    <span className="status-item status-tiles" title={`${formatNumber(loaded)} tiles loaded in this session`}>
      {loading ? (
        <>
          <LoaderCircle size={13} className="spinner" /> Loading tiles
          <span className="status-meter">
            <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </span>
          <span className="mono">
            {formatNumber(done)} / {formatNumber(total)}
          </span>
        </>
      ) : (
        <>
          <CircleCheck size={13} className="status-ok" /> Tiles loaded
        </>
      )}
      {failed > 0 && (
        <span className="status-error">
          <CircleAlert size={13} /> {formatNumber(failed)} failed
        </span>
      )}
    </span>
  )
}

function Cache() {
  const cache = useAppStore((s) => s.cache)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  if (!cache) return null
  const ratio = Math.min(1, cache.totalBytes / Math.max(cache.limitBytes, 1))
  return (
    <button
      type="button"
      className="status-item status-cache"
      onClick={() => setSettingsOpen(true)}
      title={`Tile cache: ${cache.imageCount} images in ${cache.root}`}
    >
      <HardDrive size={13} />
      <span className="status-meter">
        <span style={{ width: `${ratio * 100}%` }} className={ratio > 0.9 ? 'is-full' : undefined} />
      </span>
      {formatBytes(cache.totalBytes)} / {formatBytes(cache.limitBytes, 0)}
    </button>
  )
}

// "2026", from the next year on "2026–2027", "2026–2028", ...
const COPYRIGHT_START = 2026

function Copyright() {
  const year = new Date().getFullYear()
  return (
    <span className="status-item status-copyright">
      © {year > COPYRIGHT_START ? `${COPYRIGHT_START}–${year}` : COPYRIGHT_START} by
      <a href="https://github.com/Tunefish92" target="_blank" rel="noreferrer">
        Tunefish
      </a>
    </span>
  )
}

export function StatusBar() {
  return (
    <footer className="statusbar">
      <Connection />
      <ImageInfo />
      <TaskInfo />
      <span className="statusbar__spacer" />
      <Cursor />
      <View />
      <Tiles />
      <Cache />
      <Copyright />
    </footer>
  )
}
