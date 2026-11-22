import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants.js'
import {
  RPC_ERROR_CODES,
  RPC_METHODS,
  serializeRpcError,
} from '../../shared/desktopRpc.js'
import { isTrustedSender } from '../ipc/index.js'
import { getActiveSessionId, isLiveSession } from '../session/sessionController.js'
import { promptForApproval } from './approval.js'
import { createDesktopRpcDispatcher } from './core.js'
import { createAppTools } from './tools/apps.js'
import { createSystemTools } from './tools/system.js'

/**
 * Main-process entry point for desktop RPC.
 *
 * The renderer never performs desktop operations itself. It forwards an RPC
 * request over one explicit IPC channel; this module verifies the sender, the
 * live JARVIS session and the payload, asks for approval when the tool is
 * sensitive, and dispatches to a small registry of main-process tools.
 */
export function registerDesktopRpcHandlers({ approval = promptForApproval } = {}) {
  const systemTools = createSystemTools()
  const appTools = createAppTools()

  /** Method -> tool. The allowlist and the tool registry are the same object. */
  const tools = Object.freeze({
    [RPC_METHODS.GET_INFO]: systemTools.getInfo,
    [RPC_METHODS.OPEN_APPLICATION]: appTools.openApplication,
  })

  const dispatch = createDesktopRpcDispatcher({ tools, approval })

  ipcMain.handle(IPC.DESKTOP_RPC, async (event, request) => {
    // Only the island renderer can ask for desktop actions. No other window,
    // frame or devtools context gets a handle on this channel.
    if (!isTrustedSender(event)) {
      return serializeRpcError(RPC_ERROR_CODES.FORBIDDEN_SENDER, 'Unexpected IPC sender.')
    }

    try {
      return await dispatch(
        {
          method: request?.method,
          payload: request?.payload,
          sessionId: request?.sessionId,
          callerIdentity: request?.callerIdentity,
          requestId: request?.requestId,
        },
        {
          expectedSessionId: getActiveSessionId(),
          isLiveSession,
        },
      )
    } catch (error) {
      // dispatch is total, but an IPC handler must never leak a stack either.
      console.error(`[jarvis-rpc] unexpected dispatch failure: ${String(error?.message ?? error).slice(0, 160)}`)
      return serializeRpcError(RPC_ERROR_CODES.INTERNAL, 'Desktop action failed.')
    }
  })
}
