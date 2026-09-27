import { AUTO_HIDE_MS, IPC } from '../../shared/constants.js'
import {
  AUTO_DISMISS_STATES,
  ISLAND_STATES,
  canTransition,
  isIslandState,
} from '../../shared/islandStates.js'
import {
  getIslandWindow,
  hideIslandWindow,
  isIslandWindowVisible,
  repositionIslandWindow,
  showIslandWindow,
} from '../windows/islandWindow.js'

/**
 * Authoritative owner of island state and window visibility.
 *
 * The renderer is a pure mirror: it never commits state, it only renders what
 * this module broadcasts. Keeping the state machine here is what lets a future
 * external JARVIS process drive the island by writing into the same controller,
 * with no renderer changes.
 */

let state = ISLAND_STATES.HIDDEN
let autoHideTimer = null
/** Guards against a dismissal racing a new show request. */
let dismissalPending = false

function send(channel, payload) {
  const window = getIslandWindow()
  if (!window || window.isDestroyed()) return
  window.webContents.send(channel, payload)
}

export function getState() {
  return state
}

function clearAutoHide() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer)
    autoHideTimer = null
  }
}

function scheduleAutoHide() {
  clearAutoHide()
  if (!AUTO_DISMISS_STATES.includes(state)) return
  autoHideTimer = setTimeout(() => {
    autoHideTimer = null
    hide()
  }, AUTO_HIDE_MS)
}

/**
 * Commit a state change. Rejects unknown states and illegal transitions so a
 * stray IPC message can never leave the UI in an undefined state.
 */
function commit(next) {
  if (!isIslandState(next)) {
    console.warn('[jarvis-island] rejected unknown state:', next)
    return false
  }
  if (next === state) return true
  if (!canTransition(state, next)) {
    console.warn(`[jarvis-island] rejected transition ${state} -> ${next}`)
    return false
  }

  state = next
  send(IPC.STATE_CHANGE, state)
  scheduleAutoHide()
  return true
}

/** Request the island become visible. */
export function show() {
  clearAutoHide()
  dismissalPending = false

  if (state === ISLAND_STATES.HIDDEN) {
    state = ISLAND_STATES.IDLE
    // Show first, then announce: the window is transparent, so showing it before
    // React has content is invisible, and this avoids a flash of empty canvas.
    showIslandWindow()
    send(IPC.STATE_CHANGE, state)
    send(IPC.VISIBILITY_CHANGE, true)
    return
  }

  showIslandWindow()
  send(IPC.VISIBILITY_CHANGE, true)
}

/**
 * Request the island hide.
 *
 * The window is not hidden immediately. State goes to `hidden`, the renderer runs
 * its exit animation, and the window is hidden only when the renderer reports
 * `island:animation-complete`. Hiding straight away would cut the animation off.
 */
export function hide() {
  clearAutoHide()

  if (state === ISLAND_STATES.HIDDEN) {
    hideIslandWindow()
    send(IPC.VISIBILITY_CHANGE, false)
    return
  }

  dismissalPending = true
  state = ISLAND_STATES.HIDDEN
  send(IPC.STATE_CHANGE, state)
}

export function toggle() {
  if (isIslandWindowVisible()) {
    hide()
  } else {
    show()
  }
}

/** Called by the renderer once the exit animation has finished. */
export function completeAnimation() {
  if (!dismissalPending) return
  dismissalPending = false
  hideIslandWindow()
  send(IPC.VISIBILITY_CHANGE, false)
}

/** Renderer-initiated state change request. */
export function requestState(next) {
  if (!isIslandState(next)) {
    console.warn('[jarvis-island] rejected unknown state request:', next)
    return
  }
  if (next === ISLAND_STATES.HIDDEN) {
    hide()
    return
  }

  if (state === ISLAND_STATES.HIDDEN) {
    // Entering from hidden always goes through the visible entry point first, so
    // a request from an external source (or a cold renderer) actually shows the
    // island rather than only changing state behind a hidden window.
    show()
    // no-op when next is already the idle entry state
    commit(next)
    return
  }

  // No clearAutoHide() here: commit() owns timer management, so a rejected
  // transition cannot silently cancel a dismissal that was already pending.
  commit(next)
}

/** Keep the island centred if the display layout changes while it is running. */
export function onDisplayChanged() {
  repositionIslandWindow()
}
