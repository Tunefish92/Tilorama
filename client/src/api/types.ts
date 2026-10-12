// Mirrors the JSON contracts of the ASP.NET Core backend (server/Tilorama.Server/Models).

export type TileFormat = 'webp' | 'jpeg' | 'png'
export type PyramidDepth = 'onePixel' | 'oneTile'

export interface TilingSettings {
  tileSize: number
  overlap: number
  format: TileFormat
  quality: number
  depth: PyramidDepth
  /** Computed by the server, ignored when sent back. */
  extension?: string
  cacheKey?: string
}

export interface AppSettings {
  tiling: TilingSettings
  cacheLimitGb: number
}

export interface SourceInfo {
  sha: string
  fileName: string
  extension: string
  fileSize: number
  loader: string
  width: number
  height: number
  uploadedUtc: string
}

export interface ImageMeta {
  id: string
  sourceSha: string
  fileName: string
  fileSize: number
  loader: string
  width: number
  height: number
  bands: number
  tiling: TilingSettings
  minLevel: number
  maxLevel: number
  tileCount: number
  sizeBytes: number
  tilingMs: number
  createdUtc: string
  lastAccessedUtc: string
  tileBaseUrl: string
  thumbUrl: string
}

export interface OpenResult {
  status: 'ready' | 'processing'
  imageId: string
  image: ImageMeta | null
  jobId: string | null
  source: SourceInfo | null
}

export type JobStage =
  | 'queued'
  | 'analyzing'
  | 'tiling'
  | 'thumbnail'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface JobSnapshot {
  jobId: string
  imageId: string
  fileName: string
  width: number
  height: number
  stage: JobStage
  percent: number
  message: string
  elapsedMs: number
  etaMs: number | null
  image: ImageMeta | null
  error: string | null
}

export interface CacheStats {
  root: string
  totalBytes: number
  tileBytes: number
  sourceBytes: number
  imageCount: number
  sourceCount: number
  limitBytes: number
}

export interface Health {
  status: string
  vipsVersion: string
  cacheRoot: string
  activeJobs: number
}

export const isTerminal = (stage: JobStage) => stage === 'done' || stage === 'failed' || stage === 'cancelled'

export const tileExtension = (tiling: TilingSettings) =>
  tiling.extension ?? (tiling.format === 'jpeg' ? 'jpg' : tiling.format)
