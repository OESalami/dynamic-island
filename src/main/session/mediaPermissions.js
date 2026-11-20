import { desktopCapturer, screen, webContents } from 'electron'
import { getIslandWindow } from '../windows/islandWindow.js'
import { isLiveSession } from './sessionController.js'

/**
 * Media permission handling for the island renderer.
 *
 * The island is the only window in the app, so its session is the app's session.
 * Three gates are installed on it:
 *
 *   setPermissionRequestHandler — `getUserMedia({audio})` requests ask here;
 *     only `media` and `display-capture` are ever granted, and only to the
 *     island's own webContents. Without these, a packaged Electron app has no
 *     way to answer the requests and capture is simply denied.
 *   setPermissionCheckHandler — Chromium re-checks the permission before capture
 *     and on some capture paths. Answering `true` keeps the two consistent;
 *     answering `false` here would make the grants above a no-op.
 *   setDisplayMediaRequestHandler — the renderer's `getDisplayMedia` (which the
 *     LiveKit SDK's screen-share API calls) lands here. This handler is the
 *     single gate for what may be captured: it refuses unless a session is live
 *     and the island's own frame asked, and it resolves only the primary
 *     display — whole screen, video-only — with no chooser.
 *
 * Scope: only `media` (microphone) and `display-capture` (screen) are granted,
 * and only to the island renderer. Everything else is denied, which is the
 * default for anything not listed here.
 *
 * Electron's permission API is coarse: `media` covers audio and video capture
 * and cannot be narrowed to audio only. The renderer never requests a camera,
 * so the effective scope is still microphone-only, and `webSecurity` stays on —
 * nothing about this setup requires relaxing it.
 */

/** The only permissions this app ever grants. */
const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture'])

/**
 * True when the request came from the island window.
 *
 * `webContents` is null for permission checks raised outside a frame, which
 * happens for some capture paths; there is only one window in this app, so
 * treating a frameless request as ours is safe and keeps the grant working.
 */
function isIslandFrame(contents) {
  const window = getIslandWindow()
  if (!window || window.isDestroyed()) return false
  if (!contents) return true
  return contents.id === window.webContents.id
}

/**
 * Strict frame check for display media requests.
 *
 * A display media request carries a frame, so refusing a null or foreign frame
 * is cheaper and safer than the lenient `isIslandFrame` above — that one exists
 * for permission checks, where Chromium sometimes passes no webContents at all.
 */
function isIslandRequestFrame(frame) {
  const window = getIslandWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
  if (!frame || frame.isDestroyed()) return false
  // A `WebFrameMain` carries no owner `webContents` of its own; `fromFrame` is the
  // supported way to go from a frame back to the window that hosts it. Reading a
  // `frame.webContents` property (which does not exist) would reject every request.
  const owner = webContents.fromFrame(frame)
  return Boolean(owner && owner.id === window.webContents.id)
}

/**
 * The only source this app ever shares: the primary display, whole screen.
 *
 * Whole-screen-only was the approved v1 scope — there is deliberately no source
 * picker and no window-level capture. Matching by display id means a
 * multi-monitor setup shares the same display the island sits on.
 */
async function pickPrimaryScreenSource() {
  const sources = await desktopCapturer.getSources({ types: ['screen'] })
  const primary = screen.getPrimaryDisplay()
  return sources.find((source) => source.display_id === String(primary.id)) ?? sources[0] ?? null
}

export function installMediaPermissions() {
  const window = getIslandWindow()
  if (!window) return

  const { session } = window.webContents

  session.setPermissionRequestHandler((contents, permission, callback) => {
    const granted = ALLOWED_PERMISSIONS.has(permission) && isIslandFrame(contents)
    console.log(`[jarvis-session] permission ${permission} ${granted ? 'granted' : 'denied'}`)
    callback(granted)
  })

  session.setPermissionCheckHandler((contents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission) && isIslandFrame(contents)
  })

  // Screen capture. Two gates, both required: a live session to share into, and
  // the island's own frame asking.
  //
  // Deny with a no-argument `callback()`. Passing `{}` looks like a denial but
  // Electron treats a missing video stream on a video request as a programming
  // error: it throws "Video was requested, but no video stream was provided"
  // inside the async handler, which surfaces as an unhandled rejection in main.
  // An empty callback reaches the same refusal without the throw, and the
  // renderer reports it as a refused screen share rather than a session failure.
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!isLiveSession()) {
      console.warn('[jarvis-session] screen share refused: no live session to share into.')
      callback()
      return
    }
    if (!isIslandRequestFrame(request.frame)) {
      console.warn('[jarvis-session] screen share refused: an unexpected frame requested it.')
      callback()
      return
    }

    let source
    try {
      source = await pickPrimaryScreenSource()
    } catch (error) {
      console.error('[jarvis-session] could not enumerate screen sources:', error)
      callback()
      return
    }
    if (!source) {
      console.warn('[jarvis-session] screen share refused: no screen sources are available')
      callback()
      return
    }

    console.log(`[jarvis-session] screen share granted: "${source.name}" (${source.id})`)
    // Video-only v1: no `audio` stream is returned, so screen_share_audio is
    // never published.
    callback({ video: source })
  })
}