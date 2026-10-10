import { ConnectionState, LogLevel, Room, RoomEvent, Track, setLogLevel } from 'livekit-client'
import { SESSION_ERROR_CODES, SESSION_EVENTS, describeFailure } from './livekitEvents.js'
import { jarvisError, jarvisLog, jarvisWarn } from './livekitLogger.js'

/**
 * The only module in the app that imports `livekit-client`.
 *
 * Its job is to own one `Room` and translate the SDK's event surface into the
 * normalised events in livekitEvents.js. Nothing above this file knows that
 * LiveKit has a `Room`, that speakers arrive as an array, or that playback is
 * driven by an `<audio>` element that has to be cleaned up by hand.
 *
 * ---------------------------------------------------------------------
 * WHY EVERY ROOM EVENT IS REGISTERED THROUGH `on()` — read this first.
 * ---------------------------------------------------------------------
 *
 * The LiveKit SDK dispatches signalling traffic from a single WebSocket read
 * loop and emits room events *synchronously* from inside it. In
 * `livekit-client`'s `SignalClient.startReadingLoop` the whole iteration is
 *
 *     try {
 *       const { done, value } = await signalReader.read()
 *       if (done) break
 *       this.handleSignalResponse(value)   // <-- emits RoomEvent.* synchronously
 *     } catch (e) {
 *       this.handleOnClose('error in reading loop')   // <-- destroys the socket
 *       break
 *     }
 *
 * There is no isolation between an application event handler and that `catch`.
 * So an exception thrown from *any* handler we register does not just fail that
 * event — it unwinds the read loop, the SDK closes the signalling socket, the
 * engine reports `signalReconnecting`, and the server reaps the desktop
 * participant. The agent sees `participant_disconnected` and closes its session.
 *
 * That is exactly the failure this module was hitting: a bad identifier in the
 * `ActiveSpeakersChanged` handler threw on the first `speakersChanged` signal
 * message — which arrives the moment the agent starts speaking — and killed the
 * socket. The client then "recovered" into a room whose agent was already gone.
 *
 * `on()` therefore wraps every handler, so a renderer-side defect can never
 * reach the SDK's connection machinery. Keep all registrations going through
 * it, and keep handlers free of anything that can throw.
 *
 * Audio playback note: remote agent audio is attached to a detached
 * `<audio>` element created by the SDK and played immediately. There is no player
 * in the UI, nothing to click, and the element is released the moment the track
 * ends or the session stops. The island window is `focusable: false`, which does
 * not affect audio: the window is created with
 * `autoplayPolicy: 'no-user-gesture-required'` (see main/windows/islandWindow.js),
 * and `room.startAudio()` is used as a fallback if a platform ever blocks
 * playback anyway.
 *
 * Microphone: enabled only while a session is running, and released by
 * `disconnect()`. There is no background capture anywhere in this app, and
 * unpublishing the microphone is a mute — it never ends the session.
 */

/**
 * Room options.
 *
 * `disconnectOnPageLeave` makes the SDK tear the room down if the renderer is
 * navigated away from or closed. That is the one place a page-level lifecycle
 * event may legitimately end the connection: the renderer process genuinely is
 * going away and nothing would be left to answer a reconnect. Hiding the island
 * window is *not* page leave and does not reach this.
 *
 * `stopLocalTrackOnUnpublish` makes an unpublish stop the underlying capture
 * track, which is what actually returns the microphone to the OS.
 */
function createRoomOptions() {
  return {
    disconnectOnPageLeave: true,
    stopLocalTrackOnUnpublish: true,
  }
}

/**
 * Quiet the SDK's own logger.
 *
 * At its default level the SDK logs the full signalling URL, which carries the
 * access token as a query parameter — a complete token in the console, which this
 * app must never produce. Warnings and errors are kept because they are the ones
 * worth seeing; the diagnostics that matter are the `[JARVIS]` lines, which come
 * from the modules above rather than from the SDK.
 *
 * Called from the factory rather than at module scope on purpose: this runs
 * inside the session's error boundary, so a bad log level can surface as a
 * session error instead of taking the renderer's module graph — and with it the
 * whole island — down at import time.
 */
