import { app } from 'electron'
import { getState } from './src/main/island/islandController.js'
import { registerIpcHandlers } from './src/main/ipc/index.js'
import { installMediaPermissions } from './src/main/session/mediaPermissions.js'
import { startSession, stopSession, toggleSession } from './src/main/session/sessionController.js'
import {
  createIslandWindow,
  getIslandWindow,
  loadProductionRenderer,
} from './src/main/windows/islandWindow.js'

/**
 * TEMPORARY verification harness. Not part of the app.
 *
 * Runs the real main-process modules against the real production renderer and
 * the real LiveKit development token server, so a full session can be observed
 * end to end: token -> connect -> dispatch -> microphone -> agent audio.
 */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const SESSION_SECONDS = Number(process.env.HARNESS_SESSION_SECONDS ?? 25)

app.whenReady().then(run)

async function run() {
  const window = createIslandWindow()
  registerIpcHandlers()
  installMediaPermissions()

  window.webContents.on('console-message', (event) => {
    console.log(`[renderer:${event.level}] ${event.message ?? ''}`)
  })

  await loadProductionRenderer()
  await wait(1500)
  console.log('[harness] initial island state =', getState())

  console.log('[harness] --- toggleSession() (start) ---', toggleSession())
  for (let i = 0; i < SESSION_SECONDS; i += 1) {
    await wait(1000)
    console.log(`[harness] t+${i + 1}s island state = ${getState()}`)
  }

  console.log('[harness] --- toggleSession() (stop) ---', toggleSession())
  await wait(3000)
  console.log('[harness] after stop, island state =', getState())
  console.log('[harness] window visible =', getIslandWindow()?.isVisible())
  console.log('[harness] done')
  app.quit()
}
