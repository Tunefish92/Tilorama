import { create } from 'zustand'

/**
 * Live numbers from the viewer. Kept in their own store and updated at most once per animation frame,
 * so only the few components that display them re-render while the user pans and zooms.
 */
export interface ViewerStats {
  /** 1 = one image pixel per CSS pixel. */
  zoom: number
  rotation: number
  flipped: boolean
  /** Image pixel under the mouse, null when outside the image. */
  cursor: { x: number; y: number } | null
  tilesLoaded: number
  tilesLoading: number
  tilesFailed: number
  /** Tiles of the sharpest level for the visible area, and how many of them have arrived. */
  viewTilesNeeded: number
  viewTilesLoaded: number
  /** True while the visible area is still missing sharp tiles and the loader is working on them. */
  loadingView: boolean
  fullyLoaded: boolean
  /** Becomes true once the first full view has loaded after opening an image. */
  firstLoadDone: boolean
}

export const initialViewerStats: ViewerStats = {
  zoom: 0,
  rotation: 0,
  flipped: false,
  cursor: null,
  tilesLoaded: 0,
  tilesLoading: 0,
  tilesFailed: 0,
  viewTilesNeeded: 0,
  viewTilesLoaded: 0,
  loadingView: false,
  fullyLoaded: false,
  firstLoadDone: false,
}

export const useViewerStats = create<ViewerStats>()(() => initialViewerStats)
