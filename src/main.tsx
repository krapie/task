import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './colors_and_type.css'
import './index.css'
import App from './App.tsx'

async function boot() {
  // Staging build (vite --mode staging): the API is answered by MSW from synthetic data (docs/staging.md).
  const staging = import.meta.env.MODE === 'staging'
  if (staging) {
    document.title = `Staging · ${document.title}`
    await (await import('./mocks/browser')).startMocks()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      {staging && <div className="staging-bar" title="Staging · mock data" />}
    </StrictMode>,
  )

  // The app's own service worker would take the scope the API mock needs.
  if (!staging && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw-v2.js').catch(() => {})
    })
  }
}
void boot()
