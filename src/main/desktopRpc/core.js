import {
  DesktopRpcError,
  RPC_ERROR_CODES,
  isAllowedMethod,
  ok,
  parseRpcPayload,
  serializeRpcError,
  validateRpcPayload,
} from '../../shared/desktopRpc.js'

/**
 * The pure dispatch core for desktop RPC.
 *
 * Electron/IPC concerns live in `index.js`; this module knows only about the
 * contract, a table of tools and two injected policy callbacks. That keeps the
 * security decisions testable without a running Electron app or LiveKit room.
 *
 * Every failure is converted into a structured string envelope. Internal error
 * objects and stacks never leave this function: the injected logger receives a
 * short diagnostic for the local console, and the agent gets a stable code.
 */
export function createDesktopRpcDispatcher({
  tools,
  approval,
  logger = console,
  checkSession = ({ request, context }) => {
    if (!context.isLiveSession() || !context.expectedSessionId || !request.sessionId) {
      throw new DesktopRpcError(
        RPC_ERROR_CODES.SESSION_INACTIVE,
        'The JARVIS session is not active.',
      )
    }
    if (request.sessionId !== context.expectedSessionId) {
      throw new DesktopRpcError(
        RPC_ERROR_CODES.SESSION_INACTIVE,
        'The request belongs to a different session.',
      )
    }
  },
}) {
  return async function dispatch(request, context) {
    try {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new DesktopRpcError(RPC_ERROR_CODES.INVALID_PAYLOAD, 'Malformed RPC request')
      }

      checkSession({ request, context })

      const { method, payload, callerIdentity, requestId } = request
      if (!isAllowedMethod(method)) {
        throw new DesktopRpcError(RPC_ERROR_CODES.UNSUPPORTED_METHOD, 'Method is not supported')
      }

      const tool = tools[method]
      if (!tool || typeof tool.run !== 'function') {
        throw new DesktopRpcError(RPC_ERROR_CODES.UNSUPPORTED_METHOD, 'Method is not available')
      }

      const args = validateRpcPayload(method, parseRpcPayload(payload))

      if (tool.sensitive) {
        const approved = await approval({
          method,
          args,
          callerIdentity,
          requestId,
          label: tool.label ?? method,
        })
        if (approved !== true) {
          throw new DesktopRpcError(RPC_ERROR_CODES.APPROVAL_DENIED, 'The user did not approve this action.')
        }
      }

      const data = await tool.run(args, {
        callerIdentity,
        requestId,
        sessionId: request.sessionId,
      })
      return ok(data ?? null)
    } catch (error) {
      if (error instanceof DesktopRpcError) {
        return serializeRpcError(error.code, error.message)
      }
      // No stack, no error object: only a short line for the local console.
      const detail = error instanceof Error ? error.message : String(error)
      logger.error(`[jarvis-rpc] action failed: ${String(detail).slice(0, 160)}`)
      return serializeRpcError(RPC_ERROR_CODES.INTERNAL, 'Desktop action failed.')
    }
  }
}
