import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants.js'
import { getPrimaryIslandBounds } from '../utils/screen.js'

/**
 * The single island window. This module owns every BrowserWindow option so no
 * other file has to reason about window flags.
 *
 * The window is only a transparent, click-through canvas sitting at the top
 * centre of the screen. The visible pill is drawn by React; no OS window chrome
 * is used to render it.
 */

let islandWindow = null

/**
 * `KEY:channel` pairs the sandboxed preload parses out of its own argv.
 * A sandboxed preload cannot require this module, so the values are injected
 * rather than imported.
 */
const IPC_ARGUMENT = Object.entries(IPC)
  .map(([key, channel]) => `${key}:${channel}`)
  .join(',')

function buildWebPreferences() {
  return {
    preload: path.join(app.getAppPath(), 'src', 'preload', 'preload.js'),

    // Security posture. Node is not reachable from React.
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,

    // Remote agent audio is played by the renderer with no user gesture and no
    // focus: the window is a non-focusable overlay and the shortcut is global, so
    // a gesture-gated policy would silence the agent. This is also the Electron
    // default, set explicitly because the requirement is that the agent is
    // *audible*, not that it is gesture-gated.
    autoplayPolicy: 'no-user-gesture-required',

    // Required for a long-lived WebRTC session, and off by default.
    //
    // This window is created hidden and is hidden again whenever the island is
    // dismissed, which Chromium counts as a background page: its timers are
    // throttled to roughly one tick per minute. The LiveKit SDK's signalling
    // heartbeat is a plain `setTimeout`/`setInterval` (the SDK's `CriticalTimers`
    // helper is a thin wrapper, not a worker), so a throttled renderer can miss
    // the server's ping deadline, the SDK declares the signal lost, and the
    // participant is torn down and rejoined — the exact `signalReconnecting`
    // failure this app must not have. The island's visibility has no business
    // affecting a media connection, so throttling is disabled outright.
    backgroundThrottling: false,

    additionalArguments: [`--island-ipc=${IPC_ARGUMENT}`],
  }
}

export function createIslandWindow() {
  islandWindow = new BrowserWindow({
    ...getPrimaryIslandBounds(),

    // Hidden until the first show request, per spec.
    show: false,

    // The pill is React + CSS, not OS chrome.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',

    // Fixed canvas: the island expands within it, the window never resizes.
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,

    // Transparent Windows windows cannot carry a native shadow, and Win11
    // rounding leaves visible artifacts, so both are off; the pill's shadow is
    // pure CSS.
    hasShadow: false,
    roundedCorners: false,

    // Never steal focus from whatever the user is working in. On Windows this
    // also implies skipTaskbar. Flip to true (keeping showInactive()) if the
    // island ever needs keyboard input.
    focusable: false,

    title: 'JARVIS Dynamic Island',
    webPreferences: buildWebPreferences(),
  })

  // 'screen-saver' keeps the island above full-screen apps, not just normal ones.
  islandWindow.setAlwaysOnTop(true, 'screen-saver')

  // The canvas is larger than the pill, so the transparent remainder must not
  // swallow clicks meant for the app underneath. `forward: true` keeps mousemove
  // flowing to the renderer so it can detect hover on the island and flip this
  // off while the pointer is actually over it.
  islandWindow.setIgnoreMouseEvents(true, { forward: true })

  islandWindow.on('closed', () => {
    islandWindow = null
  })

  return islandWindow
}

export function getIslandWindow() {
  return islandWindow
}

/** Centre the window again, e.g. after a display change. */
export function repositionIslandWindow() {
  if (!islandWindow || islandWindow.isDestroyed()) return
  islandWindow.setBounds(getPrimaryIslandBounds())
}

/** Keep the island topmost and click-through unless the pointer is over it. */
export function setMouseInteractive(interactive) {
  if (!islandWindow || islandWindow.isDestroyed()) return
  islandWindow.setIgnoreMouseEvents(!interactive, { forward: true })
}

/**
 * Show without activating. `show()` would try to focus the window, which is
 * meaningless (and undesirable) for a non-focusable overlay.
 *
 * Showing and hiding the island is purely cosmetic. It does not start, stop or
 * otherwise affect a voice session: the renderer keeps the same LiveKit room
 * across island visibility changes, and `webPreferences.backgroundThrottling` is
 * off so a hidden window still runs the signalling heartbeat on time.
 */
export function showIslandWindow() {
  if (!islandWindow || islandWindow.isDestroyed()) return
  if (!islandWindow.isVisible()) {
    console.log('[jarvis-island] window shown (voice session unaffected)')
    islandWindow.showInactive()
  }
}

export function hideIslandWindow() {
  if (!islandWindow || islandWindow.isDestroyed()) return
  if (islandWindow.isVisible()) {
    console.log('[jarvis-island] window hidden (voice session unaffected)')
    islandWindow.hide()
  }
}

export function isIslandWindowVisible() {
  return Boolean(islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible())
}

/** Load the built renderer, used outside development. */
export function loadProductionRenderer() {
  islandWindow.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'))
}

/** Load the Vite dev server URL, used during development. */
export function loadDevRenderer(url) {
  islandWindow.loadURL(url)
}
