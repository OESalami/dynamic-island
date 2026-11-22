"""LiveKit RPC client for the JARVIS desktop (drop-in agent module).

The Python agent runs in the cloud; the Electron app owns the real Windows
desktop. This module is the agent-side half of that contract. It uses the
official LiveKit Python API:

    await room.local_participant.perform_rpc(
        destination_identity=<desktop participant identity>,
        method="jarvis.desktop.openApplication",
        payload=json.dumps({...}),
        response_timeout=10.0,   # seconds in the Python SDK
    )

Integration into an existing agent (no changes to this file required)::

    from jarvis_desktop_rpc import DESKTOP_TOOLS

    class Assistant(Agent):
        def __init__(self) -> None:
            super().__init__(instructions="...", tools=DESKTOP_TOOLS)

Do not paste LiveKit API keys or secrets into this file or into Electron. They
belong in the agent's deployment secrets only.

Method names and payloads must match `src/shared/desktopRpc.js` exactly.
"""

from __future__ import annotations

import json
from typing import Any

from livekit import rtc
from livekit.agents import RunContext, function_tool, get_job_context
from livekit.agents.llm import ToolError

# Mirrors src/shared/desktopRpc.js
GET_INFO = "jarvis.desktop.getInfo"
OPEN_APPLICATION = "jarvis.desktop.openApplication"

APP_NOTEPAD = "notepad"
APP_CALCULATOR = "calculator"
APP_FILE_EXPLORER = "file-explorer"
ALLOWED_APPS = frozenset({APP_NOTEPAD, APP_CALCULATOR, APP_FILE_EXPLORER})

# The desktop generates `jarvis-desktop-<uuid>` per session. This is a discovery
# prefix, not a hardcoded identity; the room is already per-user and per-session.
DESKTOP_IDENTITY_PREFIX = "jarvis-desktop-"

DEFAULT_TIMEOUT_SECONDS = 10.0
INFO_TIMEOUT_SECONDS = 6.0
OPEN_TIMEOUT_SECONDS = 10.0


class DesktopRpcError(Exception):
    """A structured failure returned by the desktop."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def find_desktop_participant(room: rtc.Room) -> str:
    """Return the one desktop participant in this (per-user) room.

    Raises DesktopRpcError when paired desktop is absent or ambiguous, so the
    agent never guesses an identity and never addresses another user's client.
    """
    candidates = [
        identity
        for identity, participant in room.remote_participants.items()
        if identity.startswith(DESKTOP_IDENTITY_PREFIX)
        and not getattr(participant, "is_agent", False)
    ]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise DesktopRpcError(
            "desktop-not-found",
            "No JARVIS desktop participant is connected to this room.",
        )
    raise DesktopRpcError(
        "ambiguous-desktop",
        "More than one JARVIS desktop participant is connected; refusing to guess.",
    )


def _decode_envelope(raw: str) -> dict[str, Any]:
    """Parse a desktop response and turn a structured failure into an error."""
    try:
        envelope = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise DesktopRpcError("invalid-response", "Desktop returned an invalid response.") from exc

    if not isinstance(envelope, dict) or not isinstance(envelope.get("ok"), bool):
        raise DesktopRpcError("invalid-response", "Desktop returned an invalid response.")

    if not envelope["ok"]:
        error = envelope.get("error")
        if isinstance(error, dict):
            raise DesktopRpcError(
                str(error.get("code", "internal")),
                str(error.get("message", "Desktop action failed.")),
            )
        raise DesktopRpcError("internal", "Desktop action failed.")
    return envelope


def _decode_rpc_error(error: rtc.RpcError) -> DesktopRpcError:
    """Extract our structured error from an RpcError without leaking internals."""
    message = getattr(error, "message", None) or str(error)
    try:
        envelope = json.loads(message)
    except (TypeError, ValueError):
        return DesktopRpcError("rpc-error", "The desktop could not complete the action.")
    if isinstance(envelope, dict) and envelope.get("ok") is False:
        failure = envelope.get("error")
        if isinstance(failure, dict):
            return DesktopRpcError(
                str(failure.get("code", "rpc-error")),
                str(failure.get("message", "Desktop action failed.")),
            )
    return DesktopRpcError("rpc-error", "The desktop could not complete the action.")


class DesktopRpcClient:
    """Thin, typed wrapper around `local_participant.perform_rpc`."""

    def __init__(
        self,
        room: rtc.Room,
        destination_identity: str | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._room = room
        self._destination_identity = destination_identity
        self._timeout = timeout

    @property
    def destination_identity(self) -> str:
        if self._destination_identity is None:
            self._destination_identity = find_desktop_participant(self._room)
        return self._destination_identity

    async def call(
        self,
        method: str,
        payload: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Call one allowlisted method and return its `data` object."""
        body = json.dumps(payload or {}, separators=(",", ":"), ensure_ascii=False)
        try:
            response = await self._room.local_participant.perform_rpc(
                destination_identity=self.destination_identity,
                method=method,
                payload=body,
                response_timeout=timeout or self._timeout,
            )
        except rtc.RpcError as error:
            raise _decode_rpc_error(error) from error
        except Exception as error:  # noqa: BLE001 - never leak a transport error to the LLM
            raise DesktopRpcError("rpc-error", "The desktop could not be reached.") from error

        envelope = _decode_envelope(response)
        data = envelope.get("data")
        return data if isinstance(data, dict) else {}

    async def get_info(self) -> dict[str, Any]:
        return await self.call(GET_INFO, {}, timeout=INFO_TIMEOUT_SECONDS)

    async def open_application(self, app: str) -> dict[str, Any]:
        # Local allowlist as well as the desktop-side one: a bad model call must
        # never turn into an arbitrary application path.
        if app not in ALLOWED_APPS:
            raise DesktopRpcError("app-not-allowed", "Application is not allowed.")
        return await self.call(OPEN_APPLICATION, {"app": app}, timeout=OPEN_TIMEOUT_SECONDS)


def _client_from_job() -> DesktopRpcClient:
    return DesktopRpcClient(get_job_context().room)


@function_tool()
async def get_desktop_info(context: RunContext) -> dict[str, Any]:
    """Get read-only information about the connected Windows desktop.

    Use this to confirm the desktop is live, which Windows build it runs and
    which displays are available. It does not read files or user data.
    """
    del context  # the tool signature includes it; the job context has the room
    try:
        return await _client_from_job().get_info()
    except DesktopRpcError as error:
        raise ToolError(f"Desktop info unavailable [{error.code}]: {error.message}") from error


@function_tool()
async def open_application(context: RunContext, app: str) -> dict[str, Any]:
    """Open one allowed application on the user's Windows desktop.

    Args:
        app: One of "notepad", "calculator", "file-explorer". Nothing else is
             accepted; paths, commands and arbitrary app names are rejected.
    """
    del context
    try:
        return await _client_from_job().open_application(app)
    except DesktopRpcError as error:
        raise ToolError(f"Could not open application [{error.code}]: {error.message}") from error


DESKTOP_TOOLS = [get_desktop_info, open_application]
"""Add these to an agent's `tools` list to expose desktop RPC to the LLM."""
