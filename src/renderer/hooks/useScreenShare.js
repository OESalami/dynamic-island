import { useCallback, useEffect, useState } from 'react'
import { jarvisSession } from '../livekit/index.js'

/**
 * Mirrors the session's screen-sharing state for the island.
 *
 * The same shape as `useIslandState`, and the same rule: the UI never keeps its
 * own opinion of what is being shared, it renders what the session reports. The
 * session is the only thing that knows — a share can end from a click, from the
 * capture ending outside the app, or from the voice session being torn down, and
 * the icon has to be right in all three.
 *
 * The toggle reads the session's own state rather than React's, so a click that
 * arrives while the state is still settling asks for the right end of the
 * transition instead of repeating the previous one.
 *
 * Like the session, this survives every island change: the effect only
 * subscribes, so unmounting and remounting it (StrictMode, Fast Refresh, an
 * island show/hide) cannot leave a capture running.
 */
export function useScreenShare() {
  const [screenSharing, setScreenSharing] = useState(() => jarvisSession.isScreenSharing())

  useEffect(() => {
    // The subscription delivers the current state on subscribe, so a share that
    // started while this hook was not listening is picked up here.
    return jarvisSession.onScreenShareChange(setScreenSharing)
  }, [])

  const toggleScreenShare = useCallback(() => {
    void jarvisSession.setScreenShareEnabled(!jarvisSession.isScreenSharing())
  }, [])

  return { screenSharing, toggleScreenShare }
}
