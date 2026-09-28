import { TokenSource } from 'livekit-client'
import { SESSION_ERROR_CODES } from './livekitEvents.js'
import { jarvisLog, jarvisWarn } from './livekitLogger.js'

/**
 * Token acquisition, via LiveKit's own development token server.
 *
 * This app never mints a LiveKit token. A LiveKit access token is a JWT signed
 * with `LIVEKIT_API_SECRET`, so only something holding the secret can create one.
 * During development that "something" is LiveKit Cloud's hosted **development
 * token server**, reached through the SDK's supported `TokenSource` API:
 *
 *   const source = TokenSource.developmentTokenServer(id)
 *   const { serverUrl, participantToken } = await source.fetch({
 *     roomName, participantIdentity, agentName,
 *   })
 *
 * The SDK owns the HTTP details: it POSTs a `TokenSourceRequest` to
 * `https://cloud-api.livekit.io/api/v2/sandbox/connection-details` with the
 * server id in the `X-Sandbox-ID` header, and parses the `TokenSourceResponse`
 * that comes back. The request carries `room_name`, `participant_identity` and —
 * because `agentName` is passed — a `room_config` with `agents[0].agent_name`,
 * which is what makes the LiveKit server dispatch `my-agent` into the room. We do
 * not construct the request, the path, the header, or the JWT.
 *
 * Only the token server id is needed, which is exactly what LiveKit's own docs
 * ask for. The base URL is optional and left unset: the `*.sandbox.livekit.io`
 * address shown beside the id in the dashboard is the token server's web page,
 * not its API base, and posting to it returns a 404.
 *
 * There is no JARVIS backend in this phase, and that is the point: the token
 * server is LiveKit-hosted, so nothing of ours has to be running for the
 * shortcut to work.
 *
 * The development token server is **insecure by design** — anyone who can load
 * the app can mint a token from it with any permissions, which is why it is for
 * prototyping only. Moving to production is a change to `createTokenSource()`
 * alone: swap `TokenSource.developmentTokenServer(...)` for
 * `TokenSource.endpoint(<your backend>)` and nothing else in the app changes.
 * API keys and secrets belong on that future backend, never in Electron.
 */

/** Fail fast instead of hanging the shortcut when the token server is unreachable. */
const TOKEN_REQUEST_TIMEOUT_MS = 15_000

/** Thrown for every failure of this step, carrying a stable error code. */
export class TokenRequestError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TokenRequestError'
    this.code = code
  }
}

/**
 * The SDK's token source for this project.
 *
 * Created once per session: `TokenSourceCached` keys its cache on the fetch
 * options, so a fresh instance cannot hand this session a token minted for a
 * previous session's room. The SDK's own caching still applies within a session,
 * which is what keeps reconnects from re-fetching for no reason.
 */
export function createTokenSource({ tokenServerId, tokenServerUrl }) {
  // `baseUrl` is omitted unless configured, so the SDK uses its own default
  // (`https://cloud-api.livekit.io`) — the documented path, and the one that
  // works. Only a self-hosted equivalent needs the override.
  return tokenServerUrl
    ? TokenSource.developmentTokenServer(tokenServerId, { baseUrl: tokenServerUrl })
    : TokenSource.developmentTokenServer(tokenServerId)
}

/**
 * Obtain one short-lived access token for this session.
 *
 * `identity` and `room` are generated per session by the caller and are unique,
 * so every JARVIS session is its own LiveKit room with its own agent job.
 *
 * @param {{tokenSource: ReturnType<typeof createTokenSource>, identity: string, room: string,
 *          agentName: string, signal?: AbortSignal}} request
 * @returns {Promise<{token: string, url: string}>}
 */
