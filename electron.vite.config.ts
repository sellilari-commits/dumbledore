import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const r = (p: string) => resolve(__dirname, p)

const alias = {
  '@shared': r('src/shared'),
  '@engine': r('src/engine'),
  '@main': r('src/main'),
  '@renderer': r('src/renderer'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: { rollupOptions: { input: { index: r('src/main/index.ts') } } },
  },
  preload: {
    resolve: { alias },
    build: { rollupOptions: { input: { index: r('src/preload/index.ts') } } },
  },
  renderer: {
    root: r('src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          overlay: r('src/renderer/overlay.html'),
          panel: r('src/renderer/panel.html'),
          askbar: r('src/renderer/askbar.html'),
          app: r('src/renderer/app.html'),
        },
      },
    },
  },
})
