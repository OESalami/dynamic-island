import { IPC } from '../../shared/constants.js'
import { ISLAND_STATES } from '../../shared/islandStates.js'
import { SESSION_PHASES, isSessionPhase, isTerminalPhase } from '../../shared/sessionPhases.js'
import { getState, hide, requestState, show } from '../island/islandController.js'
import { getIslandWindow } from '../windows/islandWindow.js'

/**
 * Owns the lifecycle of a JARVIS voice session.
 *
 * The main process cannot talk to LiveKit — the renderer has the WebRTC and media
 * APIs for that — so this controller is the half of the session that belongs here:
 * it decides *whether* a session should exist, tells the renderer to start or stop
 * one, and translates what the renderer reports into island state.
 *
 * Island state is still committed by islandController.js, so there is exactly one
 * state machine and one window-visibility owner. This module is the mapping layer
 * between the two worlds, and the only place that mapping exists.
 */

/** Commands sent to the renderer on IPC.SESSION_COMMAND. */
export const SESSION_COMMANDS = Object.freeze({
  START: 'start',
  STOP: 'stop',
})

/**
 * Session phase -> island state.
 *
 * `starting` and `connecting` map to `idle` on purpose: `idle` is the collapsed
 * pill, so the island is visible but makes no claim about the microphone while
 * there is nothing to hear yet, and it becomes the expanded card the moment the
 * microphone is actually live. `stopping` maps to nothing — the island is already
 * being dismissed by the caller, and re-targeting it mid-dismissal would fight the
 * exit animation.
 */
const PHASE_TO_ISLAND_STATE = Object.freeze({
  [SESSION_PHASES.STARTING]: ISLAND_STATES.IDLE,
  [SESSION_PHASES.CONNECTING]: ISLAND_STATES.IDLE,
  [SESSION_PHASES.LISTENING]: ISLAND_STATES.LISTENING,
  [SESSION_PHASES.THINKING]: ISLAND_STATES.PROCESSING,
  [SESSION_PHASES.SPEAKING]: ISLAND_STATES.RESPONDING,
  [SESSION_PHASES.ERROR]: ISLAND_STATES.ERROR,
  [SESSION_PHASES.STOPPED]: ISLAND_STATES.HIDDEN,
})

/**
 * The phase of the live session, or `null` when no session exists.
 *
 * `null` is the single source of truth for the single-session rule: every start
 * request is refused while this is set, and every stop is a no-op while it is not.
 */
let activePhase = null

/** Increments per session so late reports from a previous session can be dropped. */
let sessionCounter = 0
let activeSessionId = null

function sendCommand(command) {
  const window = getIslandWindow()
  if (!window || window.isDestroyed()) return false
  window.webContents.send(IPC.SESSION_COMMAND, { command, sessionId: activeSessionId })
  return true
}

/**
 * Ask the renderer to start a session and reveal the island.
 * Returns false when a session already exists, which is what stops a second press
 * (or a second instance) from creating a duplicate room.
 */
export function startSession() {
  if (activePhase) {
    console.warn(`[jarvis-session] start ignored: a session is already ${activePhase}.`)
    return false
  }

  activePhase = SESSION_PHASES.STARTING
  activeSessionId = `session-${++sessionCounter}`

  // Show first so the island reflects the connection attempt immediately; the
  // renderer's first report moves it on. `show()` on a hidden island enters at
  // `idle`, which is the collapsed "connecting" pill.
  show()

  if (!sendCommand(SESSION_COMMANDS.START)) {
    console.warn('[jarvis-session] start failed: no renderer to receive the command.')
    activePhase = null
    activeSessionId = null
    return false
  }

  return true
}

/**
 * Ask the renderer to tear the session down and dismiss the island.
 *
 * The island is dismissed immediately rather than waiting for the renderer's
 * `stopped` report: teardown involves a network round trip, and the user asked
 * for the session to end, so the UI must not imply it is still running.
 */
export function stopSession() {
  if (!activePhase) return false

  console.log('[jarvis-session] stop requested.')
  sendCommand(SESSION_COMMANDS.STOP)

  activePhase = null
  activeSessionId = null
  hide()
  return true
}

/** The accelerator's new meaning: start a session, or stop the one that is running. */
export function toggleSession() {
  return activePhase ? stopSession() : startSession()
}

/**
 * Handle one renderer session report.
 *
 * `payload.sessionId` is checked so a report from a session the user has already
 * ended cannot move the island. A report without one is accepted, which keeps the
 * bridge usable from a renderer that has not been told a session id (e.g. the
 * no-op browser fallback under `npm run dev:renderer`).
 */
export function handleSessionStatus(payload) {
  if (!payload || typeof payload !== 'object') return
  const { phase, sessionId, code, message } = payload

  if (sessionId && sessionId !== activeSessionId) {
    console.warn(`[jarvis-session] dropped stale report (${phase}) from ${sessionId}.`)
    return
  }
  if (!isSessionPhase(phase)) {
    console.warn('[jarvis-session] rejected unknown session phase:', phase)
    return
  }

  if (code || message) {
    console.error(`[jarvis-session] session failure [${code ?? 'unknown'}] ${message ?? ''}`.trim())
  } else {
    console.log(`[jarvis-session] ${phase}`)
  }

  applyPhase(phase)
}

function applyPhase(phase) {
  if (isTerminalPhase(phase)) {
    // `error` is terminal for the *session* even though it is not terminal for the
    // island: the renderer tears down after reporting a failure and never sends a
    // `stopped` report, so the session has to be released here. Without this the
    // error island sits on screen with `activePhase` still set, and the next press
    // of the shortcut asks to stop a session that no longer exists instead of
    // starting one. The session id goes with it, so a late report from the failed
    // session is rejected rather than applied to the next one.
    activePhase = null
    activeSessionId = null
  } else {
    activePhase = phase
  }

  const state = PHASE_TO_ISLAND_STATE[phase]
  if (state === undefined) return

  if (state === ISLAND_STATES.HIDDEN) {
    // `stopped` arrives after the user already dismissed the island. Re-hiding
    // would cancel the pending exit animation, so only act if it is still up.
    if (getState() !== ISLAND_STATES.HIDDEN) hide()
    return
  }

  requestState(state)
}

/** Best-effort teardown on quit. The renderer is usually gone by the time this runs. */
export function shutdownSession() {
  if (!activePhase) return
  sendCommand(SESSION_COMMANDS.STOP)
  activePhase = null
  activeSessionId = null
}