export async function requestAccessToken({
  tokenSource,
  identity,
  room,
  agentName,
  signal,
}) {
  jarvisLog('Requesting LiveKit development token')

  // The SDK's fetch takes no AbortSignal, so the deadline is enforced here: a
  // press of the shortcut must either produce a token or report an error, never
  // leave the island on its connecting pill.
  const timeout = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS)
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response
  try {
    response = await Promise.race([
      tokenSource.fetch({
        roomName: room,
        participantIdentity: identity,
        // Put in the token's room_config, which is what dispatches the agent.
        agentName,
      }),
      // The SDK's fetch takes no AbortSignal, so a stop or a timeout cannot
      // cancel it directly. Racing it means this call settles either way and the
      // orphaned request is left to finish on its own, harmlessly, with its
      // result discarded.
      rejectWhenAborted(combinedSignal),
    ])
  } catch (error) {
    if (error?.name === 'AbortError' && combinedSignal.aborted) {
      // A stop mid-request: the session is already gone, so the caller's own
      // cancellation handling takes it from here.
      if (signal?.aborted) throw error
      throw new TokenRequestError(
        SESSION_ERROR_CODES.TOKEN_UNAVAILABLE,
        `The development token server did not answer within ${TOKEN_REQUEST_TIMEOUT_MS}ms.`,
      )
    }
    throw describeTokenServerFailure(error)
  }

  const token = response?.participantToken
  const url = response?.serverUrl

  if (typeof token !== 'string' || token.length === 0) {
    throw new TokenRequestError(
      SESSION_ERROR_CODES.TOKEN_INVALID,
      'The development token server returned no participant token.',
    )
  }
  if (typeof url !== 'string' || url.length === 0) {
    throw new TokenRequestError(
      SESSION_ERROR_CODES.TOKEN_INVALID,
      'The development token server returned no server URL.',
    )
  }

  // The token is never logged. The room and the resolved URL are the only facts
  // worth having in a line, and both are non-secret.
  jarvisLog(`LiveKit token acquired for room ${room} (server ${url})`)
  return { token, url }
}

/** A promise that rejects with an `AbortError` as soon as `signal` aborts. */
function rejectWhenAborted(signal) {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(abortError()), { once: true })
  })
}

/** An `AbortError` for the timeout race, so a stop is never reported as a failure. */
function abortError() {
  return new DOMException('Token request aborted', 'AbortError')
}

/**
 * Turn an SDK/fetch failure into a message that names the thing that is actually
 * wrong.
 *
 * There is no JARVIS backend in this phase, so a failure here is the token
 * server: it is disabled for the project, the id or URL is wrong, or the machine
 * has no network. Saying "is the JARVIS backend running?" would send the reader
 * looking for a process that does not exist.
 */
function describeTokenServerFailure(error) {
  const detail = error instanceof Error ? error.message : String(error)

  if (/\b(401|403)\b/.test(detail) || /unauthorized|forbidden/i.test(detail)) {
    return new TokenRequestError(
      SESSION_ERROR_CODES.TOKEN_REJECTED,
      'The development token server rejected the request. Check that it is enabled for this project and that the server id is correct.',
    )
  }
  if (/\b404\b/.test(detail) || /not found/i.test(detail)) {
    return new TokenRequestError(
      SESSION_ERROR_CODES.TOKEN_REJECTED,
      'No development token server answered. Check VITE_LIVEKIT_TOKEN_SERVER_URL and VITE_LIVEKIT_TOKEN_SERVER_ID.',
    )
  }
  if (/fetch failed|failed to fetch|networkerror|ENOTFOUND|econnrefused/i.test(detail)) {
    return new TokenRequestError(
      SESSION_ERROR_CODES.TOKEN_UNAVAILABLE,
      'Could not reach the LiveKit development token server. Check the network connection and the server URL.',
    )
  }
  if (/fetch|timeout|abort/i.test(detail)) {
    return new TokenRequestError(
      SESSION_ERROR_CODES.TOKEN_UNAVAILABLE,
      'The LiveKit development token server did not respond in time.',
    )
  }

  jarvisWarn(`Unexpected token server failure: ${detail}`)
  return new TokenRequestError(
    SESSION_ERROR_CODES.TOKEN_UNAVAILABLE,
    'The LiveKit development token server could not provide a token.',
  )
}
