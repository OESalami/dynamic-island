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

/*
 * The island hangs from the top edge of the screen, so only its two bottom
 * corners are rounded; the top two stay square so the shape meets the screen
 * edge cleanly. Bottom radii are half the height, giving a fully rounded lower
 * edge in both shapes, and are named individually so Framer Motion can morph
 * them (a single `borderRadius` would round all four corners).
 */
const COLLAPSED = {
  width: 128,
  height: 40,
  borderTopLeftRadius: 0,
  borderTopRightRadius: 0,
  borderBottomLeftRadius: 20,
  borderBottomRightRadius: 20,
}

const EXPANDED = {
  width: 260,
  height: 56,
  borderTopLeftRadius: 0,
  borderTopRightRadius: 0,
  borderBottomLeftRadius: 28,
  borderBottomRightRadius: 28,
}

// Scale/opacity only: the island sits flush against the top edge, so there is no
// vertical travel left to animate. `transformOrigin` is pinned to the top in the
// component so it grows down out of the edge rather than from its centre.
export const islandContainer = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.92 },
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
