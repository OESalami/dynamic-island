// Temporary: confirms the token the dev token server returns carries the agent
// dispatch config, using the SDK's own TokenSource. Removed after use.
import { TokenSource } from 'livekit-client'

const source = TokenSource.developmentTokenServer('callagent-2qxh5u')
const response = await source.fetch({
  roomName: 'jarvis-probe-0002',
  participantIdentity: 'jarvis-desktop-probe-0002',
  agentName: 'my-agent',
})

console.log('serverUrl:', response.serverUrl)
console.log('participantToken length:', response.participantToken?.length)

const payload = JSON.parse(
  Buffer.from(response.participantToken.split('.')[1], 'base64url').toString(),
)
console.log('claims.sub:', payload.sub)
console.log('claims.video:', JSON.stringify(payload.video))
console.log('claims.roomConfig:', JSON.stringify(payload.roomConfig ?? payload.room_config))
console.log('cached payload sub:', source.getCachedResponseJwtPayload()?.sub)
