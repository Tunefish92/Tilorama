import {
  Grid3x3,
  ImageUp,
  Map as MapIcon,
  Maximize,
  Minimize,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Scan,
  Settings,
  SquareCenterlineDashedHorizontal,
  SquareCenterlineDashedVertical,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { closeImage, openFilePicker } from '../app/actions'
import { useIsFullscreen } from '../hooks/useDocumentState'
import { useUpdateCheck } from '../hooks/useUpdateCheck'
import { formatMegapixels, formatPercent } from '../lib/format'
import { APP_VERSION } from '../lib/version'
import { useAppStore } from '../store/useAppStore'
import { useViewerStats } from '../store/useViewerStats'
import { toggleFullscreen, viewerApi } from '../viewer/viewerApi'
import { ToolButton } from './ToolButton'
import './Header.css'

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="9" fill="#142423" stroke="#375b59" strokeWidth="1" />
      <rect x="9" y="9" width="10" height="10" rx="2.5" fill="#9cf3da" />
      <rect x="21" y="9" width="10" height="10" rx="2.5" fill="#5fd9b5" opacity="0.45" />
      <rect x="9" y="21" width="10" height="10" rx="2.5" fill="#5fd9b5" opacity="0.45" />
      <rect x="21" y="21" width="10" height="10" rx="2.5" fill="#5fd9b5" opacity="0.9" />
    </svg>
  )
}

function ZoomReadout({ disabled }: { disabled: boolean }) {
  const zoom = useViewerStats((s) => s.zoom)
  return (
    <button
      type="button"
      className="zoom-readout mono"
      onClick={viewerApi.actualSize}
      disabled={disabled}
      data-tooltip="Actual size (100 %)  ·  1"
    >
      {disabled || !zoom ? '–' : formatPercent(zoom * 100)}
    </button>
  )
}

export function Header() {
  const image = useAppStore((s) => s.image)
  const busy = useAppStore((s) => s.task !== null)
  const showMinimap = useAppStore((s) => s.viewer.showMinimap)
  const showTileGrid = useAppStore((s) => s.viewer.showTileGrid)
  const setViewerSettings = useAppStore((s) => s.setViewerSettings)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setChangelog = useAppStore((s) => s.setChangelog)
  const update = useUpdateCheck()
  const fullscreen = useIsFullscreen()
  const off = !image

  return (
    <header className="header">
      <div className="header__brand">
        <Logo />
        <strong className="header__title">Tilorama</strong>
        <button
          type="button"
          className="header__version mono"
          onClick={() => setChangelog('all')}
          data-tooltip="What is new"
          aria-label={`Version ${APP_VERSION}: show what is new`}
        >
          v{APP_VERSION}
        </button>
        {update && (
          <a
            className="header__update"
            href={update.url}
            target="_blank"
            rel="noreferrer"
            data-tooltip={`Version ${update.version} is out  ·  release notes`}
          >
            <span className="header__update-dot" />
            <span className="header__update-label">Update available</span>
            <span className="mono">v{update.version}</span>
          </a>
        )}
      </div>

      {image && (
        <div className="header__file" title={image.fileName}>
          <span className="header__file-name">{image.fileName}</span>
          <span className="header__file-meta">
            {image.width.toLocaleString()} × {image.height.toLocaleString()} · {formatMegapixels(image.width, image.height)}
          </span>
          <button type="button" className="header__file-close" onClick={closeImage} aria-label="Close image" data-tooltip="Close image">
            <X size={14} />
          </button>
        </div>
      )}

      <nav className="toolbar" aria-label="Image tools">
        <div className="toolbar__group">
          <ToolButton icon={ZoomOut} label="Zoom out" shortcut="−" onClick={viewerApi.zoomOut} disabled={off} />
          <ZoomReadout disabled={off} />
          <ToolButton icon={ZoomIn} label="Zoom in" shortcut="+" onClick={viewerApi.zoomIn} disabled={off} />
        </div>
        <div className="toolbar__group">
          <ToolButton icon={Scan} label="Fit to screen" shortcut="0" onClick={viewerApi.fit} disabled={off} />
          <ToolButton label="Actual size" shortcut="1" onClick={viewerApi.actualSize} disabled={off}>
            <span className="tool-button__text">1:1</span>
          </ToolButton>
        </div>
        <div className="toolbar__group">
          <ToolButton icon={RotateCcw} label="Rotate left" shortcut="Shift+R" onClick={viewerApi.rotateLeft} disabled={off} />
          <ToolButton icon={RotateCw} label="Rotate right" shortcut="R" onClick={viewerApi.rotateRight} disabled={off} />
          <ToolButton icon={SquareCenterlineDashedVertical} label="Flip horizontally" shortcut="H" onClick={viewerApi.flipHorizontal} disabled={off} />
          <ToolButton icon={SquareCenterlineDashedHorizontal} label="Flip vertically" shortcut="V" onClick={viewerApi.flipVertical} disabled={off} />
        </div>
        <div className="toolbar__group">
          <ToolButton
            icon={MapIcon}
            label="Minimap"
            shortcut="M"
            active={showMinimap}
            onClick={() => setViewerSettings({ showMinimap: !showMinimap })}
            disabled={off}
          />
          <ToolButton
            icon={Grid3x3}
            label="Tile boundaries"
            shortcut="G"
            active={showTileGrid}
            onClick={() => setViewerSettings({ showTileGrid: !showTileGrid })}
            disabled={off}
          />
          <ToolButton icon={RefreshCcw} label="Reset view" onClick={viewerApi.reset} disabled={off} />
          <ToolButton
            icon={fullscreen ? Minimize : Maximize}
            label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            shortcut="F"
            onClick={toggleFullscreen}
          />
        </div>
      </nav>

      <div className="header__actions">
        <button type="button" className="btn btn--primary header__open" onClick={openFilePicker} disabled={busy} data-tooltip="Open image  ·  O">
          <ImageUp size={17} />
          <span>Open image</span>
        </button>
        <ToolButton icon={Settings} label="Settings" shortcut="S" onClick={() => setSettingsOpen(true)} tooltipAlign="end" />
      </div>
    </header>
  )
}
