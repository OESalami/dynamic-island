import { SESSION_PHASES } from '../../shared/sessionPhases.js'
import { LiveKitConfigError } from './livekitConfig.js'
import { TokenRequestError } from './livekitToken.js'
import { redact } from './livekitLogger.js'

/**
 * The event vocabulary of the LiveKit module.
 *
 * `livekitClient.js` is the only module that knows LiveKit exists, and it does
 * not speak LiveKit's vocabulary upward: it translates the SDK's room, track and
 * participant events into the small, stable set below, and this file owns the
 * translation into island-facing session phases.
 *
 * That indirection is the point. The session service, the island controller and
 * the UI never see `RoomEvent.*`, `ParticipantEvent.*` or an SDK error class, so
 * a LiveKit SDK upgrade is absorbed by one file, and the LiveKit details stay out
 * of the Dynamic Island entirely.
 *
 * Agent state: the installed SDK exposes no agent/session-state event. What it
 * does expose is `Participant.isAgent` plus server-driven active-speaker updates,
 * and those are what the phases are derived from. If the agent framework later
 * publishes a session state, this file is the only place that has to learn about
 * it — no caller of `phaseForEvent` changes.
 */

/** Normalised events emitted by the LiveKit client wrapper. */
export const SESSION_EVENTS = Object.freeze({
  /** The room is connected and the local participant has joined. */
  CONNECTED: 'connected',
  /** The room closed. `payload.intentional` distinguishes our own teardown. */
  DISCONNECTED: 'disconnected',
  /** SDK connection state changed, e.g. `reconnecting` then `reconnected`. */
  CONNECTION_STATE: 'connectionState',
  /** A remote agent participant joined the room. */
  AGENT_JOINED: 'agentJoined',
  /** The agent left. The room may still be up. */
  AGENT_LEFT: 'agentLeft',
  /** A remote audio track arrived and is being played. */
  AGENT_AUDIO_SUBSCRIBED: 'agentAudioSubscribed',
  /** A remote audio track went away and its element was removed. */
  AGENT_AUDIO_UNSUBSCRIBED: 'agentAudioUnsubscribed',
  /** Playback of agent audio started or stopped at the element level. */
  AGENT_AUDIO_PLAYBACK: 'agentAudioPlayback',
  /** Active speakers changed. Payload: `{ agentSpeaking, userSpeaking }`. */
  ACTIVE_SPEAKERS: 'activeSpeakers',
  /** The local microphone was published or unpublished. `{ enabled }` */
  MICROPHONE: 'microphone',
  /** Something failed. Payload: `{ code, message }`. */
  FAILURE: 'failure',
})

/**
 * Failure codes. Stable strings, so they can be logged, asserted on, and shown in
 * the `error` state without carrying any LiveKit error object around.
 */
export const SESSION_ERROR_CODES = Object.freeze({
  CONFIG_MISSING: 'config-missing',
  TOKEN_UNAVAILABLE: 'token-unavailable',
  TOKEN_REJECTED: 'token-rejected',
  TOKEN_INVALID: 'token-invalid',
  CONNECT_FAILED: 'connect-failed',
  CONNECTION_LOST: 'connection-lost',
  MICROPHONE_DENIED: 'microphone-denied',
  MICROPHONE_UNAVAILABLE: 'microphone-unavailable',
  MICROPHONE_FAILED: 'microphone-failed',
  AUDIO_SUBSCRIPTION_FAILED: 'audio-subscription-failed',
  AUDIO_PLAYBACK_BLOCKED: 'audio-playback-blocked',
  AGENT_LEFT: 'agent-left',
  UNKNOWN: 'unknown',
})

/**
 * Which phase an event puts the session in, or `null` when it changes nothing.
 *
 * The mapping deliberately reuses the island's existing states rather than
 * inventing new ones:
 *
 *   connected            -> nothing yet: the island shows its connecting pill
 *   microphone enabled   -> listening
 *   user speaking        -> processing
 *   agent speaking       -> responding
 *   neither speaking     -> listening
 *   failure              -> error
 *
 * `agentSpeaking` wins over `userSpeaking` when both are true: the user hearing
 * the answer is the more important thing to show, and barge-in is the case where
 * the agent keeps talking anyway.
 */
export function phaseForEvent(event, payload) {
  switch (event) {
    case SESSION_EVENTS.MICROPHONE:
      return payload?.enabled ? SESSION_PHASES.LISTENING : null

    case SESSION_EVENTS.ACTIVE_SPEAKERS:
      if (payload?.agentSpeaking) return SESSION_PHASES.SPEAKING
      if (payload?.userSpeaking) return SESSION_PHASES.THINKING
      return SESSION_PHASES.LISTENING

    case SESSION_EVENTS.FAILURE:
      return SESSION_PHASES.ERROR

    case SESSION_EVENTS.DISCONNECTED:
      // A room that closed while we were not tearing it down is a lost
      // connection, not a clean end. The intentional teardown reports `stopped`
      // instead and never reaches here.
      return payload?.intentional ? null : SESSION_PHASES.ERROR

    default:
      return null
  }
}

/** True for a `getUserMedia` rejection caused by the user or the OS policy. */
function isPermissionError(error) {
  return (
    error?.name === 'NotAllowedError' ||
    error?.name === 'PermissionDeniedError' ||
    error?.name === 'SecurityError'
  )
}

/** True for a `getUserMedia` rejection caused by there being no microphone. */
function isMissingDeviceError(error) {
  return (
    error?.name === 'NotFoundError' ||
    error?.name === 'DevicesNotFoundError' ||
    error?.name === 'OverconstrainedError'
  )
}

/**
 * Turn any thrown value into a `{ code, message }` pair.
 *
 * The message is redacted and the object is dropped, so a LiveKit error that
 * happens to embed a token cannot reach a log line or the island.
 *
 * `fallbackCode` lets the caller keep the code meaningful for where the error
 * happened: a failure while publishing the microphone is `microphone-failed`, not
 * a generic `connect-failed`.
 */
export function describeFailure(error, fallbackCode = SESSION_ERROR_CODES.UNKNOWN) {
  if (error instanceof TokenRequestError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof LiveKitConfigError) {
    return { code: SESSION_ERROR_CODES.CONFIG_MISSING, message: error.message }
  }
  if (isPermissionError(error)) {
    return {
      code: SESSION_ERROR_CODES.MICROPHONE_DENIED,
      message: 'Microphone access was denied. Allow the microphone for this app and try again.',
    }
  }
  if (isMissingDeviceError(error)) {
    return {
      code: SESSION_ERROR_CODES.MICROPHONE_UNAVAILABLE,
      message: 'No microphone was found.',
    }
  }
  // A wrapped failure carries its own code (that is how a connect error survives
  // being re-thrown); anything else is reported as the caller's fallback.
  const code = typeof error?.code === 'string' ? error.code : fallbackCode
  return { code, message: redact(error?.message ?? 'The session failed for an unknown reason.') }
}
