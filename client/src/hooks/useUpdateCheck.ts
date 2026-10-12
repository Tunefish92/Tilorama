import { useEffect, useState } from 'react'
import { APP_VERSION, compareVersions, parseVersion, REPOSITORY } from '../lib/version'

export interface AvailableUpdate {
  version: string
  url: string
}

interface CachedReleases {
  at: number
  list: { tag: string; url: string }[]
}

const CACHE_KEY = 'tilorama.releases'
// GitHub allows 60 anonymous requests per hour and address.
const CHECK_INTERVAL = 6 * 3600e3

async function publishedReleases(): Promise<CachedReleases['list']> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as CachedReleases | null
    if (cached && Date.now() - cached.at < CHECK_INTERVAL) return cached.list
  } catch {
    // no usable cache
  }
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (response.status === 404) return [] // nothing published yet
  if (!response.ok) throw new Error(`GitHub answered with HTTP ${response.status}`)
  const list = ((await response.json()) as { tag_name: string; html_url: string; draft: boolean; prerelease: boolean }[])
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => ({ tag: release.tag_name, url: release.html_url }))
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), list } satisfies CachedReleases))
  } catch {
    // storage unavailable – checked again on the next load
  }
  return list
}

async function findUpdate(): Promise<AvailableUpdate | null> {
  const current = parseVersion(APP_VERSION)
  if (!current) return null
  const newest = (await publishedReleases())
    .map((release) => ({ ...release, parsed: parseVersion(release.tag) }))
    .filter((release) => release.parsed !== null)
    .sort((a, b) => compareVersions(b.parsed!, a.parsed!))[0]
  if (!newest || compareVersions(newest.parsed!, current) <= 0) return null
  return { version: newest.tag.replace(/^v/, ''), url: newest.url }
}

/** The newest release on GitHub if it is newer than this build, checked at start and every few hours. */
export function useUpdateCheck(): AvailableUpdate | null {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null)

  useEffect(() => {
    let disposed = false
    const check = () =>
      findUpdate().then(
        (found) => {
          if (!disposed) setUpdate(found)
        },
        () => {
          // GitHub not reachable or rate-limited: no badge, try again at the next interval
        },
      )
    void check()
    const timer = window.setInterval(check, CHECK_INTERVAL)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  return update
}
