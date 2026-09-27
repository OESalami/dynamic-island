import { get } from 'node:http'
import { DEV_SERVER_TIMEOUT_MS } from '../../shared/constants.js'

/**
 * Blocks until the Vite dev server answers, so Electron never tries to load the
 * renderer before it exists. Uses Node's built-in http module to avoid adding a
 * wait-for-server dependency.
 *
 * Development only: main.js loads this with a dynamic import guarded by
 * app.isPackaged, so it is never part of the production startup path.
 */
export function waitForDevServer(url, timeoutMs = DEV_SERVER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs

    const attempt = () => {
      const request = get(url, (response) => {
        response.resume()
        if (response.statusCode && response.statusCode < 500) {
          resolve()
          return
        }
        retry()
      })

      request.on('error', retry)
      request.setTimeout(1000, () => {
        request.destroy()
        retry()
      })
    }

    const retry = () => {
      if (Date.now() > deadline) {
        reject(
          new Error(
            `Dev server at ${url} did not respond within ${timeoutMs}ms. ` +
              'Is Vite running? ("npm run dev" starts both processes.)',
          ),
        )
        return
      }
      setTimeout(attempt, 250)
    }

    attempt()
  })
}
