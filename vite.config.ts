import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

// Content-Security-Policy for the production build. GitHub Pages cannot send headers, so it goes
// in a <meta>. Dev mode skips it because Vite's hot reload needs inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // PeerJS broker (matchmaking) + https for importing packs from a URL
  "connect-src 'self' https: wss://0.peerjs.com",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function csp(): Plugin {
  return {
    name: 'battlecert-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`)
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  build: { chunkSizeWarningLimit: 1200, sourcemap: false },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
