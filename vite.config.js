import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The main process is not bundled here — Electron runs src/main as native ESM.
 * Vite builds only the renderer, into dist/renderer, which electron-builder
 * packages and `npm start` loads over file://.
 */
export default defineConfig(({ command }) => ({
  // Relative in production so asset URLs resolve against the file:// location.
  // Absolute in development so the dev server behaves normally.
  base: command === 'build' ? './' : '/',

  plugins: [react(), tailwindcss()],

  server: {
    port: 5173,
    // Fail loudly instead of silently moving to 5174, which would desync the
    // URL the main process waits for in shared/constants.js.
    strictPort: true,
  },

  build: {
    // Kept separate from the electron-builder output directory in package.json.
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
}))
