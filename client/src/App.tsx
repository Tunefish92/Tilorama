import { ChangelogModal } from './components/ChangelogModal'
import { DropOverlay } from './components/DropOverlay'
import { DropZone } from './components/DropZone'
import { Header } from './components/Header'
import { ProcessingOverlay } from './components/ProcessingOverlay'
import { SettingsDrawer } from './components/SettingsDrawer'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { Viewer } from './components/Viewer'
import { useBackendHealth } from './hooks/useBackendHealth'
import { useTheme } from './hooks/useDocumentState'
import { useFileDrop } from './hooks/useFileDrop'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useAppStore } from './store/useAppStore'
import './App.css'

export default function App() {
  const image = useAppStore((s) => s.image)
  const dragging = useFileDrop()
  useBackendHealth()
  useKeyboardShortcuts()
  useTheme()

  return (
    <div className="app">
      <Header />
      <main className="stage">
        {image ? <Viewer image={image} /> : <DropZone />}
        <ProcessingOverlay />
      </main>
      <StatusBar />
      <SettingsDrawer />
      <ChangelogModal />
      <DropOverlay visible={dragging} />
      <Toasts />
    </div>
  )
}
