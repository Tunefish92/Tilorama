import { ExternalLink, X } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { markVersionSeen, releases, unseenReleases, type Release } from '../lib/changelog'
import { APP_VERSION, REPOSITORY_URL } from '../lib/version'
import { useAppStore } from '../store/useAppStore'
import { Logo } from './Header'
import './ChangelogModal.css'

/** The changelog's own emphasis: **bold** and `code`. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, index) => {
    if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    return <Fragment key={index}>{part}</Fragment>
  })
}

function ReleaseNotes({ release, showVersion }: { release: Release; showVersion: boolean }) {
  return (
    <section className="news-release">
      {showVersion && (
        <h3 className="news-version">
          Version {release.version}
          {release.date && <span>{release.date}</span>}
        </h3>
      )}
      {release.sections.map((section, index) => (
        <Fragment key={index}>
          {section.title && <h4>{section.title}</h4>}
          <ul>
            {section.items.map((item, itemIndex) => (
              <li key={itemIndex}>{inline(item)}</li>
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  )
}

/** What is new: opens by itself once after an update, and from the version badge in the header. */
export function ChangelogModal() {
  const mode = useAppStore((s) => s.changelog)
  const setChangelog = useAppStore((s) => s.setChangelog)
  if (mode === 'closed') return null

  const afterUpdate = mode === 'update'
  const shown = afterUpdate ? unseenReleases() : releases
  const close = () => {
    markVersionSeen()
    setChangelog('closed')
  }

  return (
    <div className="news-root" onClick={(event) => event.target === event.currentTarget && close()}>
      <div className="news-card card" role="dialog" aria-modal="true" aria-labelledby="news-title">
        <header className="news-header">
          <Logo />
          <div>
            <p className="news-kicker">{afterUpdate ? 'Updated' : 'Changelog'}</p>
            <h2 id="news-title">{afterUpdate ? `What is new in version ${APP_VERSION}` : `Tilorama ${APP_VERSION}`}</h2>
          </div>
          <button type="button" className="tool-button" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="news-body">
          {shown.map((release) => (
            <ReleaseNotes key={release.version} release={release} showVersion={!afterUpdate || shown.length > 1} />
          ))}
        </div>
        <footer className="news-footer">
          <a href={`${REPOSITORY_URL}/releases`} target="_blank" rel="noreferrer">
            All releases on GitHub <ExternalLink size={13} />
          </a>
          <button type="button" className="btn btn--primary" onClick={close} autoFocus>
            Got it
          </button>
        </footer>
      </div>
    </div>
  )
}
