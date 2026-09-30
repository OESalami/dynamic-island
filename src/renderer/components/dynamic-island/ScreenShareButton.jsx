import { motion } from 'framer-motion'
import { contentFade } from './islandVariants.js'

/**
 * The island's only screen-sharing control: one small icon, in one place, that is
 * either "share" or "stop sharing".
 *
 * There is deliberately no second button, no label, and no microphone, camera or
 * agent control here — the island's content area belongs to the voice states.
 * What this shows is entirely derived from the session's real screen-sharing
 * state, so the icon cannot claim a share that has ended.
 *
 * The icons are inline SVG rather than a library: the project has no icon
 * dependency, and two 24×24 glyphs are not worth one.
 */

/** The display frame both icons share, so swapping them cannot shift anything. */
function ScreenFrame() {
  return (
    <>
      <rect x="2.75" y="4.25" width="18.5" height="12.5" rx="2.25" />
      <path d="M8.5 20.25h7" />
      <path d="M12 16.75v3.5" />
    </>
  )
}

/** 16px, 1.75 stroke: present when hovered, quiet otherwise. */
const GLYPH_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
}

function ShareScreenIcon() {
  return (
    <svg {...GLYPH_PROPS} className="size-4">
      <ScreenFrame />
      <path d="M12 13.25v-5.5" />
      <path d="M9.5 10.25 12 7.75l2.5 2.5" />
    </svg>
  )
}

function StopSharingIcon() {
  return (
    <svg {...GLYPH_PROPS} className="size-4">
      <ScreenFrame />
      <rect x="9.25" y="7.75" width="5.5" height="5.5" rx="1.25" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ScreenShareButton({ active, onToggle }) {
  const label = active ? 'Stop sharing' : 'Share screen'

  return (
    <motion.button
      type="button"
      variants={contentFade}
      initial="initial"
      animate="animate"
      exit="exit"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={[
        // `pointer-events-auto` is inherited from the island, but the control is
        // stated so it survives being rendered outside it.
        'pointer-events-auto flex shrink-0 cursor-pointer items-center justify-center rounded-full',
        // A 16px icon in a 24px target, with the negative margin keeping the
        // layout footprint at 16px: the island's geometry cannot change.
        '-m-1 p-1 transition-colors duration-150',
        active ? 'bg-white/15 text-white' : 'text-white/45 hover:bg-white/10 hover:text-white/80',
      ].join(' ')}
    >
      {active ? <StopSharingIcon /> : <ShareScreenIcon />}
    </motion.button>
  )
}
