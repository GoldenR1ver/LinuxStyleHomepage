import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { contentPlugin } from './vite/content'

const REPO = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  base: './',
  define: {
    /**
     * A fresh id per build. `dist/fs/manifest.json` keeps its name across
     * deploys, so without this a browser with a cached manifest can pair it
     * with a new bundle and read a file list that no longer matches the code.
     */
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  // The browser app lives in packages/web; content/, public/ and dist/ stay at the root.
  root: resolve(REPO, 'packages/web'),
  publicDir: resolve(REPO, 'public'),
  resolve: {
    alias: {
      '@home/core': resolve(REPO, 'packages/core/src'),
    },
  },
  plugins: [contentPlugin(resolve(REPO, 'content'))],
  build: {
    outDir: resolve(REPO, 'dist'),
    emptyOutDir: true,
  },
  test: {
    // Tests live next to the code in both packages; the local architecture suite,
    // when it is present, sits in local/tests and is not pushed.
    root: REPO,
    include: ['packages/**/*.test.ts', 'local/tests/**/*.test.ts'],
    // The gate tests spawn node, so a loaded machine can take well over the 5 s
    // default. The assertion is what must hold, not the clock.
    testTimeout: 20_000,
  },
})
