import { DynamicIsland } from './components/dynamic-island/DynamicIsland.jsx'
import { useIslandState } from './hooks/useIslandState.js'

/**
 * Deliberately thin. All island behaviour lives in DynamicIsland; this exists to
 * own the state subscription and the full-window transparent backdrop.
 */
export default function App() {
  const { state } = useIslandState()

  return (
    // pointer-events-none so the transparent canvas never intercepts clicks;
    // the island itself opts back in via pointer-events-auto.
    <div className="flex size-full items-start justify-center bg-transparent pt-2 pointer-events-none">
      <DynamicIsland state={state} />
    </div>
  )
}
