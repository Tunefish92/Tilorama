import OpenSeadragon from 'openseadragon'
import { useEffect, useRef, type RefObject } from 'react'
import { tileExtension, type ImageMeta } from '../api/types'
import type { ViewerSettings } from '../store/useAppStore'
import { initialViewerStats, useViewerStats, type ViewerStats } from '../store/useViewerStats'
import { setActiveViewer } from './viewerApi'

/** Custom tile source: exact level range from the server, so no requests for levels that don't exist. */
function createTileSource(image: ImageMeta) {
  const extension = tileExtension(image.tiling)
  return {
    width: image.width,
    height: image.height,
    tileSize: image.tiling.tileSize,
    tileOverlap: image.tiling.overlap,
    minLevel: image.minLevel,
    maxLevel: image.maxLevel,
    getTileUrl: (level: number, x: number, y: number) => `${image.tileBaseUrl}/${level}/${x}_${y}.${extension}`,
  }
}

/** Settings OpenSeadragon only reads at runtime from these properties; they aren't part of its typings. */
function applyLiveSettings(viewer: OpenSeadragon.Viewer, settings: ViewerSettings) {
  Object.assign(viewer, { zoomPerScroll: settings.zoomPerScroll })
  Object.assign(viewer.viewport, { maxZoomPixelRatio: settings.maxZoom })
  viewer.viewport.applyConstraints()
  if (viewer.navigator) viewer.navigator.element.style.display = settings.showMinimap ? '' : 'none'
  viewer.setDebugMode(settings.showTileGrid)
  viewer.forceRedraw()
}

/**
 * Counts the tiles OpenSeadragon needs for a sharp picture of the visible area, and how many it has.
 * It renders the highest level where one level pixel covers at least minPixelRatio (0.5) device
 * pixels, i.e. level = maxLevel + floor(log2(2 · zoom · devicePixelRatio)).
 */
function visibleTiles(
  viewer: OpenSeadragon.Viewer,
  item: OpenSeadragon.TiledImage,
  image: ImageMeta,
  available: ReadonlySet<string>,
) {
  const zoom = item.viewportToImageZoom(viewer.viewport.getZoom(true))
  if (!(zoom > 0)) return { needed: 0, loaded: 0 }
  const ideal = image.maxLevel + Math.floor(Math.log2(2 * zoom * window.devicePixelRatio))
  const level = Math.min(image.maxLevel, Math.max(image.minLevel, ideal))

  const scale = 2 ** (level - image.maxLevel)
  const tileSize = image.tiling.tileSize
  const cols = Math.ceil(Math.ceil(image.width * scale) / tileSize)
  const rows = Math.ceil(Math.ceil(image.height * scale) / tileSize)

  // Visible part of the image (bounding box, so rotation is covered too), in level pixels.
  const rect = item.viewportToImageRectangle(viewer.viewport.getBounds(true).getBoundingBox())
  const left = Math.max(0, rect.x) * scale
  const top = Math.max(0, rect.y) * scale
  const right = Math.min(image.width, rect.x + rect.width) * scale
  const bottom = Math.min(image.height, rect.y + rect.height) * scale
  if (right <= left || bottom <= top) return { needed: 0, loaded: 0 }

  const x0 = Math.floor(left / tileSize)
  const x1 = Math.min(cols - 1, Math.ceil(right / tileSize) - 1)
  const y0 = Math.floor(top / tileSize)
  const y1 = Math.min(rows - 1, Math.ceil(bottom / tileSize) - 1)

  let needed = 0
  let loaded = 0
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      needed++
      if (available.has(`${level}/${x}/${y}`)) loaded++
    }
  }
  return { needed, loaded }
}

/**
 * Publishes zoom, rotation, cursor position and tile loading numbers to {@link useViewerStats},
 * batched to one store update per animation frame.
 */
