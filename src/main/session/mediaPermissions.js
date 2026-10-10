import { getIslandWindow } from '../windows/islandWindow.js'

/**
 * Microphone permission handling for the island renderer.
 *
 * The island is the only window in the app, so its session is the app's session.
 * Two handlers are installed on it:
 *
 *   setPermissionRequestHandler — `navigator.mediaDevices.getUserMedia({audio})`
 *     asks here, and calling the callback with `true` grants it without an OS
 *     prompt. Without this, a packaged Electron app has no way to answer the
 *     request and the microphone is simply denied.
 *   setPermissionCheckHandler — Chromium re-checks the permission before capture
 *     and on some capture paths. Answering `true` keeps the two consistent;
 *     answering `false` here would make the grant above a no-op.
 *
 * Scope: only `media` is granted, and only to the island's own webContents.
 * Everything else is denied, which is the default for anything not listed here.
 * Screen capture is deliberately not handled — no `setDisplayMediaRequestHandler`
 * is installed, so `getDisplayMedia` is refused until screen sharing is added.
 *
 * Electron's permission API is coarse: `media` covers audio and video capture and
 * cannot be narrowed to audio only. The renderer never requests video, so the
 * effective scope is still microphone-only, and `webSecurity` stays on — nothing
 * about this setup requires relaxing it.
 */

/** The only permission this app ever grants. */
const ALLOWED_PERMISSIONS = new Set(['media'])

/**
 * True when the request came from the island window.
 *
 * `webContents` is null for permission checks raised outside a frame, which
 * happens for some capture paths; there is only one window in this app, so
 * treating a frameless request as ours is safe and keeps the grant working.
 */
function isIslandFrame(webContents) {
  const window = getIslandWindow()
  if (!window || window.isDestroyed()) return false
  if (!webContents) return true
  return webContents.id === window.webContents.id
}

export function installMediaPermissions() {
  const window = getIslandWindow()
  if (!window) return

  const { session } = window.webContents

  session.setPermissionRequestHandler((webContents, permission, callback) => {
    const granted = ALLOWED_PERMISSIONS.has(permission) && isIslandFrame(webContents)
    console.log(`[jarvis-session] permission ${permission} ${granted ? 'granted' : 'denied'}`)
    callback(granted)
  })

  session.setPermissionCheckHandler((webContents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission) && isIslandFrame(webContents)
  })
}
