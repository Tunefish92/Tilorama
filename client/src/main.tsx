import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Global styles first, so component styles can override them.
import '@fontsource-variable/source-sans-3'
import './styles/tokens.css'
import './styles/base.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
