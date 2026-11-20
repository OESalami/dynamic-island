# Agent-side spec: vision / screen sharing

This document is the contract for the **agent** half of the JARVIS vision feature.
The desktop app half (this repository) is already built; everything below is what
`my-agent` must do to consume it. Nothing here changes dispatch or the token
contract — the desktop keeps joining the same room the same way.

## 1. What the desktop app publishes

- **Trigger**: `Alt+Shift+S` in the island app starts and stops the share.
- **Track**: a **video-only `screen_share`** local track (no `screen_share_audio`),
  published by the desktop's participant into the existing room, and **only while
  a voice session is live**.
- **Source**: the **primary display, whole screen**. v1 has no source picker and
  no window-level capture.
- **Gating**: the share is refused if (a) no session is connected, (b) a frame
  other than the island's asks, or (c) capture is denied by the system. A refused
  or failed share **never ends the voice session** — the room, microphone and
  agent stay up.

From the agent's seat, the desktop is just a remote participant that, while
connected, may publish a single `screen_share` video track at any point and
unpublish it again (user stops sharing, or the session ends). The track may
appear *mid-session*, well after connect — the agent must handle late tracks.

## 2. Two consumption routes

| | Realtime vision (recommended) | Frame sampling |
| --- | --- | --- |
| Agent stack | A realtime model with video input | STT → LLM → TTS (any model) |
| What the agent sees | Live frames streamed into the model | One still image appended per user turn |
| Best for | "What's on my screen right now?", tool-use over the screen | Occasional screen context in an otherwise audio conversation |
| Cost | Per frame, model-dependent (see below) | One image per turn — cheapest |
| Docs section | [Live video input](https://docs.livekit.io/agents/multimodality/vision/video#live-video-input) | [Sample video frames](https://docs.livekit.io/agents/multimodality/vision/video#sample-video-frames) |

Both routes are built into LiveKit Agents today. The desktop app treats them
identically: it publishes the track and changes nothing else.

## 3. Route A — Realtime vision (recommended)

Requires a **Python** agent and a realtime model that supports video input:
[Gemini Live](https://docs.livekit.io/agents/models/realtime/plugins/gemini.md)
(`livekit.plugins.google` — GeminiLiveModel) or
[OpenAI Realtime](https://docs.livekit.io/agents/models/realtime/plugins/openai.md)
(`livekit.plugins.openai` — OpenAIRealtimeModel). Audio-only realtime models
silently ignore video frames, so pick one of those two.

```python
from livekit import agents

session = agents.AgentSession(
    stt=..., llm=..., tts=...,
    # Optional: override frame cadence / size to control cost (see below).
    # video_sampler=...
)

await session.start(
    agent=agent,
    room=ctx.room,
    room_options=agents.RoomOptions(video_input=True),
)
```

Behaviour once `video_input=True` (per the current LiveKit docs):

- Frames are taken from the user's most recently published video track — here the
  `screen_share` track, since the desktop publishes no camera.
- Default sampling: **1 frame/second while the user speaks, 1 frame / 3 s
  otherwise**, each resized to 1024×1024 JPEG. Override with a custom
  `video_sampler` on the `AgentSession`.
- `video_input` is passive — it has no effect on turn detection.

Use the defaults to start, then tune down (`video_sampler`, frame size) rather
than up. Cost specifics: Gemini Live streams frames inline with the audio
session and tokenises by frame dimensions; OpenAI Realtime places each frame in
the conversation context, where it counts against the context window and input
tokens.

## 4. Route B — Frame sampling on an STT-LLM-TTS agent

```python
# Simplified shape — see the docs' reference implementation for the complete
# version (equivalent TypeScript is provided there too).

class Assistant(agents.Agent):
    def __init__(self) -> None:
        self._latest_frame = None
        self._video_stream = None
        super().__init__(instructions="You are a helpful voice AI assistant.")

    async def on_enter(self):
        room = get_job_context().room

        # Handle the screen share that is already published when we join …
        video = first_video_track_of(room)          # remote participant, kind == VIDEO
        if video:
            self._create_video_stream(video)

        # … and the ones published later (the desktop publishes mid-session).
        @room.on("track_subscribed")
        def on_track_subscribed(track, publication, participant):
            if track.kind == rtc.TrackKind.KIND_VIDEO:
                self._create_video_stream(track)

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        if self._latest_frame:
            new_message.content.append(llm.ImageContent(image=self._latest_frame))
            self._latest_frame = None

    def _create_video_stream(self, track):
        # Close any existing stream — only one video feed at a time.
        if self._video_stream is not None:
            old, self._video_stream = self._video_stream, None
            asyncio.create_task(old.aclose())
        self._video_stream = rtc.VideoStream(track)
        async def read_stream():
            async for event in self._video_stream:
                self._latest_frame = event.frame   # buffer the latest frame only
        asyncio.create_task(read_stream())          # keep a reference; cancel on leave
```

Control size / cost by encoding before attaching:

```python
from livekit.agents.utils.images import encode, EncodeOptions, ResizeOptions

image_bytes = encode(event.frame, EncodeOptions(
    format="PNG",
    resize_options=ResizeOptions(width=512, height=512, strategy="scale_aspect_fit"),
))
new_message.content.append(llm.ImageContent(image=f"data:image/png;base64,{base64.b64encode(image_bytes).decode()}"))
```

Reference implementations (Python + TypeScript) are on the docs'
[Video page](https://docs.livekit.io/agents/multimodality/vision/video).

## 5. Lifecycle the agent must handle

- **Track added**: `track_subscribed` — start consuming frames. This fires *when
  the desktop begins sharing*, which can be long after the session connected.
- **Track removed**: the desktop unpublishes when the user stops sharing or the
  session ends. Close the `VideoStream`, drop the buffered frame. With Route A,
  the realtime model simply stops receiving frames.
- **Only the most recently published video track is consumed** by the agent — the
  desktop publishes exactly one, so nothing else needs coordinating.

## 6. Verification checklist

Run against the deployed agent:

1. Deploy the agent change (`lk app deploy` or your usual path).
2. Connect from the island app; start a voice session (`Alt+Space`) and speak —
   nothing should change from today.
3. Press `Alt+Shift+S`: the island shows the pulsing red share dot, and agent
   logs show a subscribed video track (Route A) / frames arriving (Route B).
4. Ask "what's on my screen?" — the agent should answer from the live screen or
   the last sampled frame.
5. Press `Alt+Shift+S` again: the dot disappears, the track is unpublished, and
   the voice session is unaffected.
6. Stop the session while sharing: the track teardown is silent and clean.

## 7. Known constraints

- v1 is **whole primary display only** and **video-only** (no audio in the share).
- The share exists **only while a session is live**; the user controls it with the
  key. The agent cannot ask the app to start sharing.
- A refused or failed share never damages the voice session — plan for the agent
  receiving no frames at all (it should behave exactly as it does today).