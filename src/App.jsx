import { useEffect, useState } from 'react'
import { configured } from './supabase.js'
import Registry from './views/Registry.jsx'
import CheckIn from './views/CheckIn.jsx'
import Builder from './views/Builder.jsx'
import Settings from './views/Settings.jsx'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const fn = () => setHash(window.location.hash)
    window.addEventListener('hashchange', fn)
    return () => window.removeEventListener('hashchange', fn)
  }, [])
  return hash
}

export default function App() {
  const hash = useHashRoute()

  if (!configured) {
    return (
      <div className="shell">
        <div className="setup-note">
          <h1>Almost there</h1>
          <p>
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>,
            then rebuild. See the README for the two-minute setup.
          </p>
        </div>
      </div>
    )
  }

  const eventMatch = hash.match(/^#\/event\/([0-9a-f-]{36})/)
  const isNew = hash.startsWith('#/new')
  const isSettings = hash.startsWith('#/settings')
  const home = !eventMatch && !isNew && !isSettings

  let view, pageTitle
  if (eventMatch) {
    view = <CheckIn key={eventMatch[1]} eventId={eventMatch[1]} />
    pageTitle = null
  } else if (isNew) {
    view = <Builder />
    pageTitle = 'New list'
  } else if (isSettings) {
    view = <Settings />
    pageTitle = 'Settings'
  } else {
    view = <Registry />
    pageTitle = 'Door Lists'
  }

  return (
    <div className="shell">
      <nav className="topnav">
        {home ? (
          <span className="topnav-brand">Door Lists</span>
        ) : (
          <a className="topnav-back" href="#/">← All lists</a>
        )}
        {home && (
          <a className="topnav-gear" href="#/settings" aria-label="Settings">⚙</a>
        )}
      </nav>
      {pageTitle && !home && <h1 className="page-title">{pageTitle}</h1>}
      <main>{view}</main>
    </div>
  )
}