function trackStats(viewer: OpenSeadragon.Viewer, element: HTMLElement, image: ImageMeta): () => void {
  let frame = 0
  let pointer: OpenSeadragon.Point | null = null
  let loaded = 0
  let failed = 0

  const publish = (patch: Partial<ViewerStats>) => {
    const current = useViewerStats.getState()
    const changed = (Object.keys(patch) as (keyof ViewerStats)[]).some((key) => current[key] !== patch[key])
    if (changed) useViewerStats.setState(patch)
  }

  const update = () => {
    frame = 0
    const item = viewer.world.getItemAt(0)
    if (!item) return
    const viewport = viewer.viewport
    let cursor: ViewerStats['cursor'] = null
    if (pointer) {
      const p = item.viewerElementToImageCoordinates(pointer)
      const size = item.getContentSize()
      if (p.x >= 0 && p.y >= 0 && p.x < size.x && p.y < size.y) cursor = { x: Math.floor(p.x), y: Math.floor(p.y) }
    }
    const previous = useViewerStats.getState().cursor
    publish({
      zoom: item.viewportToImageZoom(viewport.getZoom(true)),
      rotation: ((Math.round(viewport.getRotation(true)) % 360) + 360) % 360,
      flipped: viewport.getFlip(),
      // keep the object identity when nothing changed, so subscribers don't re-render
      cursor: cursor && previous && cursor.x === previous.x && cursor.y === previous.y ? previous : cursor,
    })
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }

  const onPointerMove = (event: PointerEvent) => {
    const rect = element.getBoundingClientRect()
    pointer = new OpenSeadragon.Point(event.clientX - rect.left, event.clientY - rect.top)
    schedule()
  }
  const onPointerLeave = () => {
    pointer = null
    schedule()
  }
  element.addEventListener('pointermove', onPointerMove, { passive: true })
  element.addEventListener('pointerleave', onPointerLeave, { passive: true })

  viewer.addHandler('open', schedule)
  viewer.addHandler('animation', schedule)
  viewer.addHandler('animation-finish', schedule)
  viewer.addHandler('rotate', schedule)
  viewer.addHandler('flip', schedule)
  viewer.addHandler('resize', schedule)
  // Tiles currently held by the viewer (failed ones count as done, so progress can't get stuck).
  const available = new Set<string>()
  const key = (tile: OpenSeadragon.Tile) => `${tile.level}/${tile.x}/${tile.y}`
  viewer.addHandler('tile-loaded', (event) => {
    loaded++
    available.add(key(event.tile))
  })
  viewer.addHandler('tile-load-failed', (event) => {
    failed++
    available.add(key(event.tile))
  })
  viewer.addHandler('tile-unloaded', (event) => void available.delete(key(event.tile)))

  // Loader queue and completeness aren't evented; sampling them 10×/s is cheap and keeps the progress bar smooth.
  const poll = window.setInterval(() => {
    const item = viewer.world.getItemAt(0)
    if (!item) return
    const pending = viewer.imageLoader.jobsInProgress + viewer.imageLoader.jobQueue.length
    const view = visibleTiles(viewer, item, image, available)
    const fullyLoaded = item.getFullyLoaded()
    const stats = useViewerStats.getState()
    publish({
      tilesLoaded: loaded,
      tilesFailed: failed,
      tilesLoading: pending,
      viewTilesNeeded: view.needed,
      viewTilesLoaded: view.loaded,
      // pending === 0 also ends it, in case OpenSeadragon settles on a different level than computed
      loadingView: pending > 0 && view.loaded < view.needed,
      fullyLoaded,
      firstLoadDone: stats.firstLoadDone || fullyLoaded,
    })
  }, 100)

  return () => {
    cancelAnimationFrame(frame)
    window.clearInterval(poll)
    element.removeEventListener('pointermove', onPointerMove)
    element.removeEventListener('pointerleave', onPointerLeave)
  }
}

/** Owns the OpenSeadragon instance for the given container and image. */
export function useOpenSeadragon(
  containerRef: RefObject<HTMLDivElement | null>,
  image: ImageMeta,
  settings: ViewerSettings,
) {
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const settingsRef = useRef(settings)

  useEffect(() => {
    settingsRef.current = settings
  })

  // Spring timing is fixed at construction, so a new animation time needs a new viewer.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const initial = settingsRef.current
    useViewerStats.setState({ ...initialViewerStats })

    const viewer = new OpenSeadragon.Viewer({
      element,
      tileSources: createTileSource(image),
      drawer: ['webgl', 'canvas'],
      showNavigationControl: false,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      navigatorAutoFade: false,
      navigatorSizeRatio: 0.16,
      animationTime: initial.animationTime,
      blendTime: 0.15,
      immediateRender: false,
      imageLoaderLimit: 8,
      maxImageCacheCount: 600,
      maxZoomPixelRatio: initial.maxZoom,
      minZoomImageRatio: 0.5,
      visibilityRatio: 0.25,
      constrainDuringPan: false,
      zoomPerScroll: initial.zoomPerScroll,
      zoomPerClick: 2,
      gestureSettingsMouse: {
        clickToZoom: false,
        dblClickToZoom: true,
        scrollToZoom: true,
        dragToPan: true,
        flickEnabled: true,
        flickMomentum: 0.3,
      },
      keyboardNavEnabled: false, // global shortcuts handle keys, independent of focus
      preserveImageSizeOnResize: true,
      crossOriginPolicy: false,
      timeout: 60_000,
      debugMode: initial.showTileGrid,
    })
    viewerRef.current = viewer
    setActiveViewer(viewer)
    const stopTracking = trackStats(viewer, element, image)
    if (viewer.isOpen()) applyLiveSettings(viewer, initial)
    else viewer.addOnceHandler('open', () => applyLiveSettings(viewer, settingsRef.current))

    return () => {
      stopTracking()
      setActiveViewer(null)
      viewerRef.current = null
      viewer.destroy()
    }
  }, [containerRef, image, settings.animationTime])

  useEffect(() => {
    const viewer = viewerRef.current
    if (viewer?.isOpen()) applyLiveSettings(viewer, settings)
  }, [settings])
}
