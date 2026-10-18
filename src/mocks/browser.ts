// Starts the mock service worker (staging builds only; see main.tsx).
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export async function startMocks() {
  await setupWorker(...handlers).start({
    onUnhandledRequest: 'bypass', // fonts and the like; /api and auth have catch-alls
    serviceWorker: { url: '/mockServiceWorker.js' },
    quiet: true,
  })
}
