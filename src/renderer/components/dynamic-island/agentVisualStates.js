import { ISLAND_STATES } from '../../../shared/islandStates.js'

/**
 * Island state -> Bar Visualizer state.
 *
 * The island and the visualizer name the same moments differently: `processing`
 * is the agent thinking and `responding` is the agent speaking, which the
 * visualizer calls `thinking` and `speaking`. Only the three live voice states
 * are mapped, because those are the only ones that render the visualizer —
 * `hidden` is not rendered at all, and `idle`, `success` and `error` are the
 * collapsed pill.
 *
 * This lives beside the island rather than in `shared/islandStates.js` because it
 * is a rendering concern with no meaning outside the UI: the main process has no
 * use for it, and nothing there should ever learn the visualizer's vocabulary.
 */
export const AGENT_VISUALIZER_STATES = Object.freeze({
  [ISLAND_STATES.IDLE]: 'connecting',
  [ISLAND_STATES.LISTENING]: 'listening',
  [ISLAND_STATES.PROCESSING]: 'thinking',
  [ISLAND_STATES.RESPONDING]: 'speaking',
})

/**
 * The visualizer state to draw for an island state.
 *
 * Collapsed states resolve to `undefined`, so a visualizer that is mounted anyway
 * falls back to its own default rather than pretending to be one of the live
 * voice states.
 */
export function agentVisualizerState(state) {
  return AGENT_VISUALIZER_STATES[state]
}
