/**
 * The renderer's entire LiveKit surface.
 *
 * Everything outside this directory imports from here and nothing else, so the
 * set of things the island and the rest of the app can do to a LiveKit session is
 * five functions and a phase subscription:
 *
 *   connect(options)        start a session (token, connect, microphone)
 *   disconnect()            stop it and release the microphone
 *   isConnected()           is the room connected right now
 *   setMicrophoneEnabled(b) mute/unmute within a live session
 *   getConnectionState()    the SDK connection state
 *   onPhase(listener)       subscribe to session phases
 *
 * Screen sharing, camera and chat will be added to this service rather than
 * beside it, so the session architecture they need — a single room, one token, a
 * published microphone, a phase stream, and a teardown that releases everything —
 * is already in place.
 */

export { jarvisSession } from './livekitSession.js'
export { SESSION_EVENTS, SESSION_ERROR_CODES } from './livekitEvents.js'
export { SESSION_PHASES } from '../../shared/sessionPhases.js'
export { describeLiveKitConfig, isLiveKitConfigured } from './livekitConfig.js'
export { onLog } from './livekitLogger.js'
