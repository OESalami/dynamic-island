import { app, screen } from 'electron'
import { DEV_SERVER_URL } from '../shared/constants.js'
import { registerIpcHandlers } from './ipc/index.js'
import { onDisplayChanged, requestState } from './island/islandController.js'
import { installMediaPermissions } from './session/mediaPermissions.js'
import { shutdownSession, toggleSession } from './session/sessionController.js'
import { ShortcutManager } from './shortcuts/globalShortcuts.js'
import {
  createIslandWindow,
  loadDevRenderer,
  loadProductionRenderer,
} from './windows/islandWindow.js'

// Must run before `ready`. Hardens every renderer in the process, so a window
// added later cannot accidentally opt out of the sandbox.
app.enableSandbox()

const shortcuts = new ShortcutManager({ devCycle: !app.isPackaged })

// A second instance would render a second island in the same spot. This must be
// requested before `ready`.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap() {
  app.on('second-instance', () => {
    // A second launch is the same gesture as the shortcut, not a request to
    // reveal the island: it starts the session if there is none, and stops the
    // one already running.
    toggleSession()
  })

  app.whenReady().then(async () => {
    createIslandWindow()
    registerIpcHandlers()
    installMediaPermissions()
    wireShortcuts()

    if (app.isPackaged) {
      loadProductionRenderer()
    } else {
      // Development only: block until Vite is actually serving. Imported
      // dynamically so it is never on the production startup path.
      const { waitForDevServer } = await import('./utils/devServer.js')
      await waitForDevServer(DEV_SERVER_URL)
      loadDevRenderer(DEV_SERVER_URL)
    }

    // Keep the island centred when displays are added, removed or rescaled.
    screen.on('display-metrics-changed', onDisplayChanged)
    screen.on('display-added', onDisplayChanged)
    screen.on('display-removed', onDisplayChanged)
  })

  // Windows-only app: with no window to show, there is nothing to keep alive.
  app.on('window-all-closed', () => {
    app.quit()
  })

  // Release the microphone if the app is on its way out with a session running.
  // The renderer may already be gone, in which case the OS reclaims the device
  // when the process exits; this only makes the attempt while it is still useful.
  app.on('before-quit', () => {
    shutdownSession()
  })
}

function wireShortcuts() {
  shortcuts.onTrigger('toggle', () => toggleSession())
  shortcuts.onTrigger('set-state', (state) => requestState(state))
  shortcuts.register()
}
