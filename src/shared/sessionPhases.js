/**
 * The JARVIS voice session phase vocabulary.
 *
 * A "session" is one LiveKit connection: token -> connect -> microphone ->
 * agent -> teardown. The renderer owns the LiveKit connection and reports the
 * session's progress as a phase; the main process maps phases onto island states
 * (see main/session/sessionController.js). Nothing LiveKit-specific ever reaches
 * the island state model, and the island state model never reaches the renderer.
 *
 * Deliberately separate from islandStates.js: a session phase is a transport fact
 * ("we are asking for a token"), an island state is a UI decision. The mapping
 * between them lives in exactly one place, in the process that owns island state.
 */

/**
 * Phases, in the order a healthy session passes through them:
 *
 *   starting -> connecting -> listening <-> thinking <-> speaking
 *   any of the above -> stopping -> stopped
 *   any of the above -> error
 *
 * `listening` is the resting state of a live session: the microphone is published
 * and the app is waiting for the user. `thinking` means the user is (or the agent
 * believes the user is) speaking, `speaking` means the agent has an active audio
 * track. A live session therefore loops between the three indefinitely.
 */
export const SESSION_PHASES = {
  /** Session accepted, identity/room generated, about to ask for a token. */
  STARTING: 'starting',
  /** Token received, opening the LiveKit connection. */
  CONNECTING: 'connecting',
  /** Microphone published, waiting for the user to speak. */
  LISTENING: 'listening',
  /** User speech detected, or the agent is working on a reply. */
  THINKING: 'thinking',
  /** Agent audio is playing. */
  SPEAKING: 'speaking',
  /** Teardown requested (shortcut, quit, or failure). */
  STOPPING: 'stopping',
  /** Fully torn down: microphone released, room disconnected, references cleared. */
  STOPPED: 'stopped',
  /** Session could not run. Always followed by a teardown. */
  ERROR: 'error',
}

export const SESSION_PHASE_LIST = Object.freeze(Object.values(SESSION_PHASES))

/** Guard used by the main process before accepting a phase over IPC. */
export function isSessionPhase(value) {
  return SESSION_PHASE_LIST.includes(value)
}

/** True once the session can no longer produce anything but STOPPED. */
export function isTerminalPhase(phase) {
  return phase === SESSION_PHASES.STOPPED || phase === SESSION_PHASES.ERROR
}
