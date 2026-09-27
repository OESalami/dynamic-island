import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants.js'
import {
  completeAnimation,
  getState,
  hide,
  requestState,
  show,
  toggle,
} from '../island/islandController.js'
import { getIslandWindow, setMouseInteractive } from '../windows/islandWindow.js'

/**
 * Registers every renderer-facing IPC channel.
 *
 * All channels are explicitly named in shared/constants.js and all are handled
 * here, so nothing reaches ipcRenderer that was not deliberately exposed. There
 * are no generic `execute` / `command` / `eval` channels by design.
 */

/**
 * Only accept messages from our own island window.
 *
 * Electron security guidance: any frame can in principle send IPC, including
 * iframes and devtools, so the sender is checked before doing anything.
 */
function isTrustedSender(event) {
  const window = getIslandWindow()
  if (!window || window.isDestroyed()) return false
  return event.sender === window.webContents
}

export function registerIpcHandlers() {
  ipcMain.on(IPC.SHOW, (event) => {
    if (isTrustedSender(event)) show()
  })

  ipcMain.on(IPC.HIDE, (event) => {
    if (isTrustedSender(event)) hide()
  })

  ipcMain.on(IPC.TOGGLE, (event) => {
    if (isTrustedSender(event)) toggle()
  })

  ipcMain.on(IPC.SET_STATE, (event, state) => {
    if (!isTrustedSender(event)) return
    if (typeof state !== 'string') return
    requestState(state)
  })

  ipcMain.handle(IPC.GET_STATE, (event) => {
    if (!isTrustedSender(event)) return null
    return getState()
  })

  ipcMain.on(IPC.ANIMATION_COMPLETE, (event) => {
    if (isTrustedSender(event)) completeAnimation()
  })

  ipcMain.on(IPC.SET_MOUSE_INTERACTIVE, (event, interactive) => {
    if (isTrustedSender(event)) setMouseInteractive(interactive)
  })
}
