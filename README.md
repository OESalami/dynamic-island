# JARVIS Dynamic Island

A system-level Dynamic Island overlay for a JARVIS desktop assistant. Windows-only, frameless, transparent, always-on-top.

It owns the island window, the state machine and the animation, and it exposes a narrow IPC surface. It has two inputs: a voice session against a **deployed LiveKit agent** (see [LiveKit Integration](#livekit-integration)), and a future JARVIS process driving it by writing states into the controller — no renderer changes required either way. The agent, the model, and the LiveKit API credentials are not in this repository.

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

Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> to start a voice session, and press it again to stop it. While unpackaged, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> cycles the island through every state in the model so the transitions and the IPC round-trip can be checked without a session running.

The island can still be shown and hidden on its own (click it while a session is not running) — the accelerator is bound to the session because that is the more useful binding when a session exists.

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
    session/sessionController.js Session lifecycle: which phase, which island state
    session/mediaPermissions.js  Grants `media` and nothing else
    windows/islandWindow.js      The single BrowserWindow; owns every window option
    shortcuts/globalShortcuts.js Global accelerator registration and fan-out
    utils/screen.js         Display/work-area maths
    utils/devServer.js      Dev-only: block until Vite answers
  preload/preload.js        contextBridge API — the only renderer/main seam
  shared/
    constants.js            IPC channel list, window geometry, timings, shortcuts
    islandStates.js         State model, transition table, labels
    sessionPhases.js        Voice-session phase vocabulary (not island states)
  renderer/                 React 19 + Framer Motion + Tailwind 4
    App.jsx                 Thin: state subscription + transparent backdrop
    components/dynamic-island/
      DynamicIsland.jsx     Presence + shape motion, hover/click-through
      IslandContent.jsx     Purely presentational per-state markup
      islandVariants.js     The motion language (easings, durations, geometry)
    hooks/useIslandState.js Mirrors main-owned state
    hooks/useJarvisSession.js  Wires session commands, phases and logs over IPC
    hooks/useMousePassthrough.js  Flips click-through on hover
    lib/bridge.js           The single access point to `window.jarvisIsland`
    livekit/                The only code that knows LiveKit exists
      livekitSession.js     Session orchestrator: queue, cancellation, teardown
      livekitClient.js      The only `livekit-client` import; owns the Room
      livekitToken.js       Backend token request
      livekitEvents.js      SDK events -> session phases and error codes
      livekitConfig.js      Reads and validates the three env vars
      livekitLogger.js      `[JARVIS]` lines, with tokens redacted
    styles/index.css        Transparent page, overlay hygiene
```

`shared/` is imported by both main and renderer. It is deliberately **not** imported by preload — a sandboxed preload cannot `require` local modules, so it receives the channel list through `webPreferences.additionalArguments` instead.

## Architecture

### Who owns state

The **main process is the authoritative owner** of island state. `islandController.js` validates every incoming transition against the table in `shared/islandStates.js`, rejects illegal ones, decides auto-dismiss, and broadcasts the result. The renderer is a pure mirror: it renders what it is told and sends change *requests*. It never commits state locally.

This is what lets an external JARVIS process drive the island by writing into the same controller, with no renderer changes.

### A session is not an island state

A voice session is split across the process boundary, because neither process can do the other's job:

| | Main process | Renderer |
| --- | --- | --- |
| Owns | Whether a session exists, the island, the window | The `Room`, the microphone, the audio elements |
| Can do | Decide, sequence, refuse | `getUserMedia`, WebRTC, `track.attach()` |

`session/sessionController.js` is the main half: the accelerator asks it to `toggleSession()`, it shows the island, and it tells the renderer to start or stop. The renderer reports progress as a **phase** — a transport fact ("we are asking for a token") — and main maps phases onto island states. That mapping exists in exactly one place:

| Session phase | Island state | Shown as |
| --- | --- | --- |
| `starting`, `connecting` | `idle` | Collapsed "connecting" pill |
| `listening` | `listening` | Expanded, mic live |
| `thinking` | `processing` | Agent working |
| `speaking` | `responding` | Agent audio playing |
| `error` | `error` | Collapsed, auto-dismiss |
| `stopped` | *(nothing)* | The caller already dismissed it |

`starting` maps to `idle` on purpose: the island must be visible immediately, but it must not claim the microphone is live before it is. The expanded card only appears when audio is actually being captured.

Two guards keep this honest:

- **One session at a time.** A second press while a session exists stops it rather than starting a second room. A second app instance asks for the same toggle.
- **Late reports are dropped.** Every session gets an id; a report carrying a stale id is refused, so a teardown that finishes after the user has already started a new session cannot move the new session's island. `error` is terminal for the session even though it is not terminal for the island, which is what makes restarting after a failure work.

There is no agent-state API in the LiveKit client, so "who is talking" comes from `ActiveSpeakersChanged`: the local participant speaking means `thinking`, a remote participant speaking means `responding`, and silence returns to `listening`. A session therefore cycles `listening ↔ thinking ↔ responding` for as long as the agent is connected.

### LiveKit Integration

The app connects to a **deployed LiveKit agent** named `my-agent`. It holds no LiveKit API credentials; the renderer asks a backend for a short-lived join token instead. The agent, its model, and its token service live outside this repository.

#### Configuration

Three `VITE_` variables, all read at build time from `.env` (see `.env.example`):

| Variable | Example | Meaning |
| --- | --- | --- |
| `VITE_LIVEKIT_URL` | `wss://my-project.livekit.cloud` | LiveKit server URL |
| `VITE_LIVEKIT_AGENT_NAME` | `my-agent` | Agent to talk to |
| `VITE_LIVEKIT_TOKEN_ENDPOINT` | `https://api.example.com/livekit-token` | Backend that mints join tokens |

`VITE_` variables are compiled into the renderer bundle, so they are public. **Never** put `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` in one — the build fails on purpose if a `VITE_*` name looks like a credential. If a variable is missing, the app still builds and runs; a session reports `config-missing` instead of failing silently.

#### Token request contract

This is the one interface the desktop app requires from a backend. It is implemented in `src/renderer/livekit/livekitToken.js`.

**Request** — `POST` to `VITE_LIVEKIT_TOKEN_ENDPOINT`:

```json
{
  "identity": "jarvis-desktop-3f1c…",   // unique per session, client-generated
  "room": "jarvis-3f1c…",               // unique per session, client-generated
  "agentName": "my-agent"               // VITE_LIVEKIT_AGENT_NAME
}
```

**Response** — `200 application/json`:

```json
{ "token": "<short-lived JWT>", "url": "wss://my-project.livekit.cloud" }
```

| Field | Also accepted as | Notes |
| --- | --- | --- |
| `token` | `participant_token` | The join token. Never logged. |
| `url` | `server_url` | Server URL from the server, overriding the build-time one. |

Anything else — a non-2xx status, a body that is not JSON, a missing field, or no response within **15 s** — becomes `token-unavailable`, `token-rejected` or `token-invalid`, and the island shows the error state. The session is abandoned, never retried in a loop: the user presses the shortcut again.

The desktop app sends no credentials. Whoever can reach the token endpoint can mint a token, so that endpoint is yours to protect (mTLS, an app token, or origin restrictions).

#### What the backend must do

Not in this repository. It needs `livekit-server-sdk` (currently `2.19.1`) and must:

1. **Mint a token** with `AccessToken` for the identity and room it was given, signed with your API key and secret, with `roomJoin`, `canPublish` and `canSubscribe` granted. Keep the TTL short (minutes) — the token is a bearer credential.
2. **Dispatch the agent.** There is no "call this agent" client API: dispatch is a server-side action. Either create an explicit dispatch per room —
   `LiveKitAPI.agentDispatch.createDispatch(room, 'my-agent')` — or attach the agent to the room in the token via `roomConfig: { agents: [{ agentName: 'my-agent' }] }` for automatic dispatch. Explicit dispatch is the better fit here: the user pressed a key, so the room should come up on demand and not linger.
3. **Not trust the client's identity blindly.** The desktop generates a random identity per session and the backend mints whatever it is given, which is correct for a single-user desktop app. If the endpoint is ever reachable by others, issue the identity server-side and ignore the request body.

#### Session flow

```
shortcut → main: show island (idle), send `start` to renderer
renderer: read config → generate identity + room → POST token
        → Room.connect() → enable microphone → `listening`
        → agent joins → active-speaker events → listening/thinking/responding
shortcut → main: hide island, send `stop`
renderer: unpublish + stop mic tracks → disconnect room → release audio elements
failure  → renderer: report one code → teardown → island `error`, auto-dismiss
```

The renderer queues rather than overlaps: a stop issued mid-connect is applied as soon as the in-flight step finishes, and a start issued mid-teardown runs after it. Only one session object exists at a time, and `disconnectOnPageLeave` plus the `pagehide` handler mean closing or reloading the window tears the room down rather than leaving an orphaned session.

#### Microphone and audio

The microphone is enabled **only** while a session is running and is released by unpublishing the track (`stopLocalTrackOnUnpublish`), which is what actually returns the device to the OS. There is no background capture, no always-on mic, and no recording.

Agent audio has no player in the UI: the SDK's `track.attach()` element is played immediately, `room.startAudio()` is the fallback if a platform ever refuses, and every element is paused, detached and removed on unsubscribe or teardown. The window is created with `autoplayPolicy: 'no-user-gesture-required'` because it is a `focusable: false` overlay and there is no gesture to play against.

#### Failure modes

| Code | Cause |
| --- | --- |
| `config-missing` | A `VITE_` variable is unset or malformed |
| `token-unavailable` / `token-rejected` / `token-invalid` | Endpoint unreachable, non-2xx, or unusable body |
| `connect-failed` / `connection-lost` | LiveKit unreachable, or the room dropped |
| `microphone-denied` / `microphone-unavailable` / `microphone-failed` | Permission refused, no device, or capture failed |
| `audio-playback-blocked` | Attached element refused to play |
| `audio-subscription-failed` | The agent's audio track could not be subscribed |
| `agent-left` | The agent disconnected mid-session |

All of them end in the same place: one code, one message, a teardown, and the island's `error` state. Errors are logged to the main-process console with the code and a redacted message.

#### What is deliberately absent

No screen sharing, no camera, no chat or text channel, no transcripts, no push-to-talk mode, no session history. The bridge exposes no API for any of them, and the island UI was not redesigned to host them.

#### Verification status

| Check | Result |
| --- | --- |
| Token request over HTTP, body and response contract | Verified against a local fake endpoint |
| `content-security-policy` grants exactly the configured origins | Verified in the built `index.html` |
| Microphone capture over `file://` with the app's own window flags | Verified — a real device track was obtained |
| Single-session rule, toggle, stop, error state, restart after failure | Verified against the real main process and the built renderer |
| **LiveKit room, `my-agent` dispatch, agent audio on Windows** | **Not verified — needs a real project URL, a real token endpoint and credentials** |

The last row is the honest gap: everything up to the WebRTC handshake is exercised, and the handshake itself has never run against a live LiveKit deployment from this machine.

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
| CSP | Declared as a `<meta>` tag in `index.html` — production loads over `file://`, where a header cannot be set. The LiveKit origins are injected into `connect-src` at build time (see below). |
| Media permission | `session/mediaPermissions.js` grants Electron's `media` permission — the microphone — and refuses everything else. There is deliberately no `display-media` handler, so screen capture cannot be granted even if something asks. |
| Autoplay | `autoplayPolicy: 'no-user-gesture-required'`, required for agent audio in a `focusable: false` overlay. |
| Access tokens | The renderer receives a short-lived join token and nothing else. API keys and secrets stay on the backend; a `VITE_*` name that looks like a credential fails the build. Tokens are redacted in every log line, and the SDK's own logger is reduced to warnings because it prints the signalling URL — which carries the token as a query parameter. |
| Bridge surface | One global, `window.jarvisIsland`, with a fixed set of functions. `Node`, `process`, `fs`, `shell` and raw `ipcRenderer` are never exposed. |
| Event forwarding | `subscribe()` passes only the payload to callbacks, never the `IpcRendererEvent` (which would hand back the `sender`). |
| IPC channels | Explicitly named in `shared/constants.js`. There are intentionally no generic `execute` / `command` / `eval` channels. |
| Sender validation | Every handler checks `event.sender === window.webContents` before acting — any frame can in principle send IPC, including devtools and iframes. |
| Single instance | `requestSingleInstanceLock()` before `ready`; a second instance would render a second island in the same spot. A second launch toggles the existing one instead. |

`style-src` needs `'unsafe-inline'` because Framer Motion writes inline style attributes. `connect-src` allows the Vite HMR websocket in development.

`connect-src` also has to name the LiveKit and token origins, and they differ per environment — so they are not hardcoded and are not widened to `https:`. The `jarvis-livekit-csp` plugin in `vite.config.js` reads only the two configured URLs and injects their origins at build time, for the same policy in development and production. A LiveKit URL contributes **two** origins: the SDK opens a `wss://` signalling socket *and* validates the token with an HTTPS request to the same host first. `media-src` is present so the SDK can attach the agent's audio element. Unconfigured, the placeholder resolves to nothing and the rest of the policy still applies.

## Global shortcuts

| Accelerator | Action | Availability |
| --- | --- | --- |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> | Start a voice session, or stop the running one | Always |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> | Advance one step through the state model | Unpackaged only |

`globalShortcut.register` fails silently when another app already owns a combination, so the manager logs a warning when registration is refused. A second launch of the app routes the same accelerator to the running instance, so the shortcut cannot start two sessions.

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
| `island:session-command` | main → renderer | `start` / `stop` + session id |
| `island:session-status` | renderer → main | phase, session id, optional error code and message |
| `island:log` | renderer → main | one `[JARVIS]` line, redacted |

## Configuration

All tuning lives in `src/shared/constants.js` and `src/shared/islandStates.js`. The three `VITE_LIVEKIT_*` variables are the only environment configuration, documented in [LiveKit Integration](#livekit-integration).

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

- `vite build` → `dist/renderer/index.html` + `assets/index-*.css` (10.8 kB) + `assets/index-*.js` (884 kB, 250 kB gzipped), in ~4s. The renderer bundle grew from 352 kB when `livekit-client` was added; it is the SDK, and it is loaded eagerly because a voice session has to start on a keypress.
- Packaging, asar integrity patching, NSIS target, uninstaller and block map all completed — **measured before the LiveKit integration**, so the installer and `app.asar` sizes in the table above are the pre-integration figures and will be larger now.
- Installer metadata is correct: `ProductName` = `JARVIS Dynamic Island`, `FileVersion` = `0.1.0`, description matches `package.json`.
- `npm run lint` is clean.
- The built `index.html` was inspected directly: `connect-src` contains only `'self'`, `ws:`, `wss:` and the configured LiveKit/token origins. No credential-shaped strings appear in the bundle.

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
- **Placeholder content.** `IslandContent` renders the state label only. There is no waveform, transcript, or tool output yet. Session phases map onto the existing states precisely so the UI could grow here without touching the state model.
- **Agent state is inferred, not reported.** The LiveKit client has no agent-state API, so `thinking` and `responding` come from active-speaker detection. A server without active-speaker support leaves the island on `listening`.
- **A room is created per session.** Pressing the shortcut twice joins two different rooms, so an agent that is already in the first room is not in the second. Explicit dispatch makes that correct; automatic dispatch with a sticky agent would need a stable room name.
- **No automated tests.** Verification was manual: the dev state-cycle shortcut, a temporary harness that drives the real main process against the built renderer and a fake token endpoint, and the lint/build commands above. The harness was removed after use, so the session path has no regression net yet.

## License

Private. All rights reserved.
