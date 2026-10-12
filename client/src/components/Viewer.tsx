import { CircleCheck, LoaderCircle } from 'lucide-react'
import { useRef } from 'react'
import type { ImageMeta } from '../api/types'
import { formatNumber } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { useViewerStats } from '../store/useViewerStats'
import { useOpenSeadragon } from '../viewer/useOpenSeadragon'
import './Viewer.css'

/**
 * Bottom-center status while tiles stream in: "Loading tiles · 12 of 20" with a progress bar.
 * CSS delays the appearance (no flicker for instant loads) and lets "All tiles loaded" linger briefly.
 */
function TileProgress() {
  const loading = useViewerStats((s) => s.loadingView)
  const done = useViewerStats((s) => s.viewTilesLoaded)
  const total = useViewerStats((s) => s.viewTilesNeeded)
  const failed = useViewerStats((s) => s.tilesFailed)
  const percent = total > 0 ? (done / total) * 100 : 0

  return (
    <div className={`tile-progress card${loading ? ' is-active' : ''}`} role="status" aria-live="polite">
      <div className="tile-progress__row">
        {loading ? <LoaderCircle size={15} className="spinner" /> : <CircleCheck size={15} className="tile-progress__ok" />}
        <span className="tile-progress__label">{loading ? 'Loading tiles' : 'All tiles loaded'}</span>
        <span className="tile-progress__count mono">
          {formatNumber(loading ? done : total)} of {formatNumber(total)}
          {failed > 0 && <span className="tile-progress__failed"> · {formatNumber(failed)} failed</span>}
        </span>
        <span className="tile-progress__percent mono">{Math.round(loading ? percent : 100)} %</span>
      </div>
      <div className="tile-progress__bar">
        <span className="progress-fill" style={{ width: `${loading ? percent : 100}%` }} />
      </div>
    </div>
  )
}

export function Viewer({ image }: { image: ImageMeta }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const settings = useAppStore((s) => s.viewer)
  const firstLoadDone = useViewerStats((s) => s.firstLoadDone)

  useOpenSeadragon(containerRef, image, settings)

  return (
    <div className={`viewer${firstLoadDone ? ' is-ready' : ''}`}>
      {/* Ambient backdrop: shows instantly (tiny thumbnail) while the first tiles stream in. */}
      <img key={image.id} className="viewer__ambient" src={image.thumbUrl} alt="" aria-hidden="true" />
      <div ref={containerRef} className="viewer__canvas" aria-label={`Image viewer: ${image.fileName}`} />
      <TileProgress />
    </div>
  )
}
