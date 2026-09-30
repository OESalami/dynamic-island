import { AnimatePresence, motion } from 'framer-motion'
import { ISLAND_STATES, isCollapsedState } from '../../../shared/islandStates.js'
import { useMousePassthrough } from '../../hooks/useMousePassthrough.js'
import { bridge } from '../../lib/bridge.js'
import { IslandContent } from './IslandContent.jsx'
import { islandContainer, islandShape, shapeTransition } from './islandVariants.js'

/**
 * The Dynamic Island itself.
 *
 * Owns rendering, state-driven geometry, and enter/exit transitions. It reads
 * the mirrored state from the hook and reaches Electron only through the preload
 * bridge — no Electron API is called from React directly.
 *
 * Two nested motion elements, so the two concerns animate independently:
 *   outer -> presence (opacity + scale), also owns hover / click-through
 *   inner -> shape (width, height, border-radius)
 *
 * Exit is a handshake: `onExitComplete` tells the main process the fade finished,
 * which is the signal it waits for before actually hiding the window. Hiding on
 * the hide request instead would cut the animation off.
 */
export function DynamicIsland({ state, mediaStream }) {
  const isHidden = state === ISLAND_STATES.HIDDEN
  const isCollapsed = isCollapsedState(state)
  const shape = isCollapsed ? islandShape.collapsed : islandShape.expanded
  const { onPointerEnter, onPointerLeave } = useMousePassthrough()

  return (
    <AnimatePresence onExitComplete={() => bridge.notifyAnimationComplete()}>
      {!isHidden && (
        <motion.div
          key="island"
          variants={islandContainer}
          initial="initial"
          animate="animate"
          exit="exit"
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          className="pointer-events-auto flex cursor-default"
        >
          <motion.div
            initial={false}
            animate={shape}
            transition={shapeTransition}
            className="flex items-center justify-center overflow-hidden bg-black shadow-[0_6px_24px_rgba(0,0,0,0.45)]"
          >
            <AnimatePresence mode="wait" initial={false}>
              <IslandContent
                key={state}
                state={state}
                isCollapsed={isCollapsed}
                mediaStream={mediaStream}
              />
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
