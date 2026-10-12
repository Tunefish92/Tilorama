export const APP_VERSION = __APP_VERSION__
export const REPOSITORY = 'Tunefish92/Tilorama'
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`

export interface SemVer {
  numbers: number[]
  pre: string[]
}

/** "v1.2.0-beta.3" → { numbers: [1, 2, 0], pre: ['beta', '3'] }; null if it is not a version. */
export function parseVersion(version: string | null | undefined): SemVer | null {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/.exec((version ?? '').trim())
  return match && { numbers: match[1].split('.').map(Number), pre: match[2] ? match[2].split('.') : [] }
}

/** Semantic version order: 1.2.0-beta.1 < 1.2.0-beta.2 < 1.2.0 < 1.2.1. */
export function compareVersions(a: SemVer, b: SemVer): number {
  for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i++) {
    const diff = (a.numbers[i] ?? 0) - (b.numbers[i] ?? 0)
    if (diff) return diff
  }
  // a full release beats its pre-releases
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1
    if (b.pre[i] === undefined) return 1
    const numericA = /^\d+$/.test(a.pre[i])
    const numericB = /^\d+$/.test(b.pre[i])
    const diff =
      numericA && numericB ? Number(a.pre[i]) - Number(b.pre[i]) : numericA ? -1 : numericB ? 1 : a.pre[i].localeCompare(b.pre[i])
    if (diff) return diff
  }
  return 0
}
