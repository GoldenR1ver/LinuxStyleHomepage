import { defineConfig } from 'vite'
import { contentPlugin } from './vite/content'

export default defineConfig({
  base: './',
  plugins: [contentPlugin()],
})
