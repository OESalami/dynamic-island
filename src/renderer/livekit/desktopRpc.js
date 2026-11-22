import { RpcError } from 'livekit-client'
import {
  DesktopRpcError,
  RPC_ERROR_CODES,
  RPC_LIMITS,
  RPC_METHODS,
  isAllowedMethod,
  parseRpcPayload,
  parseRpcResult,
  serializeRpcError,
  validateRpcPayload,
} from '../../shared/desktopRpc.js'
import { jarvisLog, jarvisWarn } from './livekitLogger.js'

/**
 * LiveKit RPC handlers on the renderer's existing Room.
 *
 * The room owner calls `registerDesktopRpc()` once per connection, before
 * `room.connect()`. Handlers do no desktop work: they validate the caller, the
 * session and the payload, then forward one explicit IPC request to main. The
 * main process remains the only place with access to Electron's desktop APIs.
 *
 * Registration is tracked per Room so a reconnection or a double call can never
 * leave a duplicate handler behind (`Room.registerRpcMethod` throws on a
 * duplicate). `unregisterDesktopRpc()` is called during room teardown.
 */

/** Rooms with RPC handlers installed, and the methods installed on each. */
const registrations = new WeakMap()

/**
 * Recognise the room's agent as the only participant allowed to drive the
 * desktop. If the server marks an agent explicitly, only marked agents qualify.
 * Otherwise the room is accepted only when exactly one remote participant is
 * present — the desktop's per-session rooms have a single agent by design.
 */
export function isAgentCaller(room, identity) {
  if (!room || typeof identity !== 'string' || identity.length === 0) return false
  const participants = [...(room.remoteParticipants?.values() ?? [])]
  if (!participants.some((participant) => participant.identity === identity)) return false

  const agents = participants.filter((participant) => participant.isAgent === true)
  if (agents.length > 0) return agents.some((participant) => participant.identity === identity)
  return participants.length === 1
}

/** Map a stable contract code onto a numeric LiveKit RpcError code. */
function transportCode(error) {
  if (!(error instanceof DesktopRpcError)) return 500
  switch (error.code) {
    case RPC_ERROR_CODES.INVALID_PAYLOAD:
    case RPC_ERROR_CODES.UNSUPPORTED_METHOD:
    case RPC_ERROR_CODES.APP_NOT_ALLOWED:
      return 400
    case RPC_ERROR_CODES.FORBIDDEN_CALLER:
    case RPC_ERROR_CODES.FORBIDDEN_SENDER:
    case RPC_ERROR_CODES.APPROVAL_DENIED:
      return 403
    case RPC_ERROR_CODES.TIMEOUT:
      return 408
    case RPC_ERROR_CODES.SESSION_INACTIVE:
      return 503
    default:
      return 500
  }
}

/** Turn any handler failure into a structured RpcError for the Python agent. */
function asRpcError(error) {
  if (error instanceof DesktopRpcError) {
    return new RpcError(transportCode(error), serializeRpcError(error.code, error.message))
  }
  // Never send a stack trace across the room.
  return new RpcError(
    500,
    serializeRpcError(RPC_ERROR_CODES.INTERNAL, 'Desktop RPC handler failed.'),
  )
}

/** Leave a little of the caller's deadline for the return trip. */
function responseBudgetMs(responseTimeout) {
  const value = Number(responseTimeout)
  if (!Number.isFinite(value) || value <= 0) return 9_000
  return Math.max(1_000, Math.min(value - 400, RPC_LIMITS.MAX_RPC_WAIT_MS))
}

/** Reject if main has not answered within the RPC deadline. */
function withDeadline(promise, timeoutMs, method) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new DesktopRpcError(RPC_ERROR_CODES.TIMEOUT, `Timed out: ${method}`)),
      timeoutMs,
    )
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/**
 * Build one handler per supported method. Injected dependencies keep this
 * testable without a LiveKit room or an Electron app.
 */
export function createDesktopRpcHandlers({
  invoke,
  getSessionId,
  isSessionLive,
  isCallerAllowed,
}) {
  if (typeof invoke !== 'function' || typeof getSessionId !== 'function') {
    throw new TypeError('Desktop RPC requires invoke() and getSessionId()')
  }

  const handle = async (data = {}) => {
    const { method, payload, callerIdentity, requestId, responseTimeout } = data

    // Log identifiers only. Payloads may contain paths or other private data.
    jarvisLog(`RPC ${method} (request ${requestId ?? 'unknown'}) from ${callerIdentity ?? 'unknown'}`)

    try {
      if (typeof method !== 'string' || !isAllowedMethod(method)) {
        throw new DesktopRpcError(RPC_ERROR_CODES.UNSUPPORTED_METHOD, 'Method is not supported')
      }
      if (typeof isCallerAllowed !== 'function' || !isCallerAllowed(callerIdentity)) {
        throw new DesktopRpcError(RPC_ERROR_CODES.FORBIDDEN_CALLER, 'Caller is not the room agent')
      }
      if (typeof isSessionLive !== 'function' || !isSessionLive() || !getSessionId()) {
        throw new DesktopRpcError(RPC_ERROR_CODES.SESSION_INACTIVE, 'No live JARVIS session')
      }

      // Validate here as well as in main: an invalid request never crosses IPC.
      validateRpcPayload(method, parseRpcPayload(payload))

      const result = await withDeadline(
        Promise.resolve().then(() =>
          invoke({
            method,
            payload,
            sessionId: getSessionId(),
            callerIdentity,
            requestId,
          }),
        ),
        responseBudgetMs(responseTimeout),
        method,
      )

      // Throws DesktopRpcError when main returned a structured failure.
      parseRpcResult(result)
      jarvisLog(`RPC ${method} completed (request ${requestId ?? 'unknown'})`)
      return result
    } catch (error) {
      jarvisWarn(`RPC ${method} rejected: ${error?.message ?? 'unknown error'}`)
      throw asRpcError(error)
    }
  }

  return Object.freeze({
    [RPC_METHODS.GET_INFO]: handle,
    [RPC_METHODS.OPEN_APPLICATION]: handle,
  })
}

/**
 * Install handlers on the given Room. Idempotent per Room: an existing set is
 * cleared first, so reconnects or StrictMode-style double calls cannot throw a
 * duplicate-registration error from the SDK.
 */
export function registerDesktopRpc(room, options) {
  if (!room || typeof room.registerRpcMethod !== 'function') return () => {}

  const handlers = createDesktopRpcHandlers(options)
  unregisterDesktopRpc(room)

  const methods = Object.keys(handlers)
  for (const method of methods) {
    try {
      room.registerRpcMethod(method, handlers[method])
    } catch (error) {
      // Leave the room usable for voice; RPC is simply unavailable.
      jarvisWarn(`Could not register RPC method ${method}: ${error?.message ?? 'unknown error'}`)
    }
  }
  registrations.set(room, methods)

  return () => unregisterDesktopRpc(room)
}

/** Detach every RPC handler this module installed on the room. */
export function unregisterDesktopRpc(room) {
  if (!room || typeof room.unregisterRpcMethod !== 'function') return
  const methods = registrations.get(room)
  if (!methods) return
  for (const method of methods) {
    try {
      room.unregisterRpcMethod(method)
    } catch {
      // Already detached by the SDK during disconnect: nothing to do.
    }
  }
  registrations.delete(room)
}
