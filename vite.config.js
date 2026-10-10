import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/**
 * The main process is not bundled here — Electron runs src/main as native ESM.
 * Vite builds only the renderer, into dist/renderer, which electron-builder
 * packages and `npm start` loads over file://.
 */

/** Env var name placeholder in the CSP meta tag, replaced at build time. */
const CSP_ORIGIN_PLACEMENT = '%LIVEKIT_ORIGINS%'

/**
 * The SDK's default base URL for the development token server, used here only so
 * `connect-src` can name it when VITE_LIVEKIT_TOKEN_SERVER_URL is unset. Keeping
 * the constant next to the plugin means the CSP and the runtime agree without
 * the app having to configure anything to work.
 */
const DEFAULT_TOKEN_SERVER_URL = 'https://cloud-api.livekit.io'

/**
 * Names that must never reach the renderer bundle. Vite only inlines `VITE_`
 * variables into client code, so a `LIVEKIT_API_KEY` accidentally written as
 * `VITE_LIVEKIT_API_KEY` would ship the secret inside the packaged app. Failing
 * the build is the only response that cannot be missed.
 */
const FORBIDDEN_ENV_PATTERN = /(API_KEY|API_SECRET|_SECRET|^.*SECRET.*$)/i

/**
 * CSP sources for one configured URL.
 *
 * The LiveKit URL needs two entries, not one: the SDK opens a `wss://` signalling
 * socket *and* validates the token with an HTTPS request to the same host
 * (`https://host/rtc/v1/validate`) before the socket is opened. Allowing only the
 * `wss://` origin makes every connect fail with a CSP violation — verified
 * against the installed SDK, not assumed. Both are the same host, so this widens
 * the scheme, not the destination.
 */
function toOrigins(value) {
  if (!value) return []
  try {
    const url = new URL(value)
    const origins = [url.origin]
    if (url.protocol === 'wss:' || url.protocol === 'ws:') {
      const secure = new URL(url.href)
      secure.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
      origins.push(secure.origin)
    }
    return origins
  } catch {
    return []
  }
}

/**
 * Adds the LiveKit signal URL and the token endpoint origin to the renderer's
 * Content-Security-Policy `connect-src`, at build time, from configuration.
 *
 * Why this is a build step and not a hardcoded policy: the two endpoints differ
 * per environment, and the only acceptable alternatives to a build-time value are
 * a blanket `https:` (which would let the renderer talk to any host) or editing
 * index.html by hand on every environment change. Only `VITE_` variables are
 * read, and only their origins are used — never a path, a query, or a credential.
 *
 * The CSP stays restrictive: `default-src 'self'` and `script-src 'self'` are
 * untouched, so the LiveKit SDK is still a bundled script and the renderer still
 * cannot execute anything it did not ship with.
 */
function liveKitCsp(env) {
  const forbidden = Object.keys(env).filter(
    (name) => name.startsWith('VITE_') && FORBIDDEN_ENV_PATTERN.test(name),
  )
  if (forbidden.length > 0) {
    throw new Error(
      `Refusing to build: ${forbidden.join(', ')} would be inlined into the renderer bundle. ` +
        'LiveKit API credentials belong on a token-minting backend only, and are not ' +
        'needed at all while using the development token server. Remove them from your .env file.',
    )
  }

  // VITE_LIVEKIT_TOKEN_SERVER_URL is an optional override and is deliberately
  // not required: the SDK's own default base URL is the supported path.
  const missing = [
    'VITE_LIVEKIT_URL',
    'VITE_LIVEKIT_AGENT_NAME',
    'VITE_LIVEKIT_TOKEN_SERVER_ID',
  ].filter((name) => !env[name])
  if (missing.length > 0) {
    console.warn(
      `[jarvis] ${missing.join(', ')} not set. The renderer will build, but a voice session ` +
        'will report a configuration error until they are. See .env.example.',
    )
  }

  const origins = new Set()
  for (const origin of toOrigins(env.VITE_LIVEKIT_URL)) origins.add(origin)
  // Mirrors livekitToken.js: the SDK falls back to its own base URL when
  // VITE_LIVEKIT_TOKEN_SERVER_URL is unset, and connect-src has to allow the
  // host the request actually goes to — not the one that would have been used.
  for (const origin of toOrigins(env.VITE_LIVEKIT_TOKEN_SERVER_URL || DEFAULT_TOKEN_SERVER_URL)) {
    origins.add(origin)
  }

  return {
    name: 'jarvis-livekit-csp',
    /**
     * Applied to index.html in development and in the production build, after
     * Vite's own dev-server transform has injected the HMR client, so returning
     * the whole string here is safe in both modes.
     */
    transformIndexHtml(html) {
      // Replaced with nothing when unconfigured, so the policy is always valid.
      return html.replaceAll(CSP_ORIGIN_PLACEMENT, [...origins].join(' '))
    },
  }
}

export default defineConfig(({ command, mode }) => {
  // VITE_ prefix only: anything else in .env is invisible to this plugin, so a
  // secret in .env can never reach the client build.
  const env = loadEnv(mode, process.cwd())

  return {
    // Relative in production so asset URLs resolve against the file:// location.
    // Absolute in development so the dev server behaves normally.
    base: command === 'build' ? './' : '/',

    plugins: [react(), tailwindcss(), liveKitCsp(env)],

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
  }
})
