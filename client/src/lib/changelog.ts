import changelogMarkdown from '../../../CHANGELOG.md?raw'
import { APP_VERSION, compareVersions, parseVersion } from './version'

export interface ChangeSection {
  /** Empty for entries that come before the first "###" heading. */
  title: string
  items: string[]
}

export interface Release {
  version: string
  date: string
  sections: ChangeSection[]
}

/**
 * Reads CHANGELOG.md: "## 1.2.0 – 2026-10-12" starts a version, "### Title" a section, "* text" an entry
 * (indented lines continue it). Other text, like an intro line or "## Unreleased", is left out.
 */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = []
  let release: Release | null = null
  let items: string[] | null = null

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      const [version, ...rest] = line.slice(3).trim().split(/\s+/)
      release = parseVersion(version) ? { version, date: rest.filter((part) => /\d/.test(part)).join(' '), sections: [] } : null
      if (release) releases.push(release)
      items = null
    } else if (!release) {
      continue
    } else if (line.startsWith('### ')) {
      items = []
      release.sections.push({ title: line.slice(4).trim(), items })
    } else if (/^[*-] /.test(line)) {
      if (!items) {
        items = []
        release.sections.push({ title: '', items })
      }
      items.push(line.slice(2).trim())
    } else if (/^\s+\S/.test(line) && items?.length) {
      items[items.length - 1] += ` ${line.trim()}`
    }
  }
  return releases.filter((r) => r.sections.some((section) => section.items.length))
}

/** Newest first, without versions newer than this build (e.g. notes written ahead of a release). */
export const releases: Release[] = (() => {
  const current = parseVersion(APP_VERSION)
  return parseChangelog(changelogMarkdown).filter((release) => {
    const version = parseVersion(release.version)
    return version && (!current || compareVersions(version, current) <= 0)
  })
})()

const SEEN_KEY = 'tilorama.seen-version'
// Written by versions that had no changelog yet: a browser that has it was here before.
const LEGACY_KEY = 'tilorama.viewer-settings'

export function markVersionSeen() {
  try {
    localStorage.setItem(SEEN_KEY, APP_VERSION)
  } catch {
    // storage unavailable (private mode) – the window then shows again next time
  }
}

/**
 * What to show once after an update: every release since the version this browser saw last.
 * Empty for a browser that is here for the first time or already saw this version.
 */
export function unseenReleases(): Release[] {
  let seen: string | null
  try {
    seen = localStorage.getItem(SEEN_KEY)
    if (seen === null && localStorage.getItem(LEGACY_KEY) === null) return []
  } catch {
    return []
  }
  if (seen === APP_VERSION) return []
  const since = parseVersion(seen)
  return releases.filter((release) => {
    const version = parseVersion(release.version)
    return version && (!since || compareVersions(version, since) > 0)
  })
}
