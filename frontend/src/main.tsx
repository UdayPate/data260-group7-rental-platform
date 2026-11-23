import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { mocksEnabled } from './config'

// When mocks are on, start MSW (Mock Service Worker) before the app renders, so even
// the very first API call is answered by the mocks. When off, the mock code is never loaded.
async function startMocks() {
  if (!mocksEnabled) return
  const { worker } = await import('./mocks/browser')
  // 'bypass' = let requests we have no handler for (the app's own files) go through untouched.
  await worker.start({ onUnhandledFrame: 'bypass' })
}

startMocks().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* BrowserRouter keeps the page in sync with the address bar URL */}
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
