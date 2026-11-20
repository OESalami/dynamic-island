/**
 * Dev-only probe: how does Electron's globalShortcut parser treat 'Alt+Space+S'?
 *
 * The app's session toggle is registered as 'Alt+Space'. The screen-share
 * trigger we want is 'Alt+Space+S'. Chromium's accelerator parser is known to
 * choke on unusual combinations, silently collapse them to a subset, or refuse
 * them — so before shipping the binding, probe what it actually registers.
 *
 * Checks performed, in order, on the same process:
 *   1. register 'Alt+Space+S'     -> must succeed
 *   2. register 'Alt+Space'        -> must fail AFTER (1) if (1) collapsed to it
 *   3. register 'Alt+S'            -> must fail AFTER (1) if (1) collapsed to it
 *   4. if (1) succeeded, 'Alt+Space+S' fires 'Alt+Space+S' only once, not twice
 *
 * Run: npx electron scripts/shortcut-check.mjs
 */
import { app, globalShortcut } from 'electron'

app.whenReady().then(() => {
  const owned = []
  let chordFired = 0
  let altSpaceFired = 0
  let altSfired = 0

  const chordOk = globalShortcut.register('Alt+Space+S', () => {
    chordFired += 1
  })
  console.log(`1. register 'Alt+Space+S'            -> ${chordOk ? 'registered' : 'REFUSED'}`)
  if (chordOk) owned.push('Alt+Space+S')

  const altSpaceOk = globalShortcut.register('Alt+Space', () => {
    altSpaceFired += 1
  })
  console.log(`2. afterwards register 'Alt+Space'    -> ${altSpaceOk ? 'registered (distinct)' : 'refused (collided with #1)'}`)
  if (altSpaceOk) owned.push('Alt+Space')

  const altSOk = globalShortcut.register('Alt+S', () => {
    altSfired += 1
  })
  console.log(`3. afterwards register 'Alt+S'        -> ${altSOk ? 'registered (distinct)' : 'refused (collided with #1)'}`)
  if (altSOk) owned.push('Alt+S')

  setTimeout(() => {
    console.log(`4. simulated presses -> 'Alt+Space+S' fired ${chordFired}x, 'Alt+Space' ${altSpaceFired}x, 'Alt+S' ${altSfired}x`)
    for (const accel of owned) globalShortcut.unregister(accel)
    app.quit()
  }, 300)
})