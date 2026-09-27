import { useCallback, useEffect, useState } from 'react'
import { ISLAND_STATES, isIslandState } from '../../shared/islandStates.js'
import { bridge } from '../lib/bridge.js'

/**
 * Mirrors the island state owned by the main process.
 *
 * The renderer never decides state, it only renders what main broadcasts, and
 * sends change *requests*. The initial value is seeded from the main process so
 * the first paint matches the real state rather than flashing `hidden`.
 */
export function useIslandState() {
  const [state, setLocalState] = useState(ISLAND_STATES.HIDDEN)

  useEffect(() => {
    let active = true

    const unsubscribe = bridge.onStateChange((next) => {
      if (active && isIslandState(next)) setLocalState(next)
    })

    bridge.getState().then((initial) => {
      if (active && isIslandState(initial)) setLocalState(initial)
    })

    // StrictMode mounts effects twice in development; the guard plus the
    // unsubscribe keeps that from leaking a listener or applying a stale state.
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const setState = useCallback((next) => {
    bridge.setState(next)
  }, [])

  return { state, setState }
}
