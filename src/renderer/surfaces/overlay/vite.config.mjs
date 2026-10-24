/**
 * Browser dev server for the overlay and the Ask bar with the mock driver:
 *   npx vite --config src/renderer/surfaces/overlay/vite.config.mjs
 *   → http://localhost:5181/overlay.html  (?scene=<name>, ?theme=dark, ?clean=1)
 *   → http://localhost:5181/askbar.html
 * Plain JS on purpose: a .ts config would pull Node types into the renderer's type program.
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = (p) => decodeURIComponent(new URL(p, import.meta.url).pathname)

export default defineConfig({
  root: here('../../'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': here('../../../shared'),
      '@renderer': here('../../'),
    },
  },
  server: { port: 5181, strictPort: true },
  clearScreen: false,
})
