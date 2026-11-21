import { defineConfig } from 'vite'
import { contentPlugin } from './vite/content'

export default defineConfig({
  base: './',
  plugins: [contentPlugin()],
  test: {
    // The gate and draft tests spawn node and git, so a loaded machine can take
    // well over the 5 s default. The assertion is what must hold, not the clock.
    testTimeout: 20_000,
  },
})
