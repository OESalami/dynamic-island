import { DynamicIsland } from './components/dynamic-island/DynamicIsland.jsx'
import { useIslandState } from './hooks/useIslandState.js'
import { useJarvisSession } from './hooks/useJarvisSession.js'

/**
 * Deliberately thin. Island rendering lives in DynamicIsland; the voice session
 * lives in the livekit service and is only wired to the bridge here. This is the
 * app-level wiring: state subscription, session commands, transparent backdrop.
 */
export default function App() {
  const { state } = useIslandState()
  useJarvisSession()

  return (
    // pointer-events-none so the transparent canvas never intercepts clicks;
    // the island itself opts back in via pointer-events-auto.
    <div className="flex size-full items-start justify-center bg-transparent pt-2 pointer-events-none">
      <DynamicIsland state={state} />
    </div>
  )
}
