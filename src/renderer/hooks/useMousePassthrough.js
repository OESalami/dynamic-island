import { useCallback } from 'react'
import { bridge } from '../lib/bridge.js'

/**
 * Keeps the transparent part of the window click-through.
 *
 * The window canvas is larger than the pill so the island can expand inside it.
 * The OS is told to ignore mouse events by default, and only the island itself
 * opts back in: the window is set to `forward: true`, so hover events still
 * reach this component while the rest of the window stays transparent to input.
 */
export function useMousePassthrough() {
  const onPointerEnter = useCallback(() => {
    bridge.setMouseInteractive(true)
  }, [])

  const onPointerLeave = useCallback(() => {
    bridge.setMouseInteractive(false)
  }, [])

  return { onPointerEnter, onPointerLeave }
}
