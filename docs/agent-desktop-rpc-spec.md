# Agent-side spec: desktop control over LiveKit RPC

This is the contract for the cloud Python agent. The Electron app joins the same
per-session LiveKit room as the agent and stays the only place that can touch the
Windows desktop. The agent requests actions with LiveKit RPC; nothing is executed
in the agent process.

The agent source is not in this repository. A drop-in implementation is provided
at [`agent/jarvis_desktop_rpc.py`](../agent/jarvis_desktop_rpc.py).

## 1. Transport

- JavaScript side: `room.registerRpcMethod()` on the **existing** LiveKit room.
- Python side: `room.local_participant.perform_rpc(...)`.
- One room per JARVIS session: `jarvis-<uuid>`.
- Desktop identity: `jarvis-desktop-<uuid>`, generated fresh for every session.
- No identity is hardcoded. The agent discovers the desktop by the prefix above,
  requires exactly one candidate, and refuses to guess if zero or several are
  present. Multiple users are isolated by their separate rooms.
- RPC is available only while a JARVIS session is live. Main also checks the
  session id carried in every request, so a stale request cannot drive the
  desktop after `Alt+Space` ended the session.

## 2. Method names and payloads

Names and shapes are defined once in `src/shared/desktopRpc.js` and mirrored in
the Python module. Payloads are compact JSON strings.

### `jarvis.desktop.getInfo`

Read-only. Payload: `{}` or `null`.

Response `data` example:

```json
{
  "platform": "win32",
  "arch": "x64",
  "osRelease": "10.0.26100",
  "appVersion": "0.1.0",
  "sessionId": "session-1",
  "displays": [{ "id": 1, "primary": true, "width": 1920, "height": 1080, "scaleFactor": 1.25 }],
  "capabilities": ["jarvis.desktop.getInfo", "jarvis.desktop.openApplication"]
}
```

The response envelope is always `{ "ok": true, "data": ... }` or
`{ "ok": false, "error": { "code": "...", "message": "..." } }`.

### `jarvis.desktop.openApplication`

Payload:

```json
{ "app": "notepad" }
```

Accepted `app` values: `notepad`, `calculator`, `file-explorer`.

The agent cannot supply an executable path, arguments, a URL or a shell command.
The app identifier is matched against a fixed map in main; launches use
`shell: false` for fixed Windows system executables, or a registered Windows URI
for Calculator. This is a deliberate, bounded process launch — not arbitrary
command execution.

A native Windows confirmation dialog is shown by the trusted main process. The
action proceeds only after the user clicks **Allow**; a denial or a 7-second
timeout returns `approval-denied`.

Response `data`: `{ "app": "notepad", "launched": true }`.

## 3. Timeouts and errors

- Python `response_timeout` is in **seconds**. Use 6 s for `getInfo` and 10 s for
  actions. The renderer leaves ~400 ms of headroom for the return trip.
- Any handler failure is returned as a structured `RpcError` message containing
  the same envelope as above. Stacks, paths and internal error objects are never
  sent to the agent.
- Stable error codes: `unsupported-method`, `invalid-payload`,
  `session-inactive`, `forbidden-caller`, `forbidden-sender`,
  `approval-denied`, `app-not-allowed`, `action-failed`, `timeout`, `internal`.
- Numeric `RpcError` codes: 400 (bad request), 403 (forbidden), 503 (inactive
  session), 408 (timeout), 500 (internal).
- LiveKit limits request and response payloads to 15 KiB. Large artifacts must
  use a media/data pipeline, not RPC.

## 4. Security boundary

1. The renderer validates the caller identity (room agent only), the live phase
   and the payload before IPC.
2. One explicit IPC channel (`island:desktop-rpc`) carries the request to main.
   The renderer has no Node, `fs`, `shell` or raw `ipcRenderer` access.
3. Main validates the trusted sender, session id, method allowlist and payload
   again, then asks for approval when the tool is sensitive.
4. Only the allowlisted tool runs, on the main process, with fixed inputs.
5. LiveKit API credentials are never in Electron. The agent keeps its own
   deployment secrets.

## 5. Incremental roadmap

Implemented in this foundation:

- [x] RPC registration on the existing room, with cleanup on disconnect
- [x] Session/caller/payload validation and structured errors
- [x] `jarvis.desktop.getInfo`
- [x] `jarvis.desktop.openApplication` with allowlist + approval

Designed for, but intentionally **not yet implemented** until the foundation
round trip is verified:

- Phase A: screenshots, folders/files, websites
- Phase B: mouse, keyboard, scrolling, windows
- Phase C: directory listing, read/create/move/search
- Phase D: visual verification

For Phase D, keep using the existing **video screen-share track** described in
[`agent-vision-spec.md`](agent-vision-spec.md). RPC is for short commands and
small results; a downscaled screenshot in an RPC response is only suitable for
tiny verification thumbnails, not for model-grade vision.

## 6. Testing against the deployed agent

1. Deploy the agent with `DESKTOP_TOOLS` included in the agent's `tools`.
2. Start the Electron app and press `Alt+Space` to open a live session.
3. Ask: “What desktop am I connected to?” The agent should call `get_desktop_info`
   and report the platform/displays without any dialog.
4. Ask: “Open Notepad.” A native **JARVIS desktop action** dialog must appear.
   Clicking **Don't allow** must produce a denial; clicking **Allow** must launch
   Notepad and return `{"app":"notepad","launched":true}`.
5. Press `Alt+Space` to stop the session, then ask the deployed agent to repeat
   the action. It must fail with `session-inactive` and nothing must launch.
6. Verify in main-process logs: one `[jarvis-rpc]` approval line per prompt and
   `[JARVIS] RPC ...` lines for each call. No token or secret may appear.
