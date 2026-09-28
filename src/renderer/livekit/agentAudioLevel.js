import { jarvisWarn } from './livekitLogger.js'

/**
 * Detects whether the agent is audibly talking, from the audio we are already
 * playing, instead of asking LiveKit.
 *
 * Why this exists: `RoomEvent.ActiveSpeakersChanged` does not list the agent.
 * The agent joins as a server-side participant, and the signalling server does
 * not report audio levels for it, so the array only ever contains the local
 * participant. `agentSpeaking` derived from that event is therefore permanently
 * false and the island can never reach `responding`. Verified against the live
 * `my-agent` deployment: the agent is adopted as `agent-<id>`, its audio track
 * subscribes and plays, but it never appears in the speakers array.
 *
 * The level is measured off the same `MediaStream` the SDK hands to the
 * `<audio>` element, so this stays true for any agent: server-side or a real
 * browser participant. The user side keeps using the SDK event, which does work.
 *
 * An `AnalyserNode` is used rather than a `ScriptProcessor`/`AudioWorklet`:
 * it is one node and one buffer per poll, needs no extra module, and Chromium
 * runs it off the audio thread so it costs nothing per sample.
 */

/** RMS above this counts as the agent talking. Deliberately above room noise. */
const SPEAKING_THRESHOLD = 0.02
/** Polling interval. 100 ms is well below the shortest sensible speech burst. */
const POLL_INTERVAL_MS = 100
/** Consecutive loud polls required to report `responding`. */
const ONSET_POLLS = 2
/** Consecutive quiet polls required to report listening again. */
const OFFSET_POLLS = 3

/**
 * Poll an audio stream and report speech onsets/offsets.
 *
 * @param {MediaStream} stream the agent's audio, as returned by `track.mediaStream`.
 * @param {(speaking: boolean) => void} onChange called only when the answer changes.
 * @returns {{ stop: () => void }}
 */
export function watchAgentAudioLevel(stream, onChange) {
  const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!AudioContextCtor || !stream) {
    jarvisWarn('Audio level detection unavailable; responding state may not appear.')
    return { stop() {} }
  }

  let context
  let source
  let analyser
  let timer = null
  let buffer = null
  let speaking = false
  let loudPolls = 0
  let quietPolls = 0
  let stopped = false

  const report = (next) => {
    if (next === speaking) return
    speaking = next
    onChange(speaking)
  }

  const poll = () => {
    if (stopped) return
    analyser.getByteTimeDomainData(buffer)

    // RMS of the time-domain window, normalised to 0..1.
    let sum = 0
    for (let i = 0; i < buffer.length; i += 1) {
      const centred = (buffer[i] - 128) / 128
      sum += centred * centred
    }
    const level = Math.sqrt(sum / buffer.length)

    if (level > SPEAKING_THRESHOLD) {
      loudPolls += 1
      quietPolls = 0
    } else {
      quietPolls += 1
      loudPolls = 0
    }

    if (!speaking && loudPolls >= ONSET_POLLS) report(true)
    else if (speaking && quietPolls >= OFFSET_POLLS) report(false)
  }

  try {
    context = new AudioContextCtor()
    source = context.createMediaStreamSource(stream)
    analyser = context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    buffer = new Uint8Array(analyser.fftSize)

    // Autoplay is already granted for the `<audio>` element, but a context
    // created outside a gesture can still start suspended, which would make every
    // poll read silence.
    if (context.state === 'suspended') void context.resume()

    timer = setInterval(poll, POLL_INTERVAL_MS)
  } catch (error) {
    jarvisWarn('Agent audio level detection failed; responding state may not appear.', error)
  }

  return {
    stop() {
      if (stopped) return
      stopped = true
      if (timer) clearInterval(timer)
      try {
        source?.disconnect()
        analyser?.disconnect()
      } catch {
        // Nodes are being discarded anyway.
      }
      if (context && context.state !== 'closed') void context.close().catch(() => {})
    },
  }
}
