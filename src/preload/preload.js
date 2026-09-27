/**
 * Preload / security bridge.
 *
 * Runs in an isolated world as a sandboxed script. A sandboxed preload cannot
 * `require` local modules, so this file is intentionally self-contained and
 * receives the IPC channel list through `webPreferences.additionalArguments`
 * rather than importing src/shared/constants.js.
 *
 * The renderer gets exactly one global, `window.jarvisIsland`, holding a fixed
 * set of functions. Node, `process`, `fs`, `shell` and raw `ipcRenderer` are
 * never exposed, and no callback ever receives the underlying
 * `IpcRendererEvent` (which would hand back the `sender`).
 */

const { contextBridge, ipcRenderer } = require('electron')

const CHANNEL_ARG_PREFIX = '--island-ipc='

/**
 * Parse the `KEY:channel` pairs injected by the main process.
 * Splits on the first colon only, so channel values keep their own colons.
 */
function readChannels() {
  const arg = process.argv.find((value) => value.startsWith(CHANNEL_ARG_PREFIX))
  if (!arg) {
    throw new Error('[jarvis-island] IPC channels missing from additionalArguments')
  }

  const entries = arg.slice(CHANNEL_ARG_PREFIX.length).split(',').filter(Boolean)
  return Object.fromEntries(
    entries.map((entry) => {
      const separator = entry.indexOf(':')
      return [entry.slice(0, separator), entry.slice(separator + 1)]
    }),
  )
}

const CH = readChannels()

/**
 * Listen on a main -> renderer channel and forward only the payload.
 * Returns an unsubscribe function so React effects can clean up under StrictMode.
 */
function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {}
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const islandApi = {
  /** Ask the main process to make the island visible. */
  show: () => ipcRenderer.send(CH.SHOW),
  /** Ask the main process to dismiss the island. */
  hide: () => ipcRenderer.send(CH.HIDE),
  /** Ask the main process to flip island visibility. */
  toggle: () => ipcRenderer.send(CH.TOGGLE),
  /**
   * Request a state transition. The main process validates it against the state
   * model and is authoritative; the renderer never commits state locally.
   */
  setState: (state) => ipcRenderer.send(CH.SET_STATE, state),
  /** Read the authoritative state. */
  getState: () => ipcRenderer.invoke(CH.GET_STATE),

  /** Subscribe to authoritative state changes. Returns an unsubscribe function. */
  onStateChange: (callback) => subscribe(CH.STATE_CHANGE, callback),
  /** Subscribe to window visibility changes. Returns an unsubscribe function. */
  onVisibilityChange: (callback) => subscribe(CH.VISIBILITY_CHANGE, callback),

  /**
   * Tell the main process the exit animation finished, so it is now safe to
   * actually hide the window. Without this the window would vanish mid-fade.
   */
  notifyAnimationComplete: () => ipcRenderer.send(CH.ANIMATION_COMPLETE),

  /**
   * Toggle click-through. The window is larger than the island so the island can
   * expand inside it; this keeps the transparent remainder transparent to clicks.
   */
  setMouseInteractive: (interactive) =>
    ipcRenderer.send(CH.SET_MOUSE_INTERACTIVE, interactive === true),
}

contextBridge.exposeInMainWorld('jarvisIsland', islandApi)
