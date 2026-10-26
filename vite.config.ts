import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

// Content-Security-Policy for the production build. GitHub Pages cannot send headers, so it goes
// in a <meta>. Dev mode skips it because Vite's hot reload needs inline scripts.
const csp_ = (e2e: boolean) => [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // PeerJS broker (matchmaking), MQTT relays (encrypted fallback) + https for importing packs from a URL
  `connect-src 'self' https: wss://0.peerjs.com wss://broker.emqx.io:8084 wss://broker.hivemq.com:8884${e2e ? ' ws://127.0.0.1:4181' : ''}`,
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function csp(e2e: boolean): Plugin {
  const CSP = csp_(e2e)
  return {
    name: 'battlecert-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`)
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), csp(mode === 'e2e')],
  build: { chunkSizeWarningLimit: 1200, sourcemap: false },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
}))
