/**
 * Browser preview of the mini panel and the picker against the mock API:
 *   npx vite --config src/renderer/surfaces/panel/vite.config.mjs
 *   → http://localhost:5185/panel.html?mock=1          (add &theme=dark, &scenario=empty|slow|error)
 *   → http://localhost:5185/panel.html?mock=1#/picker
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
  server: { port: 5185, strictPort: true },
  clearScreen: false,
})
