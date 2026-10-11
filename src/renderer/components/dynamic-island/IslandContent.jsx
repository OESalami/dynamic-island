import { motion } from 'framer-motion'
import { ThinkingOrb } from 'thinking-orbs'
import { STATE_LABELS } from '../../../shared/islandStates.js'
import { ISLAND_STATE_TO_ORB_STATE } from './orbStates.js'
import { contentFade } from './islandVariants.js'

/**
 * Renders the inside of the island for the current state.
 *
 * Purely presentational: it receives a state and returns markup, with no
 * knowledge of Electron, IPC, or how the state was decided.
 *
 * The four agent states (idle, listening, processing, responding) render a
 * ThinkingOrb in place of a text label. `theme` is pinned to `dark` because the
 * island sits on a black substrate, so the orb always uses light ink. `success`
 * and `error` are not mapped and keep the plain brand text.
 */
function orbProps(state) {
  return {
    state: ISLAND_STATE_TO_ORB_STATE[state],
    size: 32,
    theme: 'dark',
    'aria-label': STATE_LABELS[state] ?? '',
  }
}

export function IslandContent({ state, isCollapsed }) {
  const orbState = ISLAND_STATE_TO_ORB_STATE[state]

  if (isCollapsed) {
    return (
      <motion.span
        variants={contentFade}
        initial="initial"
        animate="animate"
        exit="exit"
        className="text-[11px] font-medium tracking-[0.14em] text-white/70"
      >
        {orbState ? <ThinkingOrb {...orbProps(state)} /> : 'ELIGWEB AI'}
      </motion.span>
    )
  }

  return (
    <div className="flex items-center gap-3 px-5">
      <motion.span
        variants={contentFade}
        initial="initial"
        animate="animate"
        exit="exit"
        className="text-[13px] font-semibold tracking-[0.14em] text-white"
      >
        ELIGWEB AI
      </motion.span>
      <span className="h-3 w-px bg-white/15" />
      <motion.span
        variants={contentFade}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex items-center"
      >
        <ThinkingOrb {...orbProps(state)} />
      </motion.span>
    </div>
  )
}
