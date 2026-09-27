# JARVIS Dynamic Island

A system-level Dynamic Island overlay for a JARVIS desktop assistant. Windows-only, frameless, transparent, always-on-top.

This is the **visual layer only**. It owns the island window, the state machine and the animation, and it exposes a narrow IPC surface. It does not talk to a model, a microphone, or a network. A future JARVIS process drives it by writing states into the controller — no renderer changes required.

```
hidden -> idle -> listening -> processing -> responding -> idle
success | error  (transient, auto-dismiss back to idle)
```

---

## Requirements

| Tool | Version used |
| --- | --- |
| Node.js | `^20.19.0 \|\| >=22.12.0` (Vite 8's engine requirement) |
| npm | 9+ |
| OS | Windows 10/11 x64 (the main process uses Windows-specific window behaviour) |

Developed and verified against Node 24.12.0 / npm 9.9.4.

```bash
npm install
```

## Quick start

```bash
npm run dev      # Vite dev server + Electron with HMR
```

Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> to toggle the island. While unpackaged, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> cycles the island through every state in the model so the transitions and the IPC round-trip can be checked without JARVIS attached.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Runs Vite and Electron together (`concurrently`). Renderer hot-reloads. |
| `npm run dev:renderer` | Vite only, in a plain browser at `localhost:5173`. Mounts with a no-op bridge so the UI renders but nothing is wired to Electron. |
| `npm run build` | Vite production build of the renderer into `dist/renderer`. |
| `npm start` | `build`, then launches Electron against the built renderer over `file://`. |
| `npm run dist` | `build`, then `electron-builder --win` → NSIS installer in `release/`. |
| `npm run dist:dir` | Same, unpacked only (`release/win-unpacked/`). Fast iteration, no installer. |
| `npm run lint` | ESLint across main, preload, shared and renderer. |

## Project layout

```
src/
  main/                     Electron main process (native ESM, not bundled)
    main.js                 Bootstrap: sandbox, single-instance lock, ready, shortcuts
    ipc/index.js            Every renderer-facing IPC channel, sender-verified
    island/islandController.js   Authoritative state + window visibility
    windows/islandWindow.js      The single BrowserWindow; owns every window option
    shortcuts/globalShortcuts.js Global accelerator registration and fan-out
    utils/screen.js         Display/work-area maths
    utils/devServer.js      Dev-only: block until Vite answers
  preload/preload.js        contextBridge API — the only renderer/main seam
  shared/
    constants.js            IPC channel list, window geometry, timings, shortcuts
    islandStates.js         State model, transition table, labels
  renderer/                 React 19 + Framer Motion + Tailwind 4
    App.jsx                 Thin: state subscription + transparent backdrop
    components/dynamic-island/
      DynamicIsland.jsx     Presence + shape motion, hover/click-through
      IslandContent.jsx     Purely presentational per-state markup
      islandVariants.js     The motion language (easings, durations, geometry)
    hooks/useIslandState.js Mirrors main-owned state
    hooks/useMousePassthrough.js  Flips click-through on hover
    lib/bridge.js           The single access point to `window.jarvisIsland`
    styles/index.css        Transparent page, overlay hygiene
```

`shared/` is imported by both main and renderer. It is deliberately **not** imported by preload — a sandboxed preload cannot `require` local modules, so it receives the channel list through `webPreferences.additionalArguments` instead.

## Architecture

### Who owns state

The **main process is the authoritative owner** of island state. `islandController.js` validates every incoming transition against the table in `shared/islandStates.js`, rejects illegal ones, decides auto-dismiss, and broadcasts the result. The renderer is a pure mirror: it renders what it is told and sends change *requests*. It never commits state locally.

This is what lets an external JARVIS process drive the island by writing into the same controller, with no renderer changes.

### The window is a canvas, not a chrome

`islandWindow.js` owns every `BrowserWindow` option so no other file has to reason about window flags. The window is a fixed 560×120 transparent, non-resizable, click-through canvas pinned to the top centre of the primary display's **work area** (so it never lands under the taskbar). The visible pill is drawn entirely by React and CSS.

Because the canvas is larger than the pill, the island can expand inside it without a window resize — and everything in the window that is not the island stays click-through.

- `focusable: false` + `showInactive()` → the island never steals focus from your foreground app.
- `alwaysOnTop: true, 'screen-saver'` → stays above full-screen apps, not just normal ones.
- `hasShadow: false`, `roundedCorners: false` → transparent Windows windows cannot carry a native shadow and Win11 rounding leaves artifacts. The pill's shadow is pure CSS.

All geometry is in **device-independent pixels** (Electron's native unit for both `screen` and `setBounds`), so Windows display scaling needs no manual conversion and mixed-DPI multi-monitor setups stay aligned.

### Exit is a handshake

Hiding does not hide the window. `hide()` sets state to `hidden`; the renderer's `AnimatePresence` runs the exit animation; `onExitComplete` sends `island:animation-complete`; only then does main call `window.hide()`. Hiding on the request instead would cut the fade off mid-flight.

### Click-through

The window is set to `setIgnoreMouseEvents(true, { forward: true })`. `forward: true` keeps `mousemove` flowing to the renderer even while clicks pass through, which is what lets `useMousePassthrough` detect hover on the island and flip click-through off only while the pointer is actually over it.

### Renderer never touches Electron

`src/renderer/lib/bridge.js` is the single access point. It reads `window.jarvisIsland` once and falls back to a no-op implementation, so the UI still mounts in a plain browser under `npm run dev:renderer` instead of throwing on a missing bridge.

## Security posture

| Control | Setting |
| --- | --- |
| `app.enableSandbox()` | Called before `ready`, so a window added later cannot opt out. |
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `sandbox` | `true` |
| `webSecurity` | `true` |
| CSP | Declared as a `<meta>` tag in `index.html` — production loads over `file://`, where a header cannot be set. |
| Bridge surface | One global, `window.jarvisIsland`, with a fixed set of functions. `Node`, `process`, `fs`, `shell` and raw `ipcRenderer` are never exposed. |
| Event forwarding | `subscribe()` passes only the payload to callbacks, never the `IpcRendererEvent` (which would hand back the `sender`). |
| IPC channels | Explicitly named in `shared/constants.js`. There are intentionally no generic `execute` / `command` / `eval` channels. |
| Sender validation | Every handler checks `event.sender === window.webContents` before acting — any frame can in principle send IPC, including devtools and iframes. |
| Single instance | `requestSingleInstanceLock()` before `ready`; a second instance would render a second island in the same spot. A second launch toggles the existing one instead. |

`style-src` needs `'unsafe-inline'` because Framer Motion writes inline style attributes. `connect-src` allows the Vite HMR websocket in development.

## Global shortcuts

| Accelerator | Action | Availability |
| --- | --- | --- |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> | Toggle island visibility | Always |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> | Advance one step through the state model | Unpackaged only |

`globalShortcut.register` fails silently when another app already owns a combination, so the manager logs a warning when registration is refused.

## IPC surface

| Channel | Direction | Payload |
| --- | --- | --- |
| `island:show` | renderer → main | — |
| `island:hide` | renderer → main | — |
| `island:toggle` | renderer → main | — |
| `island:set-state` | renderer → main | state string, validated in main |
| `island:get-state` | renderer → main (invoke) | returns the authoritative state |
| `island:animation-complete` | renderer → main | — |
| `island:set-mouse-interactive` | renderer → main | boolean |
| `island:state-change` | main → renderer | state string |
| `island:visibility-change` | main → renderer | boolean |

## Configuration

All tuning lives in `src/shared/constants.js` and `src/shared/islandStates.js`.

| Constant | Default | Meaning |
| --- | --- | --- |
| `ISLAND_SIZE.WIDTH` / `HEIGHT` | 560 × 120 | Transparent canvas size. Must exceed the widest expanded shape. |
| `ISLAND_SIZE.TOP_OFFSET` | 8 | Gap between the top of the work area and the top of the canvas. |
| `AUTO_HIDE_MS` | 4000 | Delay before `success` / `error` auto-dismiss. |
| `ACCELERATOR` | `Ctrl+Alt+Space` | Toggle binding. |
| `DEV_STATE_CYCLE` | 7 states | The sequence the dev shortcut walks. |
| `islandShape` | 128×40 pill / 260×56 card | Geometry per shape, in `islandVariants.js`. |
| `DURATION` | shape 0.34s, content 0.16s, presence 0.26s | The motion language. |

## Build output

`npm run dist` produces, in `release/`:

| Artifact | Notes |
| --- | --- |
| `JARVIS Dynamic Island Setup 0.1.0.exe` | NSIS installer, x64, ~107 MB. Per-user, wizard-style (`oneClick: false`) with a directory picker. |
| `JARVIS Dynamic Island Setup 0.1.0.exe.blockmap` | For delta updates. |
| `win-unpacked/` | The unpacked app, for `dist:dir` iteration. |

The main process is **not** bundled — Electron runs `src/main` as native ESM straight from the asar. Only the renderer is built by Vite. The `build.files` globs in `package.json` are what put `src/main`, `src/preload`, `src/shared` and `dist/renderer` into `app.asar`.

### Verified build

Confirmed on Windows 11 x64 with Electron 44.4.5 and electron-builder 26.15.3:

- `vite build` → `dist/renderer/index.html` + `assets/index-*.css` (10.7 kB) + `assets/index-*.js` (352 kB, 111 kB gzipped), in ~2.2s.
- Packaging, asar integrity patching, NSIS target, uninstaller and block map all completed.
- Installer metadata is correct: `ProductName` = `JARVIS Dynamic Island`, `FileVersion` = `0.1.0`, description matches `package.json`.
- `app.asar` (16.6 MB) contains `dist/renderer/**`, all of `src/main/**`, `src/preload/**`, `src/shared/**` and `package.json`.
- `npm run lint` is clean.

Three non-fatal warnings are emitted at build time:

1. **`author is missed in the package.json`** — add an `author` field to silence it.
2. **`default Electron icon is used`** — no app icon is set. Drop a 256×256 `build/icon.ico` in place to fix it.
3. **`duplicate dependency references: react-dom@19.3.0`** — cosmetic, but it means `node_modules` is copied into the asar even though Vite already bundles React into the renderer bundle. Moving `react`, `react-dom` and `framer-motion` to `devDependencies` would cut ~15 MB off the installer.

The installer is **not code-signed** (`Status: NotSigned`), so Windows SmartScreen will warn on first run.

## Known limitations

These are deliberate seams, each documented at its implementation site:

- **Modifier-only trigger is not possible.** The intended binding is a bare `Ctrl+Alt`, but Chromium's accelerator parser rejects any combination with no non-modifier key. A modifier-only trigger on Windows needs a low-level keyboard hook (`SetWindowsHookEx` / `WH_KEYBOARD_LL`), i.e. a native dependency. `ShortcutManager` is the seam: write a class with the same three methods and swap it in `main.js` — nothing else changes.
- **No click-away dismissal.** The window is `focusable: false`, so the OS never fires `blur` for it. Auto-dismiss is therefore time-based. To get real click-away dismissal, flip `focusable` to `true` in `islandWindow.js` (keep `showInactive()`, which still avoids stealing focus) and hide on `blur`.
- **Primary display only.** `screen.js` already exposes `getWorkAreaAtPoint` / `getIslandBoundsAtPoint` so the island can follow the cursor or the active window once multi-monitor support lands, without changing the positioning contract.
- **Placeholder content.** `IslandContent` renders the state label only. There is no waveform, transcript, or tool output yet.
- **No tests.** Verification is manual via the dev state-cycle shortcut and the lint/build commands above.

## License

Private. All rights reserved.
