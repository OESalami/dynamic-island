import { SESSION_PHASES } from '../../shared/sessionPhases.js'
import { describeLiveKitConfig, readLiveKitConfig } from './livekitConfig.js'
import { createLiveKitClient } from './livekitClient.js'
import {
  SESSION_ERROR_CODES,
  SESSION_EVENTS,
  describeFailure,
  phaseForEvent,
} from './livekitEvents.js'
import { jarvisError, jarvisLog, jarvisWarn } from './livekitLogger.js'
import { createTokenSource, requestAccessToken } from './livekitToken.js'

/**
 * The JARVIS voice session: one LiveKit connection, from token to teardown.
 *
 * This is the service the renderer talks to. It owns the sequence —
 *
 *   start -> read config -> request token -> connect -> enable microphone
 *         -> wait for the agent
 *   stop  -> disable microphone -> unpublish -> stop local tracks
 *         -> remove remote audio elements -> disconnect -> clear references
 *
 * — and nothing else in the app needs to know that any of it involves LiveKit. The
 * Dynamic Island is told about phases; it never learns what caused one.
 *
 * Two invariants:
 *
 *   One session. A start is refused while a session is live or being established,
 *   so a room, a microphone track, an agent job and an audio listener can never be
 *   duplicated. A stop that arrives mid-connect cancels that attempt instead of
 *   queueing behind it, and a start that arrives mid-teardown queues behind the
 *   teardown rather than being swallowed.
 *   No leak. `disconnect()` is idempotent and runs the same teardown whether it
 *   was asked for, reached because of a failure, or triggered by the page going
 *   away. The microphone is never left enabled and no audio element survives it.
 *
 * -------------------------------------------------------------------
 * LIFETIME: the room is owned here, not by the island.
 * -------------------------------------------------------------------
 *
 * This object is a module-level singleton, so it — and the `Room` it holds — is
 * created once per renderer and outlives every React component, every island
 * state change, and every show/hide of the island window. Island phases are
 * emitted *downward* as notifications; nothing that flows back up from the UI can
 * reach the room. The room is closed from exactly three places, and only these:
 *
 *   disconnect()   an explicit end of the JARVIS session
 *   #fail()        a genuine terminal condition (token, connect, microphone,
 *                  lost connection, agent gone)
 *   dispose()      the renderer process itself is going away
 *
 * A phase change, an agent turn starting or ending, or a mute therefore has no
 * path to `room.disconnect()`.
 */

function noop() {}

let idCounter = 0

/**
 * A random suffix for the room and participant names.
 *
 * `crypto.randomUUID` needs a secure context, which both the dev server
 * (`http://localhost`) and the packaged app (`file://`) are, but the fallback
 * keeps identifier generation working if this is ever opened somewhere else.
 * Nothing user-identifying goes into either name: no Windows username, no email,
 * no machine name — a random id only.
 */
