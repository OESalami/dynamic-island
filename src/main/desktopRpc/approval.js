import { dialog } from 'electron'
import { truncateUtf8 } from '../../shared/desktopRpc.js'

/**
 * User approval for sensitive desktop actions.
 *
 * The cloud agent never gets silent access to launch applications. A native
 * Windows dialog is shown by the trusted main process and the action proceeds
 * only on an explicit "Allow". A deadline is enforced so an unattended prompt
 * cannot hold an RPC open forever; expiry is a denial.
 *
 * The dialog itself is native UI, not a new dashboard, and it is created only
 * in response to an approved-session RPC request.
 */

/** Shorter than the agent's RPC deadline so a denial arrives as a result. */
export const APPROVAL_TIMEOUT_MS = 7_000

/** Keep prompt details readable and free of accidental log injection. */
function oneLine(value, max = 80) {
  return truncateUtf8(String(value ?? 'unknown').replace(/[\r\n\t]+/g, ' '), max)
}

/**
 * @param {{ method: string, label: string, args: object, callerIdentity?: string, requestId?: string }} request
 * @returns {Promise<boolean>} true only for an explicit user decision to allow.
 */
export async function promptForApproval(request, { timeoutMs = APPROVAL_TIMEOUT_MS } = {}) {
  let timer
  const detail = [
    `JARVIS method: ${oneLine(request.method)}`,
    `Request: ${oneLine(request.requestId, 48)}`,
    `Caller: ${oneLine(request.callerIdentity, 48)}`,
  ].join('\n')

  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ response: 1, timedOut: true }), timeoutMs)
  })

  try {
    const decision = await Promise.race([
      dialog.showMessageBox({
        type: 'warning',
        buttons: ['Allow', "Don't allow"],
        defaultId: 1,
        cancelId: 1,
        title: 'JARVIS desktop action',
        message: `Allow JARVIS to ${oneLine(request.label, 60)}?`,
        detail,
        noLink: true,
      }),
      deadline,
    ])

    const approved = decision?.response === 0 && decision?.timedOut !== true
    console.log(
      `[jarvis-rpc] approval ${approved ? 'granted' : 'denied'} for ${oneLine(request.method)} ` +
        `(request ${oneLine(request.requestId, 48)})`,
    )
    return approved
  } catch (error) {
    // A dialog that cannot be shown is a denial, never a silent grant.
    console.error(`[jarvis-rpc] approval prompt failed: ${String(error?.message ?? error).slice(0, 160)}`)
    return false
  } finally {
    clearTimeout(timer)
  }
}
