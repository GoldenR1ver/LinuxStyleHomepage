import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const REPO = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@home/core': resolve(REPO, 'packages/core/src') },
  },
  build: {
    ssr: resolve(REPO, 'packages/cli/src/main.ts'),
    outDir: resolve(REPO, 'packages/cli/dist'),
    emptyOutDir: true,
    target: 'node18',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'cli.js', format: 'es' },
    },
  },
})
