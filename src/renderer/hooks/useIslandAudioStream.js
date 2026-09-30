import { useEffect, useState } from 'react'

import { ISLAND_STATES } from '../../shared/islandStates.js'
import { jarvisSession } from '../livekit/index.js'

/**
 * The audio the island's visualizer should draw.
 *
 * Which of the two sources is interesting depends on who holds the floor, so the
 * island state picks between them:
 *
 *   responding  -> the agent's audio, because the user is hearing the answer
 *   listening   -> the microphone, because that is the signal the agent is
 *                  waiting on
 *   processing  -> the microphone, for the tail of the user's own question
 *
 * `processing` uses the microphone deliberately. The agent is thinking, so its
 * track is usually already gone, and the live signal here is the user still
 * finishing their sentence. It also keeps the bars alive across the transition,
 * because the microphone stream does not change between `listening` and
 * `processing` — so the analyser is not torn down and rebuilt on the way.
 *
 * Null in both cases is normal and not an error: no session, or the agent has not
 * published a track yet. The visualizer falls back to its demo animation then.
 */
function selectStream(state, agentStream, microphoneStream) {
  return state === ISLAND_STATES.RESPONDING ? agentStream : microphoneStream
}

/**
 * Reads the current audio sources and re-reads them when they change.
 *
 * This is the only place the island touches audio at all, which keeps the
 * LiveKit boundary where it already is: the hook asks the session service, which
 * asks the client, and neither the session nor the room leaks into a component.
 *
 * Identity is the whole trick here. The session hands back the same `MediaStream`
 * object for as long as the underlying track is unchanged, and React's `Object.is`
 * on state is what stops the visualizer from rebuilding its Web Audio analyser
 * every render. Comparing streams by value instead would defeat that.
 */
export function useIslandAudioStream(state) {
  const [sources, setSources] = useState(() => ({
    agent: jarvisSession.getAgentAudioStream(),
    microphone: jarvisSession.getMicrophoneStream(),
  }))

  useEffect(() => {
    // Re-read on subscribe: a session may have come up between first render and
    // this effect, in which case the event that would have told us already passed.
    const sync = () => {
      const agent = jarvisSession.getAgentAudioStream()
      const microphone = jarvisSession.getMicrophoneStream()
      setSources((current) =>
        current.agent === agent && current.microphone === microphone
          ? current
          : { agent, microphone }
      )
    }

    sync()
    return jarvisSession.onAudioSourcesChange(sync)
  }, [])

  return selectStream(state, sources.agent, sources.microphone)
}
