import { Check, Clipboard, Clock, ImagePlus, Layers, LoaderCircle, Trash, TriangleAlert } from 'lucide-react'
import type { ImageMeta } from '../api/types'
import { deleteRecent, FORMAT_HINT, openFilePicker, openRecent } from '../app/actions'
import { formatBytes, formatMegapixels, formatNumber, formatRelativeTime } from '../lib/format'
import { useAppStore, type DeletionState } from '../store/useAppStore'
import './DropZone.css'

/** Overlay on the thumbnail while the tiles are deleted: label, progress bar, file count. */
function DeletionOverlay({ deletion }: { deletion: DeletionState }) {
  const percent = deletion.done ? 100 : deletion.total > 0 ? (deletion.deleted / deletion.total) * 100 : 0
  return (
    <span className={`deletion${deletion.done ? ' is-done' : ''}`} role="status">
      <span className="deletion__label">
        {deletion.done ? <Check size={15} strokeWidth={3} /> : <LoaderCircle size={15} className="spinner" />}
        {deletion.done ? 'Removed' : 'Deleting tiles…'}
        <span className="deletion__percent mono">{Math.round(percent)} %</span>
      </span>
      <span className={`deletion__bar${deletion.total === 0 && !deletion.done ? ' is-indeterminate' : ''}`}>
        <span className="progress-fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="deletion__count mono">
        {deletion.total > 0 ? `${formatNumber(deletion.deleted)} / ${formatNumber(deletion.total)} files` : 'Preparing…'}
      </span>
    </span>
  )
}

function RecentCard({ image }: { image: ImageMeta }) {
  const deletion = useAppStore((s) => s.deleting[image.id])
  const state = deletion ? (deletion.done ? ' is-deleting is-removed' : ' is-deleting') : ''
  return (
    <li className={`recent-card${state}`}>
      <button
        type="button"
        className="recent-card__open"
        onClick={() => void openRecent(image)}
        title={`Open ${image.fileName}`}
        disabled={deletion !== undefined}
      >
        <span className="recent-card__thumb">
          <img src={image.thumbUrl} alt="" loading="lazy" />
          {deletion && <DeletionOverlay deletion={deletion} />}
        </span>
        <span className="recent-card__body">
          <span className="recent-card__name">{image.fileName}</span>
          <span className="recent-card__meta">
            {image.width.toLocaleString()} × {image.height.toLocaleString()} · {formatMegapixels(image.width, image.height)}
          </span>
          <span className="recent-card__meta">
            <Layers size={12} /> {image.tiling.tileSize} px {image.tiling.format.toUpperCase()} · {formatBytes(image.sizeBytes)}
          </span>
          <span className="recent-card__meta recent-card__time">
            <Clock size={12} /> {formatRelativeTime(image.lastAccessedUtc)}
          </span>
        </span>
      </button>
      {!deletion && (
        <button
          type="button"
          className="recent-card__delete"
          onClick={() => void deleteRecent(image)}
          aria-label={`Remove ${image.fileName} from the cache`}
          title="Remove from cache"
        >
          <Trash size={14} />
        </button>
      )}
    </li>
  )
}

export function DropZone() {
  const backend = useAppStore((s) => s.backend)
  const recent = useAppStore((s) => s.recent)
  const offline = backend === 'offline'

  return (
    <div className="dropzone">
      <div className="dropzone__backdrop" aria-hidden="true">
        <div className="dropzone__grid" />
      </div>

      <div className="dropzone__content">
        <section className="dropzone__card card" aria-labelledby="dropzone-title">
          <button type="button" className="dropzone__target" onClick={openFilePicker} disabled={offline}>
            <span className="dropzone__icon">
              <ImagePlus size={26} strokeWidth={1.8} />
            </span>
            <span id="dropzone-title" className="dropzone__title">
              Drop an image to start
            </span>
            <span className="dropzone__subtitle">
              Big images are cut into tiles like a map and cached on this PC, so they stay fast at any zoom level.
            </span>
            <span className="btn btn--primary btn--lg dropzone__browse">Browse files</span>
          </button>

          {offline ? (
            <p className="dropzone__warning">
              <TriangleAlert size={16} />
              <span>
                The tile server is offline. Start it with <code>dotnet run</code> in <code>server/Tilorama.Server</code>. This page
                reconnects automatically.
              </span>
            </p>
          ) : (
            <p className="dropzone__hint">
              <span>{FORMAT_HINT}</span>
              <span className="dropzone__dot" />
              <span>
                <Clipboard size={13} /> Paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>
              </span>
            </p>
          )}
        </section>

        {recent.length > 0 && (
          <section className="recent" aria-labelledby="recent-title">
            <h2 id="recent-title" className="recent__title">
              Recently opened <span>· from the tile cache</span>
            </h2>
            <ul className="recent__list">
              {recent.map((image) => (
                <RecentCard key={image.id} image={image} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
