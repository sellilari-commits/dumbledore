import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const r = (p: string) => resolve(__dirname, p)

const alias = {
  '@shared': r('src/shared'),
  '@engine': r('src/engine'),
  '@main': r('src/main'),
  '@renderer': r('src/renderer'),
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/{shared,engine,main}/**/*.test.ts',
            'tests/unit/**/*.test.ts',
            'tests/integration/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
