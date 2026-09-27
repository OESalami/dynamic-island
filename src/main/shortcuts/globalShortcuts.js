import { globalShortcut } from 'electron'
import { ACCELERATOR, DEV_ACCELERATOR, DEV_STATE_CYCLE } from '../../shared/constants.js'

/**
 * Owns global shortcut registration and trigger fan-out.
 *
 * The rest of the app only calls `onTrigger(cb)` and never learns how the
 * combination is detected, which is what keeps the shortcut mechanism
 * replaceable. See ACCELERATOR in shared/constants.js for why the intended
 * binding is `Ctrl+Alt+Space` and not a bare `Ctrl+Alt`.
 *
 * Replacing this implementation with a modifier-only Windows keyboard hook
 * (`SetWindowsHookEx` / `WH_KEYBOARD_LL`, usually via a native module) means
 * writing a new class with the same three methods and swapping it in main.js.
 * Nothing else in the codebase would change.
 */
export class ShortcutManager {
  #accelerator
  #listeners = new Set()
  #devCycleEnabled
  #devCycleIndex = 0

  constructor({ accelerator = ACCELERATOR, devCycle = false } = {}) {
    this.#accelerator = accelerator
    this.#devCycleEnabled = devCycle
  }

  /**
   * Register the shortcut. Returns false if the OS refused it, which happens
   * silently whenever another app already owns the combination.
   */
  register() {
    const ok = globalShortcut.register(this.#accelerator, () => {
      this.#emit('toggle')
    })

    if (!ok) {
      console.warn(
        `[jarvis-island] could not register ${this.#accelerator} — another application likely already owns it.`,
      )
      return false
    }

    if (this.#devCycleEnabled) {
      const okDev = globalShortcut.register(DEV_ACCELERATOR, () => {
        this.#devCycleIndex = (this.#devCycleIndex + 1) % DEV_STATE_CYCLE.length
        this.#emit('set-state', DEV_STATE_CYCLE[this.#devCycleIndex])
      })
      if (!okDev) {
        console.warn(`[jarvis-island] could not register dev shortcut ${DEV_ACCELERATOR}.`)
      }
    }

    return true
  }

  unregister() {
    globalShortcut.unregisterAll()
    this.#listeners.clear()
  }

  /**
   * Subscribe to triggers.
   * @param {'toggle'|'set-state'} type
   * @param {(payload?: string) => void} callback
   * @returns {() => void} unsubscribe
   */
  onTrigger(type, callback) {
    const entry = { type, callback }
    this.#listeners.add(entry)
    return () => this.#listeners.delete(entry)
  }

  #emit(type, payload) {
    for (const { type: wanted, callback } of this.#listeners) {
      if (wanted === type) callback(payload)
    }
  }
}
