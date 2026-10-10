/**
 * `[JARVIS]` diagnostic logging for the voice session.
 *
 * Two rules, both enforced here rather than at every call site:
 *
 *   1. Never log an access token. LiveKit tokens are JWTs, so any `eyJ...`-shaped
 *      run of text is replaced before it reaches a console. API credentials are
 *      not in this app at all, but the same redaction covers a token that ends up
 *      inside a third-party error message.
 *   2. Never log a whole Error. Only `name: message` is emitted, because a
 *      stack or a custom property can carry request details.
 *
 * The module has no Electron dependency. `onLog` lets the app mirror these lines
 * into the main process console, which is where they are actually visible: the
 * island window is never focused, so its devtools cannot be opened by hand.
 */

const PREFIX = '[JARVIS]'

/** Base64url JWTs always start with a base64-encoded `{"` header. */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g

/** Anything that looks like a credential is reduced to this. */
const REDACTED = '[redacted-token]'

/** Keeps a hostile or accidental multi-megabyte line out of the console. */
const MAX_LENGTH = 300

const listeners = new Set()

/** Subscribe to every log line. Returns an unsubscribe function. */
export function onLog(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function redact(value) {
  return String(value ?? '').replace(JWT_PATTERN, REDACTED)
}

/** `Error` -> a string that cannot contain a stack, a token, or a request body. */
export function describeError(error) {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return redact(error)
  const name = error.name || 'Error'
  const message = error.message ? `: ${redact(error.message)}` : ''
  return `${name}${message}`
}

function emit(level, message) {
  const line = `${PREFIX} ${redact(message)}`.slice(0, MAX_LENGTH)
  const consoleMethod = console[level] ?? console.log
  consoleMethod(line)
  for (const listener of listeners) {
    try {
      listener(level, line)
    } catch {
      // A broken listener must never take the session down with it.
    }
  }
}

export const jarvisLog = (message) => emit('log', message)
export const jarvisWarn = (message) => emit('warn', message)
export const jarvisError = (message, error) =>
  emit('error', error === undefined ? message : `${message} — ${describeError(error)}`)
