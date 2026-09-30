import { motion } from 'framer-motion'
import { BarVisualizer } from '../ui/bar-visualizer.jsx'
import { agentVisualizerState } from './agentVisualStates.js'
import { contentFade } from './islandVariants.js'

/**
 * Renders the inside of the island for the current state.
 *
 * Purely presentational: it receives a state and returns markup, with no
 * knowledge of Electron, IPC, or how the state was decided.
 *
 * The expanded island shows live audio rather than a status word. Each state maps
 * to a visualizer state, and the bar animation and colour carry the meaning that
 * "Thinking" / "Responding" used to spell out:
 *
 *   listening   one bar blinks in the centre
 *   processing  the same, faster, so the two read as different at a glance
 *   responding  every bar is lit and driven by the agent's real audio
 *   idle        a sweep walks in from both ends
 *
 * `mediaStream` is threaded in rather than read here, to keep this component free
 * of the session.
 */
export function IslandContent({ state, isCollapsed, mediaStream }) {
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
      <BarVisualizer
        state={agentVisualizerState(state)}
        mediaStream={mediaStream}
        barCount={15}
        minHeight={15}
        maxHeight={100}
        centerAlign
        className="h-5 w-28 gap-[3px] bg-transparent p-0"
      />
    </div>
  )
}
