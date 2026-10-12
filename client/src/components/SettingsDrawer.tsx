import { Copy, Monitor, Moon, RefreshCw, Sun, Trash, TriangleAlert, X } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { AppSettings, ImageMeta, PyramidDepth, TileFormat, TilingSettings } from '../api/types'
import { clearCache, regenerateCurrentImage, saveSettings } from '../app/actions'
import { formatBytes, formatNumber } from '../lib/format'
import { toast, useAppStore, type Theme } from '../store/useAppStore'
import './SettingsDrawer.css'

const DEFAULT_SERVER_SETTINGS: AppSettings = {
  tiling: { tileSize: 512, overlap: 1, format: 'webp', quality: 85, depth: 'onePixel' },
  cacheLimitGb: 10,
}

// ------------------------------------------------------------ primitives

interface Option<T> {
  value: T
  label: ReactNode
  title?: string
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'is-selected' : undefined}
          onClick={() => onChange(option.value)}
          disabled={disabled}
          title={option.title}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
  label,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format: (value: number) => string
  disabled?: boolean
  label: string
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="slider__value mono">{format(value)}</span>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle__thumb" />
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">{label}</div>
      {children}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div>
        <div className="field__label">{label}</div>
        {hint && <div className="field__hint">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

// --------------------------------------------------------------- helpers

/** Level count and tile count the pyramid would have for a given image and tiling. */
function estimatePyramid(width: number, height: number, tiling: TilingSettings) {
  const maxLevel = Math.ceil(Math.log2(Math.max(width, height, 1)))
  let levels = 0
  let tiles = 0
  for (let level = maxLevel; level >= 0; level--) {
    const scale = 2 ** (maxLevel - level)
    const w = Math.ceil(width / scale)
    const h = Math.ceil(height / scale)
    levels++
    tiles += Math.ceil(w / tiling.tileSize) * Math.ceil(h / tiling.tileSize)
    if (tiling.depth === 'oneTile' && w <= tiling.tileSize && h <= tiling.tileSize) break
  }
  return { levels, tiles }
}

const sameServerSettings = (a: AppSettings, b: AppSettings) =>
  a.cacheLimitGb === b.cacheLimitGb &&
  a.tiling.tileSize === b.tiling.tileSize &&
  a.tiling.overlap === b.tiling.overlap &&
  a.tiling.format === b.tiling.format &&
  a.tiling.quality === b.tiling.quality &&
  a.tiling.depth === b.tiling.depth

const describeTiling = (t: TilingSettings) => `${t.tileSize} px ${t.format.toUpperCase()}${t.format === 'png' ? '' : ` Q${t.quality}`}`

// ------------------------------------------------------------- sections

function TilingSection({
  draft,
  setDraft,
  image,
}: {
  draft: AppSettings
  setDraft: (settings: AppSettings) => void
  image: ImageMeta | null
}) {
  const tiling = draft.tiling
  const patch = (update: Partial<TilingSettings>) => setDraft({ ...draft, tiling: { ...tiling, ...update } })
  const estimate = image ? estimatePyramid(image.width, image.height, tiling) : null

  return (
    <section className="drawer-section">
      <h3>Tiling</h3>
      <Field label="Tile size" hint="Larger tiles mean fewer requests, smaller tiles appear sooner.">
        <Segmented
          label="Tile size"
          value={tiling.tileSize}
          onChange={(tileSize) => patch({ tileSize })}
          options={[64, 128, 256, 512, 1024, 2048].map((size) => ({ value: size, label: size }))}
        />
      </Field>
      <Field
        label="Zoom levels"
        hint={
          estimate
            ? `For the open image: ${estimate.levels} zoom levels, ≈ ${formatNumber(estimate.tiles)} tiles.`
            : 'The full pyramid lets you zoom out to a single dot.'
        }
      >
        <Segmented<PyramidDepth>
          label="Pyramid depth"
          value={tiling.depth}
          onChange={(depth) => patch({ depth })}
          options={[
            { value: 'onePixel', label: 'Full pyramid', title: 'Every level down to 1 × 1 px (standard Deep Zoom)' },
            { value: 'oneTile', label: 'Until one tile', title: 'Stop once the image fits into a single tile' },
          ]}
        />
      </Field>
      <Field
        label="Format"
        hint={
          {
            webp: 'WebP: small files, fast to decode. Recommended.',
            jpeg: 'JPEG: fastest to encode, slightly larger files.',
            png: 'PNG: lossless and keeps transparency, but large.',
          }[tiling.format]
        }
      >
        <Segmented<TileFormat>
          label="Tile format"
          value={tiling.format}
          onChange={(format) => patch({ format })}
          options={[
            { value: 'webp', label: 'WebP' },
            { value: 'jpeg', label: 'JPEG' },
            { value: 'png', label: 'PNG' },
          ]}
        />
      </Field>
      <Field label="Quality">
        <Slider
          label="Quality"
          value={tiling.quality}
          min={40}
          max={100}
          step={1}
          onChange={(quality) => patch({ quality })}
          format={(v) => (tiling.format === 'png' ? 'lossless' : String(v))}
          disabled={tiling.format === 'png'}
        />
      </Field>
      <Field label="Tile overlap" hint="A pixel of overlap hides seams between tiles while zooming.">
        <Slider label="Tile overlap" value={tiling.overlap} min={0} max={4} step={1} onChange={(overlap) => patch({ overlap })} format={(v) => `${v} px`} />
      </Field>
    </section>
  )
}

function ViewerSection() {
  const viewer = useAppStore((s) => s.viewer)
  const setViewerSettings = useAppStore((s) => s.setViewerSettings)

  return (
    <section className="drawer-section">
      <h3>Viewer</h3>
      <Field label="Maximum zoom" hint="How far you can zoom in beyond the native resolution.">
        <Segmented
          label="Maximum zoom"
          value={viewer.maxZoom}
          onChange={(maxZoom) => setViewerSettings({ maxZoom })}
          options={[1, 2, 4, 8, 16].map((factor) => ({ value: factor, label: `${factor * 100}%` }))}
        />
      </Field>
      <Field label="Mouse wheel zoom step">
        <Slider
          label="Mouse wheel zoom step"
          value={viewer.zoomPerScroll}
          min={1.1}
          max={2}
          step={0.05}
          onChange={(zoomPerScroll) => setViewerSettings({ zoomPerScroll })}
          format={(v) => `×${v.toFixed(2)}`}
        />
      </Field>
      <Field label="Animation duration">
        <Slider
          label="Animation duration"
          value={viewer.animationTime}
          min={0.2}
          max={2}
          step={0.1}
          onChange={(animationTime) => setViewerSettings({ animationTime })}
          format={(v) => `${v.toFixed(1)} s`}
        />
      </Field>
      <Row label="Minimap" hint="Overview in the corner, drag it to navigate.">
        <Toggle label="Minimap" checked={viewer.showMinimap} onChange={(showMinimap) => setViewerSettings({ showMinimap })} />
      </Row>
      <Row label="Tile boundaries" hint="Debug overlay showing each tile and its level.">
        <Toggle label="Tile boundaries" checked={viewer.showTileGrid} onChange={(showTileGrid) => setViewerSettings({ showTileGrid })} />
      </Row>
      <Field label="Theme">
        <Segmented<Theme>
          label="Theme"
          value={viewer.theme}
          onChange={(theme) => setViewerSettings({ theme })}
          options={[
            { value: 'system', label: <><Monitor size={14} /> System</> },
            { value: 'dark', label: <><Moon size={14} /> Dark</> },
            { value: 'light', label: <><Sun size={14} /> Light</> },
          ]}
        />
      </Field>
    </section>
  )
}

function CacheSection({ draft, setDraft }: { draft: AppSettings; setDraft: (settings: AppSettings) => void }) {
  const cache = useAppStore((s) => s.cache)
  const [confirming, setConfirming] = useState(false)

  const onClear = () => {
    if (!confirming) {
      setConfirming(true)
      window.setTimeout(() => setConfirming(false), 4000)
      return
    }
    setConfirming(false)
    void clearCache()
  }

  const copyPath = () => {
    if (!cache) return
    navigator.clipboard.writeText(cache.root).then(
      () => toast.info('Path copied', cache.root),
      () => toast.error('Could not copy the path'),
    )
  }

  const ratio = cache ? Math.min(1, cache.totalBytes / Math.max(cache.limitBytes, 1)) : 0

  return (
    <section className="drawer-section">
      <h3>Cache</h3>
      {cache && (
        <>
          <Field label="Location">
            <div className="cache-path">
              <span className="code" title={cache.root}>
                {cache.root}
              </span>
              <button type="button" className="btn btn--ghost btn--small" onClick={copyPath} aria-label="Copy path">
                <Copy size={14} />
              </button>
            </div>
          </Field>
          <Field label="Usage">
            <div className="usage">
              <div className="usage__bar">
                <span style={{ width: `${ratio * 100}%` }} className={ratio > 0.9 ? 'is-full' : undefined} />
              </div>
              <div className="field__hint">
                {formatBytes(cache.totalBytes)} of {formatBytes(cache.limitBytes, 0)} · {cache.imageCount} tile sets ({formatBytes(cache.tileBytes)}) ·{' '}
                {cache.sourceCount} originals ({formatBytes(cache.sourceBytes)})
              </div>
            </div>
          </Field>
        </>
      )}
      <Field label="Size limit (GB)" hint="Least recently used images are removed automatically when the limit is exceeded.">
        <Segmented
          label="Cache size limit"
          value={draft.cacheLimitGb}
          onChange={(cacheLimitGb) => setDraft({ ...draft, cacheLimitGb })}
          options={[2, 5, 10, 25, 50, 100, 150, 200, 250].map((gb) => ({ value: gb, label: gb, title: `${gb} GB` }))}
        />
      </Field>
      <button type="button" className={`btn btn--danger clear-button${confirming ? ' is-confirming' : ''}`} onClick={onClear}>
        <Trash size={15} />
        {confirming ? 'Click again to delete all cached tiles' : 'Clear cache'}
      </button>
    </section>
  )
}

const SHORTCUTS: [string, string][] = [
  ['O', 'Open image'],
  ['Ctrl + V', 'Paste image'],
  ['+ / −', 'Zoom in / out'],
  ['Wheel', 'Zoom at cursor'],
  ['Drag', 'Pan'],
  ['Double-click', 'Zoom in (Shift: out)'],
  ['0', 'Fit to screen'],
  ['1', 'Actual size'],
  ['R / Shift + R', 'Rotate right / left'],
  ['H / V', 'Flip horizontal / vertical'],
  ['← ↑ → ↓', 'Pan'],
  ['M', 'Minimap'],
  ['G', 'Tile boundaries'],
  ['F', 'Fullscreen'],
  ['Esc', 'Close / cancel'],
]

function ShortcutSection() {
  return (
    <section className="drawer-section">
      <h3>Keyboard & mouse</h3>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys}>
            <dt>
              {keys.split(' / ').map((k, i) => (
                <span key={k}>
                  {i > 0 && ' / '}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// ------------------------------------------------------------------ drawer

function SettingsContent({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((s) => s.settings)
  const image = useAppStore((s) => s.image)
  const busy = useAppStore((s) => s.task !== null)
  const [draft, setDraft] = useState<AppSettings | null>(settings)
  const [saving, setSaving] = useState(false)

  const dirty = settings !== null && draft !== null && !sameServerSettings(settings, draft)
  const outdated = image !== null && settings?.tiling.cacheKey != null && image.tiling.cacheKey !== settings.tiling.cacheKey

  const apply = async () => {
    if (!draft) return
    setSaving(true)
    await saveSettings(draft)
    setSaving(false)
  }

  return (
    <>
      <div className="drawer__body">
        {outdated && settings && !dirty && (
          <div className="notice">
            <TriangleAlert size={16} />
            <div>
              <p>
                The open image uses <strong>{describeTiling(image.tiling)}</strong> tiles, the settings say{' '}
                <strong>{describeTiling(settings.tiling)}</strong>.
              </p>
              <button
                type="button"
                className="btn btn--primary btn--small"
                disabled={busy}
                onClick={() => {
                  onClose()
                  void regenerateCurrentImage()
                }}
              >
                <RefreshCw size={14} /> Regenerate tiles
              </button>
            </div>
          </div>
        )}

        {draft ? (
          <TilingSection draft={draft} setDraft={setDraft} image={image} />
        ) : (
          <section className="drawer-section">
            <h3>Tiling</h3>
            <p className="field__hint">Tiling settings are stored by the tile server, which is not reachable right now.</p>
          </section>
        )}
        <ViewerSection />
        {draft && <CacheSection draft={draft} setDraft={setDraft} />}
        <ShortcutSection />
      </div>

      {draft && (
        <footer className="drawer__footer">
          <button type="button" className="btn btn--ghost" onClick={() => setDraft(DEFAULT_SERVER_SETTINGS)}>
            Defaults
          </button>
          <span className="drawer__footer-note">{dirty ? 'Unsaved changes' : 'Viewer options apply instantly'}</span>
          <button type="button" className="btn btn--primary" disabled={!dirty || saving} onClick={() => void apply()}>
            {saving ? 'Saving…' : 'Apply'}
          </button>
        </footer>
      )}
    </>
  )
}

export function SettingsDrawer() {
  const open = useAppStore((s) => s.settingsOpen)
  const hasSettings = useAppStore((s) => s.settings !== null)
  const setOpen = useAppStore((s) => s.setSettingsOpen)
  const close = () => setOpen(false)

  return (
    <div className={`drawer-root${open ? ' is-open' : ''}`} inert={!open}>
      <div className="drawer-scrim" onClick={close} />
      <aside className="drawer card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="drawer__header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="tool-button" onClick={close} aria-label="Close settings">
            <X size={18} />
          </button>
        </header>
        {/* Remount on open so the draft starts from the saved settings. */}
        <SettingsContent key={`${open}-${hasSettings}`} onClose={close} />
      </aside>
    </div>
  )
}
