import { useEffect } from 'react'
import { jarvisSession, onLog } from '../livekit/index.js'
import { bridge } from '../lib/bridge.js'

/**
 * Connects the voice session service to the Electron bridge.
 *
 * Two directions, and nothing else:
 *
 *   main -> renderer  a session command. The main process decides when a session
 *                     starts and stops; the renderer never starts one on its own,
 *                     so a session cannot exist without the shortcut.
 *   renderer -> main  session phases, which the main process maps onto island
 *                     state. The island is therefore still driven by the existing
 *                     state machine, and the renderer commits nothing.
 *
 * Log lines are forwarded to the main console for the same reason: the island
 * window is `focusable: false`, so its devtools cannot be opened by hand and the
 * `[JARVIS]` diagnostics would otherwise be unreachable during normal use.
 *
 * The hook owns no state and renders nothing — the island UI is driven entirely by
 * the state it is already given.
 *
 * -------------------------------------------------------------------
 * The cleanup below unsubscribes. It never ends a session.
 * -------------------------------------------------------------------
 *
 * `jarvisSession` is a module-level singleton and the `Room` lives inside it, so
 * neither is owned by this component or by `App`. An unmount, a remount, a Fast
 * Refresh, an island show/hide or an island state change only ever detach and
 * re-attach these four listeners; the LiveKit connection is untouched and
 * survives all of them.
 *
 * The consequence worth being explicit about: this is what makes the hook safe
 * under `<StrictMode>`, which mounts, unmounts and remounts every effect in
 * development. The LiveKit room is deliberately *not* in the effect's lifetime,
 * so the double-invoke cannot produce two rooms, two microphone tracks or two
 * agent jobs — that protection comes from the session service's single-session
 * invariant, not from this component.
 *
 * The one lifecycle event that does end the session is `pagehide`, and only
 * because at that point the renderer document is genuinely being torn down —
 * there would be nothing left to answer a reconnect. The window is never
 * focused, so `blur` is not available as a signal and is not used.
 */
export function useJarvisSession() {
  useEffect(() => {
    const unsubscribePhase = jarvisSession.onPhase((phase, detail) => {
      bridge.sendSessionStatus(phase, {
        sessionId: jarvisSession.getSessionId(),
        code: detail?.code,
        message: detail?.message,
      })
    })

    const unsubscribeLog = onLog((level, line) => {
      bridge.writeLog(level, line)
    })

    const unsubscribeCommand = bridge.onSessionCommand((command) => {
      if (command?.command === 'start') {
        void jarvisSession.connect({ sessionId: command.sessionId })
      } else if (command?.command === 'stop') {
        void jarvisSession.disconnect()
      }
    })

    // The window is never focused, so `blur` is not the signal for teardown; the
    // page going away is. `dispose` is synchronous and idempotent.
    const onPageHide = () => jarvisSession.dispose()
    window.addEventListener('pagehide', onPageHide)

    return () => {
      // Unsubscribes only. No session, no room and no microphone is touched here:
      // the island's visual lifetime must not own the LiveKit connection's.
      unsubscribePhase()
      unsubscribeLog()
      unsubscribeCommand()
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])
}
