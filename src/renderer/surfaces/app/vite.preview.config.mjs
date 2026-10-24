/**
 * Plain-browser preview of the renderer (app.html, panel.html) against the mock API, for
 * development and screenshots: npx vite --config src/renderer/surfaces/app/vite.preview.config.mjs
 * → http://localhost:5180/app.html and /panel.html (add ?theme=dark, ?scenario=empty|slow|error).
 */
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: r('../..'),
  resolve: {
    alias: {
      '@shared': r('../../../shared'),
      '@renderer': r('../..'),
    },
  },
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  clearScreen: false,
})