function randomId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  idCounter += 1
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${idCounter}`
}

function createSessionIdentifiers() {
  const id = randomId()
  return {
    identity: `jarvis-desktop-${id}`,
    room: `jarvis-${id}`,
  }
}

class JarvisSession {
  /** The session attempt in flight, or null when there is none. */
  #attempt = null
  /** Last reported phase, so callers can read the session state without events. */
  #phase = SESSION_PHASES.STOPPED
  /** Serialises work so two teardowns, or a teardown and a start, never interleave. */
  #queue = Promise.resolve()
  #listeners = new Set()

  /** Subscribe to session phases. Returns an unsubscribe function. */
  onPhase(listener) {
    if (typeof listener !== 'function') return () => {}
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** The phase of the session, e.g. `listening`. Never a LiveKit type. */
  getPhase() {
    return this.#phase
  }

  /** The session id assigned by the main process, echoed back in every report. */
  getSessionId() {
    return this.#attempt?.sessionId ?? null
  }

  /** True while a session is connecting, live, or tearing down. */
  isActive() {
    return this.#attempt !== null
  }

  isConnected() {
    return this.#attempt?.client?.isConnected() ?? false
  }

  /** The SDK connection state (`connected`, `reconnecting`, `disconnected`, ...). */
  getConnectionState() {
    return this.#attempt?.client?.getConnectionState() ?? 'disconnected'
  }

  /**
   * Mute or unmute the microphone mid-session. No-op without a live session, so
   * it can never open a capture the session did not ask for.
   */
  async setMicrophoneEnabled(enabled) {
    const client = this.#attempt?.client
    if (!client) return false
    return client.setMicrophoneEnabled(enabled)
  }

  /**
   * Start a session.
   *
   * Refused while a session is live or being established, which is what keeps the
   * shortcut from creating a second room, a second microphone track, a second
   * agent job and a second audio listener. Accepted while a previous session is
   * still tearing down: it runs immediately after that teardown.
   *
   * @param {{sessionId?: string}} [options]
   * @returns {Promise<boolean>} whether this call is the one that started a session.
   */
  connect(options = {}) {
    const current = this.#attempt
    if (current && !current.finishing) {
      jarvisWarn('A session is already live or starting; ignoring duplicate start.')
      return Promise.resolve(false)
    }

    const attempt = {
      sessionId: options.sessionId ?? null,
      finishing: false,
      cancelled: false,
      client: null,
      abortController: null,
    }
    this.#attempt = attempt

    return this.#run(async () => {
      // Stopped before this start even began: nothing to do.
      if (attempt.cancelled) return false
      await this.#start(attempt)
      return true
    }).catch((error) => {
      // #start handles its own failures; anything here is a defect, not a session error.
      jarvisError('Session start crashed', error)
      return false
    })
  }

  /**
   * Stop the session. Cancels a start in progress, otherwise tears down.
   * @returns {Promise<boolean>} whether there was anything to stop.
   */
  disconnect() {
    const attempt = this.#attempt
    if (!attempt || attempt.finishing) return Promise.resolve(false)

    jarvisLog('Session end requested')
    attempt.finishing = true
    attempt.cancelled = true
    attempt.abortController?.abort()

    return this.#run(() => this.#teardown(attempt))
      .then(() => true)
      .catch((error) => {
        jarvisError('Session teardown crashed', error)
        return true
      })
  }

  /**
   * Last-resort cleanup for the renderer going away. Synchronous, because
   * `pagehide` does not wait for promises: it drops every reference and lets the
   * client's teardown run detached, while the SDK's `disconnectOnPageLeave`
   * closes the connection itself.
   */
  dispose() {
    const attempt = this.#attempt
    this.#attempt = null
    if (!attempt) {
      jarvisLog('Session dispose() with no live session; nothing to do')
      return
    }

    jarvisLog(`Session dispose(): renderer is going away (session ${attempt.sessionId ?? 'unassigned'})`)
    attempt.cancelled = true
    attempt.abortController?.abort()
    const client = attempt.client
    attempt.client = null
    this.#listeners.clear()
    if (client) void client.disconnect()
  }

  /** Run one task at a time, in call order, and survive a failed predecessor. */
  #run(task) {
    const result = this.#queue.then(task, task)
    this.#queue = result.then(noop, noop)
    return result
  }

  #emitPhase(phase, detail) {
    this.#phase = phase
    for (const listener of this.#listeners) {
      try {
        listener(phase, detail)
      } catch {
        // A listener that throws must not interrupt the session teardown.
      }
    }
  }

  #handleEvent(attempt, event, payload) {
    // A late event from a session the user already ended must not touch anything.
    if (this.#attempt !== attempt || attempt.finishing) return

    if (event === SESSION_EVENTS.FAILURE) {
      this.#fail(attempt, payload ?? {})
      return
    }
    if (event === SESSION_EVENTS.AGENT_LEFT) {
      this.#fail(attempt, {
        code: SESSION_ERROR_CODES.AGENT_LEFT,
        message: 'The agent left the room.',
      })
      return
    }
    if (event === SESSION_EVENTS.DISCONNECTED) {
      // A room that closed while we were not tearing it down is a lost connection
      // — unless it never came up, in which case the connect attempt itself is
      // what failed and that is the more useful thing to report.
      if (payload?.intentional) return
      const everConnected = attempt.connected
      this.#fail(attempt, {
        code: everConnected ? SESSION_ERROR_CODES.CONNECTION_LOST : SESSION_ERROR_CODES.CONNECT_FAILED,
        message: everConnected
          ? 'The LiveKit connection was lost.'
          : 'Could not connect to LiveKit. Check the project URL and network.',
      })
      return
    }
    if (event === SESSION_EVENTS.CONNECTION_STATE) {
      // Logged in the client with the local participant; the phase is deliberately
      // left alone, so a transient `signalReconnecting` cannot move the island.
      return
    }
    if (event === SESSION_EVENTS.AGENT_AUDIO_SUBSCRIBED) {
      jarvisLog('Agent audio subscribed')
      return
    }
    if (event === SESSION_EVENTS.AGENT_AUDIO_PLAYBACK) {
      if (payload?.playing) jarvisLog('Agent speaking')
      return
    }

    const phase = phaseForEvent(event, payload)
    if (phase) this.#emitPhase(phase)
    if (event === SESSION_EVENTS.CONNECTED) attempt.connected = true
  }

  /**
   * The single failure path: report the error into the island, then tear down.
   * Every failure — bad configuration, unreachable backend, rejected token,
   * refused microphone, lost connection, agent gone — ends here, so there is
   * exactly one place that has to be correct about cleanup.
   */
  #fail(attempt, { code, message }) {
    jarvisError(`Session failed [${code ?? SESSION_ERROR_CODES.UNKNOWN}]`, message)

    this.#emitPhase(SESSION_PHASES.ERROR, { code, message })

    if (!attempt.finishing) {
      attempt.finishing = true
      attempt.cancelled = true
      jarvisLog(`Session cleanup: tearing down after failure [${code ?? SESSION_ERROR_CODES.UNKNOWN}]`)
      // Not awaited: this usually runs from inside the start sequence, and waiting
      // for a task queued behind the current one would deadlock. The teardown does
      // not report `stopped`, so the island stays in `error` and auto-dismisses.
      void this.#run(() => this.#teardown(attempt, { reportStopped: false }))
    }
  }

  async #start(attempt) {
    this.#emitPhase(SESSION_PHASES.STARTING)
    jarvisLog(`Starting LiveKit session (${describeLiveKitConfig()})`)

    let config
    try {
      config = readLiveKitConfig()
    } catch (error) {
      this.#fail(attempt, describeFailure(error, SESSION_ERROR_CODES.CONFIG_MISSING))
      return
    }

    const abortController = new AbortController()
    attempt.abortController = abortController

    try {
      const { identity, room } = createSessionIdentifiers()
      jarvisLog(`Session room ${room}, identity ${identity}`)

      // LiveKit's hosted development token server, via the SDK's TokenSource. No
      // JARVIS backend is involved: nothing of ours has to be running.
      const tokenSource = createTokenSource(config)
      const { token, url } = await requestAccessToken({
        tokenSource,
        identity,
        room,
        agentName: config.agentName,
        signal: abortController.signal,
      })
      if (attempt.cancelled) return

      this.#emitPhase(SESSION_PHASES.CONNECTING)
      jarvisLog('Connecting to LiveKit')

      const client = createLiveKitClient({
        onEvent: (event, payload) => this.#handleEvent(attempt, event, payload),
      })
      attempt.client = client
      await client.connect(url, token)

      if (attempt.cancelled) {
        await this.#teardown(attempt, { reportStopped: true })
        return
      }
      jarvisLog('Connected')

      // Publish the microphone last: the token is already scoped to this room and
      // session, and there is no reason to hold a capture device open before that.
      const microphoneEnabled = await client.setMicrophoneEnabled(true)
      if (attempt.cancelled) {
        await this.#teardown(attempt, { reportStopped: true })
        return
      }
      if (!microphoneEnabled) return // the failure event already reported it

      jarvisLog('Microphone enabled')
      // The microphone event normally set this; doing it here as well keeps the
      // phase correct even if that event was missed.
      this.#emitPhase(SESSION_PHASES.LISTENING)
      jarvisLog('Session live. Waiting for the agent.')
    } catch (error) {
      if (attempt.cancelled) return
      this.#fail(attempt, describeFailure(error, SESSION_ERROR_CODES.CONNECT_FAILED))
    }
  }

  /**
   * Release everything this session owns. Idempotent, and the order matters:
   * the microphone first, then any other local capture, then the remote audio
   * elements, then the room, then the references.
   */
  async #teardown(attempt, { reportStopped = true } = {}) {
    jarvisLog(`Session cleanup: starting (session ${attempt.sessionId ?? 'unassigned'})`)
    attempt.cancelled = true
    attempt.abortController?.abort()
    attempt.abortController = null

    if (reportStopped) {
      this.#emitPhase(SESSION_PHASES.STOPPING)
      jarvisLog('Disconnecting')
    }

    const client = attempt.client
    attempt.client = null
    if (this.#attempt === attempt) this.#attempt = null

    if (client) {
      await client.disconnect()
      jarvisLog('Session cleanup: LiveKit client disconnected')
    } else {
      jarvisLog('Session cleanup: nothing to disconnect.')
    }

    if (reportStopped) {
      this.#emitPhase(SESSION_PHASES.STOPPED)
      jarvisLog('Session disconnected')
    }
  }
}

/** The one session service instance the renderer uses. */
export const jarvisSession = new JarvisSession()
