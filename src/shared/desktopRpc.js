/**
 * Shared contract for LiveKit RPC between the cloud agent and the desktop.
 *
 * This is the single source of truth for method names, payload shapes and error
 * codes. It is imported by both processes (and mirrored in the Python agent
 * module under `agent/`). Nothing here has Node or Electron dependencies, so the
 * contract can be unit-tested on its own.
 *
 * RPC payloads are JSON strings. LiveKit limits a request/response to 15 KiB, so
 * every envelope is size-checked before it is sent. Screenshots and other large
 * artifacts must use a different pipeline (the existing screen-share track), not
 * this transport.
 */

/** RPC method names. Add new capabilities here first, then to both registries. */
export const RPC_METHODS = Object.freeze({
  /** Read-only environment information. No approval needed. */
  GET_INFO: 'jarvis.desktop.getInfo',
  /** Launch one of a fixed set of Windows applications. Requires approval. */
  OPEN_APPLICATION: 'jarvis.desktop.openApplication',
})

/** Application identifiers accepted by `openApplication`. Never accept a path. */
export const RPC_APP_IDS = Object.freeze({
  NOTEPAD: 'notepad',
  CALCULATOR: 'calculator',
  FILE_EXPLORER: 'file-explorer',
})

/** Stable, structured error codes returned to the Python agent. */
export const RPC_ERROR_CODES = Object.freeze({
  UNSUPPORTED_METHOD: 'unsupported-method',
  INVALID_PAYLOAD: 'invalid-payload',
  SESSION_INACTIVE: 'session-inactive',
  FORBIDDEN_CALLER: 'forbidden-caller',
  FORBIDDEN_SENDER: 'forbidden-sender',
  APPROVAL_DENIED: 'approval-denied',
  APP_NOT_ALLOWED: 'app-not-allowed',
  ACTION_FAILED: 'action-failed',
  TIMEOUT: 'timeout',
  INTERNAL: 'internal',
})

/** LiveKit transport limits, with headroom for JSON envelope overhead. */
export const RPC_LIMITS = Object.freeze({
  /** LiveKit's documented maximum request payload is 15 KiB. */
  MAX_PAYLOAD_BYTES: 15_360,
  /** Keep responses below the same limit, leaving room for JSON syntax. */
  MAX_RESULT_BYTES: 14_000,
  /** RpcError.message is limited to 256 bytes by the SDK. */
  MAX_ERROR_MESSAGE_BYTES: 160,
  /** Hard ceiling for a serialized error message. */
  MAX_ERROR_ENVELOPE_BYTES: 240,
  /** Longest user-visible error line in the structured envelope. */
  MAX_ERROR_TEXT_BYTES: 120,
  /** Longest accepted application identifier. */
  MAX_APP_ID_LENGTH: 64,
  /** Upper bound for a local wait, so a bad timeout cannot hang the renderer. */
  MAX_RPC_WAIT_MS: 14_000,
})

/** Numeric RpcError codes. Codes below 1000 are application-defined. */
export const RPC_TRANSPORT_CODES = Object.freeze({
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TIMEOUT: 408,
  CONFLICT: 409,
  INTERNAL: 500,
  UNAVAILABLE: 503,
})

/** Thrown by validators and by the Python-facing result parser. */
export class DesktopRpcError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DesktopRpcError'
    this.code = code
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Byte length of a string in UTF-8, matching the SDK's payload limit. */
export function byteLength(value) {
  return encoder.encode(value).length
}

/** Trim a string to at most `max` UTF-8 bytes without splitting a code point. */
export function truncateUtf8(value, max) {
  const bytes = encoder.encode(value)
  if (bytes.length <= max) return value
  return decoder.decode(bytes.slice(0, max))
}

/** True for a JSON object (not null, not an array). */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True when `method` is one of the contract's supported methods. */
export function isAllowedMethod(method) {
  return Object.values(RPC_METHODS).includes(method)
}

/** Reject unknown keys so a payload cannot smuggle extra instructions. */
function assertOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new DesktopRpcError(
        RPC_ERROR_CODES.INVALID_PAYLOAD,
        `Unexpected field: ${truncateUtf8(key, 40)}`,
      )
    }
  }
}

