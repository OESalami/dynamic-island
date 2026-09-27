import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'release', 'node_modules']),

  // Electron main process: Node globals, no browser globals.
  {
    files: ['src/main/**/*.js', 'src/shared/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Preload: sandboxed, but this file is still CommonJS and requires electron.
  {
    files: ['src/preload/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
  },

  // Renderer: browser globals plus the React rules.
  {
    files: ['src/renderer/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
