/**
 * LiveKit configuration, read from Vite environment variables.
 *
 * Three values are needed to be a LiveKit client during development:
 *
 *   VITE_LIVEKIT_URL                 wss://<project>.livekit.cloud
 *   VITE_LIVEKIT_AGENT_NAME          the deployed agent to dispatch, e.g. `my-agent`
 *   VITE_LIVEKIT_TOKEN_SERVER_ID     development token server id, e.g. `callagent-2qxh5u`
 *
 * And one that is normally left unset:
 *
 *   VITE_LIVEKIT_TOKEN_SERVER_URL    overrides the token server's API base URL
 *
 * The token server is LiveKit Cloud's own development token service, reached
 * through `TokenSource.developmentTokenServer()` in the SDK (see
 * livekitToken.js). It is a hosted service, not a JARVIS backend: there is no
 * process of ours to run, and no API key or secret anywhere in this app.
 *
 * Everything is prefixed `VITE_`, which means Vite inlines it into the renderer
 * bundle. That is acceptable for these values and unacceptable for anything
 * else: `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` must never appear in a `VITE_`
 * variable, in the preload, or anywhere inside the packaged app. Those are only
 * ever used by a real token-minting backend, which this development phase does
 * not use. The token the SDK receives is never written to a log.
 *
 * The development token server is explicitly *not* for production — anyone who
 * can load the app can mint a token from it. Production moves to
 * `TokenSource.endpoint()` pointed at a real backend, which is a change to
 * livekitToken.js alone; nothing else in the app knows where tokens come from.
 *
 * Missing configuration is a normal, expected state (a fresh clone, or the app
 * before anyone has run `npm run dev`), so it is reported as a configuration
 * error at the start of a session rather than crashing the renderer at import
 * time.
 */

/** Thrown when the required environment variables are absent or malformed. */
export class LiveKitConfigError extends Error {
  constructor(message, missing) {
    super(message)
    this.name = 'LiveKitConfigError'
    /** Variable names that were missing or invalid, for the console message. */
    this.missing = missing
  }
}

