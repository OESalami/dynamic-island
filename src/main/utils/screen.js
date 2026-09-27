import { screen } from 'electron'
import { ISLAND_SIZE } from '../../shared/constants.js'

/**
 * Display / positioning helpers for the island overlay.
 *
 * All values here are Electron's device-independent pixels (DIP). `screen` returns
 * DIP and `BrowserWindow.setBounds` consumes DIP, so Windows display scaling
 * (125%, 150%, ...) needs no manual conversion. Using DIP consistently is what
 * keeps the island aligned on mixed-DPI multi-monitor setups later.
 */

/** Work area of the primary display, falling back to full bounds if unavailable. */
export function getPrimaryWorkArea() {
  const display = screen.getPrimaryDisplay()
  return display.workArea ?? display.bounds
}

/**
 * Rect for the island's transparent canvas, horizontally centred and offset
 * slightly down from the top of the display's work area.
 *
 * `workArea` is used rather than `bounds` so the island never ends up underneath
 * the Windows taskbar.
 */
export function getPrimaryIslandBounds() {
  const { x, y, width } = getPrimaryWorkArea()

  return {
    x: Math.round(x + (width - ISLAND_SIZE.WIDTH) / 2),
    y: Math.round(y + ISLAND_SIZE.TOP_OFFSET),
    width: ISLAND_SIZE.WIDTH,
    height: ISLAND_SIZE.HEIGHT,
  }
}

/**
 * Work area of whichever display contains `point`. Exists so the island can
 * follow the cursor or the active window once multi-monitor support lands,
 * without changing the positioning contract.
 */
export function getWorkAreaAtPoint(point) {
  const display = screen.getDisplayNearestPoint(point)
  return display.workArea ?? display.bounds
}

/**
 * Rect for the island canvas on the display containing `point`.
 * Same layout maths as getPrimaryIslandBounds, different display.
 */
export function getIslandBoundsAtPoint(point) {
  const { x, y, width } = getWorkAreaAtPoint(point)

  return {
    x: Math.round(x + (width - ISLAND_SIZE.WIDTH) / 2),
    y: Math.round(y + ISLAND_SIZE.TOP_OFFSET),
    width: ISLAND_SIZE.WIDTH,
    height: ISLAND_SIZE.HEIGHT,
  }
}

/**
 * Re-centre an existing window, e.g. after a display is unplugged or the work
 * area changes. Returns the new bounds so callers can decide whether to apply.
 */
export function getCurrentIslandBounds() {
  return getPrimaryIslandBounds()
}
