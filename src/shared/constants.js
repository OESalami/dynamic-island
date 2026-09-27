/**
 * Shared constants for the Dynamic Island overlay.
 *
 * Imported by the main process and the React renderer. Deliberately NOT imported
 * by the preload script: a sandboxed preload cannot `require` local modules, so it
 * receives these values through `webPreferences.additionalArguments` instead.
 */

/**
 * Whitelisted IPC channels. Every channel the app uses is named here.
 * There are intentionally no generic channels (`execute`, `command`, `eval`).
 *
 * `from`/`to` document direction; the renderer and main process each only
 * listen for or invoke the ones that concern them.
 */
export const IPC = {
  /** renderer -> main: request the island become visible */
  SHOW: 'island:show',
  /** renderer -> main: request the island become hidden */
  HIDE: 'island:hide',
  /** renderer -> main: request visibility flip */
  TOGGLE: 'island:toggle',
  /** renderer -> main: request a state transition (state is validated in main) */
  SET_STATE: 'island:set-state',
  /** renderer -> main (invoke): read the current authoritative state */
  GET_STATE: 'island:get-state',
  /** renderer -> main: exit animation finished, safe to hide the window now */
  ANIMATION_COMPLETE: 'island:animation-complete',
  /** renderer -> main: pointer entered/left the island, toggle click-through */
  SET_MOUSE_INTERACTIVE: 'island:set-mouse-interactive',

  /** main -> renderer: authoritative state changed */
  STATE_CHANGE: 'island:state-change',
  /** main -> renderer: window visibility changed */
  VISIBILITY_CHANGE: 'island:visibility-change',
}

/**
 * Window canvas size. The BrowserWindow is non-resizable and deliberately larger
 * than the collapsed pill so the island can expand inside it without a window
 * resize. Anything in this window that is not the pill stays click-through.
 *
 * These are CSS pixels, which Electron treats as device-independent pixels, so
 * they stay correct under Windows display scaling without manual conversion.
 */
export const ISLAND_SIZE = {
  /** Width of the transparent canvas. */
  WIDTH: 560,
  /** Height of the transparent canvas. */
  HEIGHT: 120,
  /** Gap between the top of the work area and the top of the canvas. */
  TOP_OFFSET: 8,
}

/** Vite dev server. Must match `server.port` in vite.config.js. */
export const DEV_SERVER_URL = 'http://localhost:5173'

/** How long to wait for the dev server before giving up. */
export const DEV_SERVER_TIMEOUT_MS = 30_000

/**
 * Development trigger.
 *
 * The intended binding is a bare `Ctrl+Alt`, but Electron's `globalShortcut`
 * cannot express it: Chromium's accelerator parser rejects any combination with
 * no non-modifier key (electron/shell/browser/ui/accelerator_util.cc returns
 * false when the key is VKEY_UNKNOWN). A modifier-only trigger on Windows needs
 * a low-level keyboard hook (`SetWindowsHookEx` / `WH_KEYBOARD_LL`), which would
 * mean a native dependency. That is deliberately not pulled in yet — see
 * ShortcutManager for the seam where it would live.
 */
export const ACCELERATOR = 'Ctrl+Alt+Space'

/**
 * Dev-only shortcut that advances the island one step through the state model.
 * Lets the state architecture and IPC round-trip be verified without JARVIS.
 * Only registered when running unpackaged.
 */
export const DEV_ACCELERATOR = 'Ctrl+Alt+S'

/**
 * Dev-only: the state sequence `Ctrl+Alt+S` cycles through.
 *
 * Every step here is a transition the state model actually permits, so the dev
 * shortcut never gets rejected. `idle` appears twice because `success` and
 * `error` both dismiss back to it, and the list wraps to cover all seven states.
 */
export const DEV_STATE_CYCLE = [
  'idle',
  'listening',
  'processing',
  'responding',
  'success',
  'idle',
  'error',
]

/**
 * Delay before a transient state auto-dismisses the island.
 *
 * Note: the window is created with `focusable: false` so it never steals focus
 * from the user's foreground app. A consequence is that the OS never fires a
 * `blur` event for it, so "dismiss on click away" is not available. Auto-dismiss
 * is therefore time-based. To get real click-away dismissal later, flip
 * `focusable` in islandWindow.js to true (keep `showInactive()`, which still
 * avoids stealing focus) and hide on `blur`.
 */
export const AUTO_HIDE_MS = 4_000
