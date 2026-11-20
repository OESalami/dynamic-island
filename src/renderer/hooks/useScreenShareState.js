import { useEffect, useState } from 'react'
import { jarvisSession } from '../livekit/index.js'

/**
 * Mirrors the screen share state owned by the session service.
 *
 * The "sharing" indicator is renderer-local UI over a transport fact: it is
 * deliberately not part of island state, so the state machine and the IPC
 * surface stay untouched while the chip still tracks the real track publication
 * (including the immediate replay on mount from `onShareStatus`).
 */
export function useScreenShareState() {
  const [sharing, setSharing] = useState(false)
  useEffect(() => jarvisSession.onShareStatus(setSharing), [])
  return sharing
}