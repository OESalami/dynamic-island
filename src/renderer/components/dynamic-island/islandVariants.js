/**
 * Reusable Framer Motion configuration for the island.
 *
 * Kept separate from the component so the motion language can be retuned in one
 * place. Tween-based, not spring: springs overshoot, and the target feel is
 * Apple-ish — quick, smooth, no bounce.
 */

/** Standard ease. Fast out, long settle. */
export const EASE = [0.32, 0.72, 0, 1]

export const DURATION = {
  /** Width/height/radius morph between states. */
  shape: 0.34,
  /** Content crossfade, kept under `shape` so text never outlives its box. */
  content: 0.16,
  /** Whole-island enter/exit. */
  presence: 0.26,
}

/** Shared transition for the island's own geometry. */
export const shapeTransition = {
  type: 'tween',
  duration: DURATION.shape,
  ease: EASE,
}

/** Transition for content swapping inside the island. */
export const contentTransition = {
  duration: DURATION.content,
  ease: 'easeOut',
}

const COLLAPSED = {
  width: 128,
  height: 40,
  borderRadius: 999,
}

const EXPANDED = {
  width: 260,
  height: 56,
  borderRadius: 28,
}

export const islandContainer = {
  initial: { opacity: 0, scale: 0.92, y: -8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.92, y: -8 },
  transition: {
    type: 'tween',
    duration: DURATION.presence,
    ease: EASE,
  },
}

/**
 * Geometry per shape. Only two shapes exist in phase 1: the collapsed pill and
 * the expanded card. Later states can be added here without touching the
 * component.
 */
export const islandShape = {
  collapsed: COLLAPSED,
  expanded: EXPANDED,
}

export const contentFade = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: contentTransition,
}
