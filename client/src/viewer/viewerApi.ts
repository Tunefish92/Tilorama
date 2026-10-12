import OpenSeadragon from 'openseadragon'

/**
 * Imperative commands for the single OpenSeadragon instance, used by the header and keyboard shortcuts.
 * They talk to the viewer directly instead of going through React state, so nothing re-renders.
 */
let current: OpenSeadragon.Viewer | null = null

export function setActiveViewer(viewer: OpenSeadragon.Viewer | null) {
  current = viewer
}

function withViewport(action: (viewport: OpenSeadragon.Viewport, viewer: OpenSeadragon.Viewer) => void) {
  if (current?.world.getItemCount()) action(current.viewport, current)
}

const ZOOM_STEP = 1.5

export const viewerApi = {
  zoomIn: () => withViewport((vp) => vp.zoomBy(ZOOM_STEP).applyConstraints()),
  zoomOut: () => withViewport((vp) => vp.zoomBy(1 / ZOOM_STEP).applyConstraints()),
  fit: () => withViewport((vp) => vp.goHome()),
  /** One image pixel per screen (CSS) pixel. */
  actualSize: () =>
    withViewport((vp, viewer) => {
      vp.zoomTo(viewer.world.getItemAt(0).imageToViewportZoom(1)).applyConstraints()
    }),
  rotateLeft: () => withViewport((vp) => vp.rotateBy(-90)),
  rotateRight: () => withViewport((vp) => vp.rotateBy(90)),
  flipHorizontal: () => withViewport((vp) => vp.toggleFlip()),
  /** OpenSeadragon only flips horizontally; a vertical flip equals a horizontal flip plus a half turn. */
  flipVertical: () =>
    withViewport((vp) => {
      vp.toggleFlip()
      vp.rotateBy(180)
    }),
  reset: () =>
    withViewport((vp) => {
      vp.setFlip(false)
      vp.setRotation(0)
      vp.goHome()
    }),
  /** Pans by a fraction of the visible area, in screen directions (respects rotation and flip). */
  pan: (dx: number, dy: number) =>
    withViewport((vp) => {
      const size = vp.getContainerSize()
      const delta = vp.deltaPointsFromPixels(new OpenSeadragon.Point(size.x * dx, size.y * dy))
      vp.panBy(delta).applyConstraints()
    }),
}

export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen().catch(() => undefined)
}
