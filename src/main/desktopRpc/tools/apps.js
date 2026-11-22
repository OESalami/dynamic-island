import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import { DesktopRpcError, RPC_APP_IDS, RPC_ERROR_CODES } from '../../../shared/desktopRpc.js'

/**
 * Application launching.
 *
 * The agent may choose an identifier from a fixed map. It can never supply an
 * executable path, a shell command, arguments or a URL. Executables are fixed
 * Windows system paths resolved from SystemRoot; launches use `shell: false`.
 * This is process creation of a known binary, not arbitrary shell execution.
 */

/** Fallback only used if SystemRoot is missing or malformed. */
const DEFAULT_SYSTEM_ROOT = 'C:\\Windows'

function systemRoot() {
  const value = process.env.SystemRoot
  return typeof value === 'string' && /^[A-Za-z]:\\Windows$/i.test(value)
    ? value
    : DEFAULT_SYSTEM_ROOT
}

/** Fixed launch definitions. Every entry is local, named and non-parameterised. */
const LAUNCHERS = Object.freeze({
  [RPC_APP_IDS.NOTEPAD]: {
    label: 'launch Notepad',
    executable: () => path.join(systemRoot(), 'System32', 'notepad.exe'),
  },
  [RPC_APP_IDS.FILE_EXPLORER]: {
    label: 'open File Explorer',
    executable: () => path.join(systemRoot(), 'explorer.exe'),
  },
  [RPC_APP_IDS.CALCULATOR]: {
    label: 'launch Calculator',
    /** UWP app: a registered Windows URI, opened through ShellExecute. */
    uri: 'ms-calculator:',
  },
})

/** Launch a fixed executable with no user-controlled arguments. */
function launchExecutable(executable) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(executable, [], {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
    } catch (error) {
      reject(error)
      return
    }

    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else {
        child.unref()
        resolve()
      }
    }
    child.once('spawn', () => finish())
    child.once('error', (error) => finish(error))
  })
}

export function createAppTools() {
  return {
    openApplication: {
      sensitive: true,
      label: 'launch an application',
      async run(args) {
        const { app } = args
        const launcher = LAUNCHERS[app]
        // The shared validator already restricts `app`; this is defence in depth.
        if (!launcher) {
          throw new DesktopRpcError(RPC_ERROR_CODES.APP_NOT_ALLOWED, 'Application is not allowed')
        }

        try {
          if (launcher.uri) {
            await shell.openExternal(launcher.uri)
          } else {
            const executable = launcher.executable()
            await access(executable)
            await launchExecutable(executable)
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          console.error(`[jarvis-rpc] launch ${app} failed: ${detail.slice(0, 160)}`)
          throw new DesktopRpcError(
            RPC_ERROR_CODES.ACTION_FAILED,
            `Could not ${launcher.label.replace(/^launch |^open /, '')}.`,
          )
        }

        return { app, launched: true }
      },
    },
  }
}
