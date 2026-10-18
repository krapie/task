import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The MSW worker script ships only with the staging build (docs/staging.md).
function mockWorker(): Plugin {
  const file = () => readFileSync('public-staging/mockServiceWorker.js', 'utf8')
  return {
    name: 'mock-worker',
    configureServer(server) {
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(file())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'mockServiceWorker.js', source: file() })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'staging' ? [mockWorker()] : [])],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
}))
