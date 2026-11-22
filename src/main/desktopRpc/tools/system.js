import os from 'node:os'
import { app, screen } from 'electron'
import { RPC_METHODS } from '../../../shared/desktopRpc.js'

/**
 * Read-only desktop information. Used by the agent to confirm that it is talking
 * to the right user's machine and that RPC is live during a session.
 *
 * Deliberately excludes the username, hostname, MAC address and full paths:
 * none of those are needed to drive the allowed tools.
 */
export function createSystemTools() {
  return {
    getInfo: {
      sensitive: false,
      async run(_args, context) {
        const displays = screen.getAllDisplays().map((display) => ({
          id: display.id,
          primary: display.id === screen.getPrimaryDisplay().id,
          width: display.bounds.width,
          height: display.bounds.height,
          scaleFactor: display.scaleFactor,
        }))

        return {
          platform: process.platform,
          arch: process.arch,
          osRelease: os.release(),
          appVersion: app.getVersion(),
          sessionId: context.sessionId,
          displays,
          capabilities: Object.values(RPC_METHODS),
        }
      },
    },
  }
}