function readEnv(name) {
  const value = import.meta.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

/** Strip a trailing slash so url and origin maths stay predictable. */
function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

/** `wss://host` / `ws://host` for the signalling socket. */
function parseServerUrl(value) {
  const url = trimTrailingSlash(value)
  if (!/^wss?:\/\/[^\s/]+/i.test(url)) {
    throw new LiveKitConfigError(
      `VITE_LIVEKIT_URL must be a wss:// URL (got ${JSON.stringify(value)}).`,
      ['VITE_LIVEKIT_URL'],
    )
  }
  return url
}

/**
 * Optional override for the token server's API base URL.
 *
 * The token server id from the dashboard is the *only* value LiveKit's own docs
 * ask for: the SDK defaults to `https://cloud-api.livekit.io` and appends
 * `/api/v2/sandbox/connection-details`, sending the id in the `X-Sandbox-ID`
 * header. That default is what works, and it is what this app uses.
 *
 * The `https://<id>.sandbox.livekit.io` URL shown next to the id in the
 * dashboard is the token server's *web page*, not its API base — posting to that
 * host returns a 404 HTML page. It is accepted here as an override for anyone
 * self-hosting an equivalent service, and validated so a typo is a configuration
 * error rather than an opaque network failure later.
 */
function parseTokenServerUrl(value) {
  if (!value) return null
  const url = trimTrailingSlash(value)
  if (!/^https:\/\/[^\s/]+/i.test(url)) {
    throw new LiveKitConfigError(
      `VITE_LIVEKIT_TOKEN_SERVER_URL must be an absolute https:// URL (got ${JSON.stringify(value)}). ` +
        'Leave it unset to use LiveKit Cloud, which is the default and the supported path.',
      ['VITE_LIVEKIT_TOKEN_SERVER_URL'],
    )
  }
  return url
}

/**
 * The development token server's id, e.g. `callagent-2qxh5u`.
 *
 * The id is a routing label, not a secret: it grants nothing on its own and
 * travels in a request header, so it is validated as a header-safe token rather
 * than as a URL.
 */
function parseTokenServerId(value) {
  if (!value) {
    throw new LiveKitConfigError('VITE_LIVEKIT_TOKEN_SERVER_ID is not set.', [
      'VITE_LIVEKIT_TOKEN_SERVER_ID',
    ])
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new LiveKitConfigError(
      `VITE_LIVEKIT_TOKEN_SERVER_ID must be alphanumeric (got ${JSON.stringify(value)}).`,
      ['VITE_LIVEKIT_TOKEN_SERVER_ID'],
    )
  }
  return value
}

/**
 * The deployed agent this app talks to.
 *
 * The agent lives on LiveKit Cloud and is dispatched by the LiveKit server for
 * the room this session's token encodes. The name is passed to the token source
 * on every fetch, which puts it in the token's `room_config.agents[0].agent_name`;
 * the server dispatches the agent when the participant joins the room.
 */
function parseAgentName(value) {
  if (!value) {
    throw new LiveKitConfigError('VITE_LIVEKIT_AGENT_NAME is not set.', [
      'VITE_LIVEKIT_AGENT_NAME',
    ])
  }
  return value
}

/**
 * Read and validate the configuration.
 * @throws {LiveKitConfigError} listing every variable that is missing or invalid.
 */
export function readLiveKitConfig() {
  // Every variable is checked independently so a single run reports all of the
  // problems, rather than making the user fix them one restart at a time. The
  // token server base URL is optional, so a null value is not a failure.
  const results = [
    ['VITE_LIVEKIT_URL', parseServerUrl(readEnv('VITE_LIVEKIT_URL'))],
    ['VITE_LIVEKIT_AGENT_NAME', parseAgentName(readEnv('VITE_LIVEKIT_AGENT_NAME'))],
    [
      'VITE_LIVEKIT_TOKEN_SERVER_ID',
      parseTokenServerId(readEnv('VITE_LIVEKIT_TOKEN_SERVER_ID')),
    ],
    [
      'VITE_LIVEKIT_TOKEN_SERVER_URL',
      parseTokenServerUrl(readEnv('VITE_LIVEKIT_TOKEN_SERVER_URL')),
    ],
  ].map(([name, parse]) => {
    try {
      return { name, value: parse }
    } catch (error) {
      if (error instanceof LiveKitConfigError) return { name, error: error.message }
      throw error
    }
  })

  const failed = results.filter((result) => result.error)
  if (failed.length > 0) {
    throw new LiveKitConfigError(
      `LiveKit is not configured: ${failed.map((result) => result.error).join(' ')} ` +
        'See .env.example and the "LiveKit Integration" section of README.md.',
      failed.map((result) => result.name),
    )
  }

  const [url, agentName, tokenServerId, tokenServerUrl] = results.map((r) => r.value)
  return { url, agentName, tokenServerId, tokenServerUrl }
}

/** True when the three required variables are present and well-formed. */
export function isLiveKitConfigured() {
  try {
    readLiveKitConfig()
    return true
  } catch {
    return false
  }
}

/**
 * A log-safe summary of the configuration. The agent name, the token server id
 * and the URLs are all non-secret by LiveKit's own design; the summary exists so
 * the console shows what the app is about to connect to without dumping the
 * environment.
 */
export function describeLiveKitConfig() {
  try {
    const { url, agentName, tokenServerId, tokenServerUrl } = readLiveKitConfig()
    return (
      `url=${url} agent=${agentName} ` +
      `tokenServerId=${tokenServerId} tokenServerBase=${tokenServerUrl ?? '(livekit cloud default)'}`
    )
  } catch {
    return 'url=(unset) agent=(unset) tokenServerId=(unset)'
  }
}
