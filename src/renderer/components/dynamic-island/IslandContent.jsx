import { motion } from 'framer-motion'
import { STATE_LABELS } from '../../../shared/islandStates.js'
import { contentFade } from './islandVariants.js'

/**
 * Renders the inside of the island for the current state.
 *
 * Purely presentational: it receives a state and returns markup, with no
 * knowledge of Electron, IPC, or how the state was decided.
 */
export function IslandContent({ state, isCollapsed }) {
  if (isCollapsed) {
    return (
      <motion.span
        variants={contentFade}
        initial="initial"
        animate="animate"
        exit="exit"
        className="text-[11px] font-medium tracking-[0.14em] text-white/70"
      >
        JARVIS
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
        JARVIS
      </motion.span>
      <span className="h-3 w-px bg-white/15" />
      <motion.span
        variants={contentFade}
        initial="initial"
        animate="animate"
        exit="exit"
        className="text-[13px] text-white/60"
      >
        {STATE_LABELS[state] ?? ''}
      </motion.span>
    </div>
  )
}