/**
 * Parse and bound an RPC request payload. `null` becomes `{}`, so an agent may
 * send either an empty object or a literal `null` for no-argument methods.
 *
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
export function parseRpcPayload(payload) {
  if (typeof payload !== 'string') {
    throw new DesktopRpcError(RPC_ERROR_CODES.INVALID_PAYLOAD, 'Payload must be a JSON string')
  }
  if (byteLength(payload) > RPC_LIMITS.MAX_PAYLOAD_BYTES) {
    throw new DesktopRpcError(RPC_ERROR_CODES.INVALID_PAYLOAD, 'Payload is too large')
  }

  let value
  try {
    value = JSON.parse(payload)
  } catch {
    throw new DesktopRpcError(RPC_ERROR_CODES.INVALID_PAYLOAD, 'Payload is not valid JSON')
  }

  if (value === null) return {}
  if (!isPlainObject(value)) {
    throw new DesktopRpcError(RPC_ERROR_CODES.INVALID_PAYLOAD, 'Payload must be a JSON object')
  }
  return value
}

/**
 * Validate a parsed payload for one method. Returns a fresh object containing
 * only the fields the tool is allowed to see.
 *
 * @param {string} method
 * @param {Record<string, unknown>} value
 * @returns {Record<string, unknown>}
 */
export function validateRpcPayload(method, value) {
  if (!isAllowedMethod(method)) {
    throw new DesktopRpcError(RPC_ERROR_CODES.UNSUPPORTED_METHOD, 'Method is not supported')
  }

  switch (method) {
    case RPC_METHODS.GET_INFO:
      assertOnlyKeys(value, [])
      return {}

    case RPC_METHODS.OPEN_APPLICATION: {
      assertOnlyKeys(value, ['app'])
      const { app } = value
      if (typeof app !== 'string' || app.length === 0 || app.length > RPC_LIMITS.MAX_APP_ID_LENGTH) {
        throw new DesktopRpcError(RPC_ERROR_CODES.INVALID_PAYLOAD, 'app must be a short string')
      }
      if (!Object.values(RPC_APP_IDS).includes(app)) {
        throw new DesktopRpcError(RPC_ERROR_CODES.APP_NOT_ALLOWED, 'Application is not allowed')
      }
      return { app }
    }

    default:
      throw new DesktopRpcError(RPC_ERROR_CODES.UNSUPPORTED_METHOD, 'Method is not supported')
  }
}

/** Successful RPC response body. */
export function ok(data) {
  return JSON.stringify({ ok: true, data })
}

/** Structured error body; never contains a stack or a raw internal error. */
export function errorBody(code, message) {
  const safeCode = typeof code === 'string' && code.length <= 64 ? code : RPC_ERROR_CODES.INTERNAL
  const safeMessage = truncateUtf8(String(message ?? 'Desktop action failed.'), RPC_LIMITS.MAX_ERROR_TEXT_BYTES)
  return { ok: false, error: { code: safeCode, message: safeMessage } }
}

/** Serialize a structured error for the `RpcError.message` field. */
export function serializeRpcError(code, message) {
  return truncateUtf8(JSON.stringify(errorBody(code, message)), RPC_LIMITS.MAX_ERROR_ENVELOPE_BYTES)
}

/**
 * Parse a response from main and turn a structured failure into a typed error.
 * Used by the renderer handler so an agent receives a clean error, not a stack.
 */
export function parseRpcResult(raw) {
  if (typeof raw !== 'string' || byteLength(raw) > RPC_LIMITS.MAX_RESULT_BYTES) {
    throw new DesktopRpcError(RPC_ERROR_CODES.INTERNAL, 'Desktop returned an invalid result')
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    throw new DesktopRpcError(RPC_ERROR_CODES.INTERNAL, 'Desktop returned an invalid result')
  }
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new DesktopRpcError(RPC_ERROR_CODES.INTERNAL, 'Desktop returned an invalid result')
  }
  if (!value.ok) {
    throw new DesktopRpcError(
      value.error?.code ?? RPC_ERROR_CODES.INTERNAL,
      value.error?.message ?? 'Desktop action failed.',
    )
  }
  return value.data
}
