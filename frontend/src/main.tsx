import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { BRAND_TITLE } from './brand'
import { mocksEnabled } from './config'

// Browser tab title from brand.ts (index.html only has a neutral placeholder).
document.title = BRAND_TITLE
import { AuthProvider } from './auth/AuthProvider'

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
        {/* Who is logged in (in this tab), for every page */}
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  )
})
