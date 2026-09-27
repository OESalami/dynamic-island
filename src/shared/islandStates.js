/**
 * The Dynamic Island state model.
 *
 * Lives in shared/ rather than in the renderer because the main process is the
 * authoritative owner of island state: it validates incoming transitions,
 * decides auto-dismiss, and broadcasts changes. The renderer only mirrors it.
 *
 * Target flow:
 *
 *   hidden -> idle -> listening -> processing -> responding -> idle
 *   success | error  (transient, auto-dismiss back to idle)
 */

export const ISLAND_STATES = {
  HIDDEN: 'hidden',
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  RESPONDING: 'responding',
  SUCCESS: 'success',
  ERROR: 'error',
}

export const ISLAND_STATE_LIST = Object.freeze(Object.values(ISLAND_STATES))

/** Guard used by the main process before accepting a state over IPC. */
export function isIslandState(value) {
  return ISLAND_STATE_LIST.includes(value)
}

/** States that dismiss the island automatically after `AUTO_HIDE_MS`. */
export const AUTO_DISMISS_STATES = Object.freeze([
  ISLAND_STATES.SUCCESS,
  ISLAND_STATES.ERROR,
])

/** States rendered as the small collapsed pill. */
export const COLLAPSED_STATES = Object.freeze([
  ISLAND_STATES.IDLE,
  ISLAND_STATES.SUCCESS,
  ISLAND_STATES.ERROR,
])

/** True when the state renders as the narrow pill rather than the expanded card. */
export function isCollapsedState(state) {
  return COLLAPSED_STATES.includes(state)
}

/**
 * Allowed transitions, used by the main process to reject nonsense state
 * changes. `hidden` is reachable from everywhere (it is the dismissal path) and
 * `idle` is the universal re-entry point once visible.
 */
const TRANSITIONS = {
  [ISLAND_STATES.HIDDEN]: [ISLAND_STATES.IDLE],
  [ISLAND_STATES.IDLE]: [
    ISLAND_STATES.HIDDEN,
    ISLAND_STATES.LISTENING,
    ISLAND_STATES.PROCESSING,
    ISLAND_STATES.RESPONDING,
    ISLAND_STATES.SUCCESS,
    ISLAND_STATES.ERROR,
  ],
  [ISLAND_STATES.LISTENING]: [
    ISLAND_STATES.HIDDEN,
    ISLAND_STATES.IDLE,
    ISLAND_STATES.PROCESSING,
    ISLAND_STATES.ERROR,
  ],
  [ISLAND_STATES.PROCESSING]: [
    ISLAND_STATES.HIDDEN,
    ISLAND_STATES.IDLE,
    ISLAND_STATES.RESPONDING,
    ISLAND_STATES.ERROR,
  ],
  [ISLAND_STATES.RESPONDING]: [
    ISLAND_STATES.HIDDEN,
    ISLAND_STATES.IDLE,
    ISLAND_STATES.SUCCESS,
    ISLAND_STATES.ERROR,
  ],
  [ISLAND_STATES.SUCCESS]: [ISLAND_STATES.HIDDEN, ISLAND_STATES.IDLE],
  [ISLAND_STATES.ERROR]: [ISLAND_STATES.HIDDEN, ISLAND_STATES.IDLE],
}

export function canTransition(from, to) {
  if (from === to) return true
  return (TRANSITIONS[from] ?? []).includes(to)
}

/** Human-readable label per state, so the UI has no hard-coded state strings. */
export const STATE_LABELS = Object.freeze({
  [ISLAND_STATES.HIDDEN]: '',
  [ISLAND_STATES.IDLE]: 'Ready',
  [ISLAND_STATES.LISTENING]: 'Listening',
  [ISLAND_STATES.PROCESSING]: 'Thinking',
  [ISLAND_STATES.RESPONDING]: 'Responding',
  [ISLAND_STATES.SUCCESS]: 'Done',
  [ISLAND_STATES.ERROR]: 'Error',
})
