import { app, screen } from 'electron'
import { DEV_SERVER_URL } from '../shared/constants.js'
import { registerIpcHandlers } from './ipc/index.js'
import { onDisplayChanged, requestState, toggle } from './island/islandController.js'
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
    toggle()
  })

  app.whenReady().then(async () => {
    createIslandWindow()
    registerIpcHandlers()
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
}

function wireShortcuts() {
  shortcuts.onTrigger('toggle', () => toggle())
  shortcuts.onTrigger('set-state', (state) => requestState(state))
  shortcuts.register()
}
