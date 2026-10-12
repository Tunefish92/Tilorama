import { ImageDown } from 'lucide-react'
import './DropOverlay.css'

export function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <div className={`drop-overlay${visible ? ' is-visible' : ''}`} aria-hidden={!visible}>
      <div className="drop-overlay__frame">
        <span className="drop-overlay__icon">
          <ImageDown size={24} strokeWidth={1.8} />
        </span>
        <strong>Drop to open</strong>
        <span>The image will be tiled and cached on this PC</span>
      </div>
    </div>
  )
}
