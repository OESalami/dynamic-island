import { ISLAND_STATES } from '../../../shared/islandStates.js'

/**
 * Island state -> ThinkingOrb animation.
 *
 * Only the four "agent" states get an orb; `success`/`error`/`hidden` are
 * deliberately absent so they keep their existing rendering. Kept here (rather
 * than in shared/) because the orb is a renderer-only presentation detail — the
 * island state model never learns about it, mirroring how the session-phase
 * mapping is the only place that translation lives.
 */
export const ISLAND_STATE_TO_ORB_STATE = Object.freeze({
  [ISLAND_STATES.IDLE]: 'breathing',
  [ISLAND_STATES.LISTENING]: 'listening',
  [ISLAND_STATES.PROCESSING]: 'solving',
  [ISLAND_STATES.RESPONDING]: 'composing',
})
