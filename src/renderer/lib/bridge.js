/**
 * Access to the preload bridge.
 *
 * React components never touch `window.jarvisIsland` directly; they go through
 * here. The fallback object means the renderer still mounts when opened in a
 * plain browser via `npm run dev:renderer`, instead of throwing on a missing
 * bridge. The fallback does nothing, so the island simply stays in its initial
 * state.
 */
import { RPC_ERROR_CODES, serializeRpcError } from '../../shared/desktopRpc.js'

const noop = () => {}
const noopUnsubscribe = () => {}

const fallback = {
  show: noop,
  hide: noop,
  toggle: noop,
  setState: noop,
  getState: async () => null,
  onStateChange: () => noopUnsubscribe,
  onVisibilityChange: () => noopUnsubscribe,
  notifyAnimationComplete: noop,
  setMouseInteractive: noop,
  onSessionCommand: () => noopUnsubscribe,
  onShareCommand: () => noopUnsubscribe,
  notifyRendererReady: noop,
  sendSessionStatus: noop,
  writeLog: noop,
  // A bare browser has no trusted main process. Return a structured failure so
  // the RPC handler can report "session inactive" rather than crash the UI.
  invokeDesktopRpc: async () =>
    serializeRpcError(RPC_ERROR_CODES.SESSION_INACTIVE, 'Electron bridge is unavailable.'),
}

export const bridge = globalThis.window?.jarvisIsland ?? fallback

/** True when running inside the Electron shell rather than a bare browser. */
export const hasBridge = globalThis.window?.jarvisIsland !== undefined