function quietSdkLogger() {
  setLogLevel(LogLevel.warn)
}

export function createLiveKitClient({ onEvent }) {
  quietSdkLogger()

  /** @type {Room | null} */
  let room = null
  /** Listener pairs, kept so teardown can detach them before disconnecting. */
  let subscriptions = []
  /** Remote audio elements this client created, for deterministic cleanup. */
  const audioElements = new Set()
  /** The remote participant treated as the agent. */
  let agentParticipant = null
  /** Last speaking state pushed to the session, so only changes are emitted. */
  let lastAgentSpeaking = false
  let lastUserSpeaking = false
  /** Set while `disconnect()` is running, so the resulting event is not a failure. */
  let intentionalDisconnect = false
  let announcedConnected = false
  /**
   * True from the moment the SDK reports an interrupted connection until it
   * confirms recovery. Nothing in this window is allowed to end the session: the
   * server flushes participant updates on resume, so a participant that looks
   * gone mid-recovery may simply not have been re-announced yet.
   */
  let recovering = false

  const emit = (event, payload) => {
    try {
      onEvent?.(event, payload)
    } catch (error) {
      jarvisError('Session event handler failed', error)
    }
  }

  const fail = (code, message) => emit(SESSION_EVENTS.FAILURE, { code, message })

  /**
   * Register a Room event handler that cannot break the connection.
   *
   * The `try/catch` here is load-bearing, not defensive boilerplate — see the
   * header comment. Every Room listener must go through here.
   */
  function on(event, handler) {
    if (!room) return
    const guarded = (...args) => {
      try {
        handler(...args)
      } catch (error) {
        jarvisError(`Room event handler for "${event}" failed; connection left intact`, error)
      }
    }
    room.on(event, guarded)
    subscriptions.push([event, guarded])
  }

  function unwire() {
    for (const [event, handler] of subscriptions) {
      room?.off(event, handler)
    }
    subscriptions = []
  }

  /** One-line identity of the local participant, for the lifecycle log. */
  function localSummary() {
    const local = room?.localParticipant
    if (!local) return 'local participant pending'
    return `local participant ${local.identity} (sid ${local.sid || 'pending'})`
  }

  function disposeElement(element) {
    try {
      element.pause()
      element.srcObject = null
      element.remove()
    } catch {
      // A media element that is already gone is not a problem worth reporting.
    }
    audioElements.delete(element)
  }

  async function attachAgentAudio(track) {
    const element = track.attach()
    audioElements.add(element)
    element.autoplay = true

    try {
      await element.play()
      jarvisLog(`Agent audio playing on ${track.sid}`)
      emit(SESSION_EVENTS.AGENT_AUDIO_PLAYBACK, { playing: true })
    } catch (error) {
      // Retry through the SDK, which replays every attached element.
      try {
        await room.startAudio()
        jarvisLog(`Agent audio playing on ${track.sid} (after startAudio)`)
        emit(SESSION_EVENTS.AGENT_AUDIO_PLAYBACK, { playing: true })
      } catch {
        jarvisWarn('Agent audio was blocked by the platform.')
        fail(
          SESSION_ERROR_CODES.AUDIO_PLAYBACK_BLOCKED,
          'Agent audio could not be played. Check the Windows audio output device.',
        )
      }
      jarvisError('Agent audio playback was refused', error)
    }
  }

  function releaseAgentAudio(track) {
    // `detach()` can throw if the element is already gone, and this runs inside a
    // Room event handler, so it must not be allowed to escape.
    let elements = []
    try {
      elements = track.detach()
    } catch (error) {
      jarvisError(`Detaching agent audio ${track.sid} failed`, error)
    }
    for (const element of elements) {
      disposeElement(element)
    }
  }

  function handleActiveSpeakers(speakers) {
    if (!room) return
    const userSpeaking = speakers.includes(room.localParticipant)
    // The agent is deliberately absent from this list: the server does not report
    // audio levels for a server-side agent, so `agentSpeaking` comes from
    // `agentAudioSpeaking` (measured off the audio we are playing) instead. That
    // measurement is not wired up, so the last known value is carried forward.
    //
    // Both keys must be real bindings. This handler is invoked synchronously from
    // the SDK's signalling read loop: an unbound identifier here throws, and the
    // throw is caught as "error in reading loop", which closes the socket and
    // ends the agent's session. See the header comment.
    setSpeaking({ agentAudioSpeaking: lastAgentSpeaking, sdkUserSpeaking: userSpeaking })
  }

  /**
   * Single place the two speaking signals merge.
   *
   * `agentAudioSpeaking` is measured locally; `sdkUserSpeaking` comes from
   * `ActiveSpeakersChanged`. The agent side wins when both are true, because the
   * user hearing the answer matters more than the tail of their own question —
   * that overlap is barge-in, where the agent is still talking.
   */
  function setSpeaking({ agentAudioSpeaking, sdkUserSpeaking }) {
    const agentSpeaking = agentAudioSpeaking ?? false
    const userSpeaking = agentSpeaking ? false : Boolean(sdkUserSpeaking)
    if (agentSpeaking === lastAgentSpeaking && userSpeaking === lastUserSpeaking) return
    lastAgentSpeaking = agentSpeaking
    lastUserSpeaking = userSpeaking
    if (agentSpeaking) jarvisLog('Agent speaking')
    emit(SESSION_EVENTS.ACTIVE_SPEAKERS, { agentSpeaking, userSpeaking })
  }

  function adoptParticipant(participant) {
    if (agentParticipant) return
    // `isAgent` is set when the server marks the participant as an agent. Older
    // or differently configured agents may not be marked, so the first remote
    // participant is adopted anyway — with one agent per room there is nothing to
    // confuse it with, and audio still plays either way.
    agentParticipant = participant
    jarvisLog(
      participant.isAgent
        ? `Agent joined the room: ${participant.identity}`
        : `Remote participant joined (${participant.identity}); not flagged as an agent, treated as the agent`,
    )
    emit(SESSION_EVENTS.AGENT_JOINED, { identity: participant.identity })
  }

  /**
   * Decide whether the agent really is gone, once the connection is back.
   *
   * A `participantDisconnected` seen during recovery is not proof: the server
   * re-announces its participants on resume. So instead of failing the session on
   * the spot, the agent is looked up in the live participant map. Present means
   * the disconnect was a transport artefact; absent means the agent is genuinely
   * gone and the session should end.
   */
  function verifyAgentAfterRecovery() {
    if (!agentParticipant) return
    if (room?.remoteParticipants.has(agentParticipant.identity)) {
      jarvisLog(`Agent ${agentParticipant.identity} is still in the room after recovery`)
      return
    }
    const identity = agentParticipant.identity
    agentParticipant = null
    jarvisWarn(`Agent ${identity} is not in the room after recovery`)
    emit(SESSION_EVENTS.AGENT_LEFT, { identity })
  }

  function wire(target) {
    on(RoomEvent.Connected, () => {
      if (announcedConnected) return
      announcedConnected = true
      recovering = false
      jarvisLog(`LiveKit connected. ${localSummary()}`)
      // A room created by an automatically dispatched agent can already have one
      // in it by the time we join, so sweep what is already there.
      for (const participant of target.remoteParticipants.values()) {
        adoptParticipant(participant)
      }
      emit(SESSION_EVENTS.CONNECTED, {})
    })

    on(RoomEvent.ConnectionStateChanged, (state) => {
      jarvisLog(`LiveKit connection state: ${state} (${localSummary()})`)
      emit(SESSION_EVENTS.CONNECTION_STATE, { state })
    })

    on(RoomEvent.SignalReconnecting, () => {
      recovering = true
      jarvisWarn(
        `LiveKit signalling interrupted; the SDK is resuming the session (state ${target.state}). ${localSummary()}`,
      )
    })

    on(RoomEvent.Reconnecting, () => {
      recovering = true
      jarvisWarn(`LiveKit connection interrupted; the SDK is reconnecting the session (state ${target.state}).`)
    })

    on(RoomEvent.Reconnected, () => {
      recovering = false
      jarvisLog(`LiveKit connection restored (state ${target.state}). ${localSummary()}`)
      // Only now is the participant list trustworthy again.
      verifyAgentAfterRecovery()
    })

    on(RoomEvent.Disconnected, (reason) => {
      recovering = false
      const how = intentionalDisconnect ? 'requested' : 'unrequested'
      jarvisLog(`LiveKit room disconnected (${how}, reason: ${reason ?? 'unknown'}). ${localSummary()}`)
      emit(SESSION_EVENTS.DISCONNECTED, {
        intentional: intentionalDisconnect,
        reason: reason ?? undefined,
      })
    })

    on(RoomEvent.ParticipantConnected, (participant) => {
      jarvisLog(`Remote participant connected: ${participant.identity}`)
      adoptParticipant(participant)
    })

    on(RoomEvent.ParticipantDisconnected, (participant) => {
      // Only the adopted agent can end the session. Without a guard here, any
      // remote participant leaving while the agent is still unidentified would be
      // reported as the agent leaving and would tear the room down.
      if (!agentParticipant || participant.identity !== agentParticipant.identity) {
        jarvisLog(`Remote participant left: ${participant.identity} (not the agent)`)
        return
      }
      agentParticipant = null
      if (recovering) {
        // Not evidence the agent is gone: the server re-announces participants on
        // resume, and failing the session here would disconnect the room over a
        // transport blip. verifyAgentAfterRecovery() decides once we are back.
        jarvisWarn(`Agent ${participant.identity} reported gone mid-recovery; deferring the verdict`)
        return
      }
      jarvisWarn(`Agent left the room: ${participant.identity}`)
      emit(SESSION_EVENTS.AGENT_LEFT, { identity: participant.identity })
    })

    on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind !== Track.Kind.Audio) return
      if (!agentParticipant) adoptParticipant(participant)
      jarvisLog(`Agent audio subscribed (track ${track.sid} from ${participant.identity})`)
      emit(SESSION_EVENTS.AGENT_AUDIO_SUBSCRIBED, { identity: participant.identity })
      // `attachAgentAudio` is async, so it cannot throw into the SDK's read loop,
      // but an unhandled rejection would be silent. Report it instead.
      void attachAgentAudio(track).catch((error) => {
        jarvisError(`Attaching agent audio ${track.sid} failed`, error)
      })
    })

    on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return
      releaseAgentAudio(track)
      // An agent turn ending is a normal part of a conversation, not the end of
      // the session. Nothing here touches the room.
      jarvisLog(`Agent audio ended (track ${track.sid}); the session stays connected`)
      emit(SESSION_EVENTS.AGENT_AUDIO_UNSUBSCRIBED, {})
    })

    on(RoomEvent.TrackSubscriptionFailed, (trackSid, participant) => {
      jarvisWarn(`Could not subscribe to track ${trackSid} from ${participant?.identity ?? 'unknown'}.`)
      fail(
        SESSION_ERROR_CODES.AUDIO_SUBSCRIPTION_FAILED,
        'Could not subscribe to the agent audio track.',
      )
    })

    on(RoomEvent.AudioPlaybackStatusChanged, (playing) => {
      jarvisLog(`Agent audio playback ${playing ? 'started' : 'stopped'}.`)
      emit(SESSION_EVENTS.AGENT_AUDIO_PLAYBACK, { playing })
    })

    on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers)

    on(RoomEvent.LocalTrackPublished, (publication) => {
      if (publication.source !== Track.Source.Microphone) return
      jarvisLog(`Microphone published (track ${publication.trackSid ?? 'pending'})`)
      emit(SESSION_EVENTS.MICROPHONE, { enabled: true })
    })

    on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source !== Track.Source.Microphone) return
      // Unpublishing is a mute. The room, the agent and the session all stay up.
      jarvisLog('Microphone unpublished; the session stays connected')
      emit(SESSION_EVENTS.MICROPHONE, { enabled: false })
    })
  }

  /**
   * Release the microphone and every remaining local capture track.
   *
   * Only ever called from `disconnect()`. Muting the microphone mid-session goes
   * through `setMicrophoneEnabled(false)` instead and never reaches this.
   */
  async function stopMicrophone() {
    if (!room) return
    try {
      await room.localParticipant.setMicrophoneEnabled(false)
      jarvisLog('Microphone unpublish requested during cleanup')
    } catch (error) {
      // Teardown must finish even if the unpublish fails, so the tracks below are
      // stopped regardless.
      jarvisError('Unpublishing the microphone failed', error)
    }
    for (const publication of room.localParticipant.trackPublications.values()) {
      publication.track?.stop()
    }
  }

  const api = {
    /**
     * Open the room. Resolves once the local participant has joined, so a caller
     * can publish the microphone immediately afterwards.
     */
    async connect(url, token) {
      if (room) throw new Error('Already connected')

      jarvisLog(`Connecting to LiveKit at ${url} (disconnectOnPageLeave enabled)`)
      room = new Room(createRoomOptions())
      intentionalDisconnect = false
      announcedConnected = false
      recovering = false
      lastAgentSpeaking = false
      lastUserSpeaking = false
      wire(room)

      try {
        await room.connect(url, token)
        jarvisLog(`LiveKit connect() resolved. ${localSummary()}`)
      } catch (error) {
        const failure = describeFailure(error, SESSION_ERROR_CODES.CONNECT_FAILED)
        jarvisError('LiveKit connect() failed', error)
        await api.disconnect()
        const wrapped = new Error(failure.message)
        wrapped.code = failure.code
        throw wrapped
      }
    },

    /** Full teardown: microphone, local tracks, remote elements, then the room. */
    async disconnect() {
      if (!room) {
        jarvisLog('LiveKit disconnect() called with no room open; nothing to clean up')
        return
      }

      intentionalDisconnect = true
      jarvisLog(`LiveKit disconnect() requested. ${localSummary()}`)
      // Detach first: a room that closes as a result of our own teardown must not
      // look like a lost connection, and after this point nothing in this module
      // can influence the room's fate.
      unwire()

      await stopMicrophone()

      for (const element of [...audioElements]) {
        disposeElement(element)
      }
      audioElements.clear()

      const target = room
      room = null
      agentParticipant = null
      announcedConnected = false
      recovering = false

      if (target) {
        try {
          await target.disconnect()
          jarvisLog('LiveKit disconnect() completed')
        } catch (error) {
          jarvisError('LiveKit disconnect failed', error)
        }
      }
    },

    isConnected() {
      return room?.state === ConnectionState.Connected
    },

    getConnectionState() {
      return room?.state ?? ConnectionState.Disconnected
    },

    /**
     * Publish or unpublish the microphone.
     *
     * Both directions are a mute, not a session change: the room, the agent and
     * the signalling connection are untouched either way.
     *
     * @returns {Promise<boolean>} whether the microphone ended up in the requested state.
     */
    async setMicrophoneEnabled(enabled) {
      if (!room) return false
      jarvisLog(`Microphone ${enabled ? 'enable' : 'disable'} requested (state ${room.state})`)
      try {
        await room.localParticipant.setMicrophoneEnabled(enabled)
        jarvisLog(`Microphone is now ${enabled ? 'published' : 'unpublished'}; session still connected`)
        return true
      } catch (error) {
        const failure = describeFailure(error, SESSION_ERROR_CODES.MICROPHONE_FAILED)
        jarvisError('Microphone request failed', error)
        fail(failure.code, failure.message)
        return false
      }
    },
  }

  return api
}
