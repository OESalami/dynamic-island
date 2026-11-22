import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DesktopRpcError,
  RPC_APP_IDS,
  RPC_ERROR_CODES,
  RPC_METHODS,
  byteLength,
  ok,
  parseRpcPayload,
  parseRpcResult,
  serializeRpcError,
  validateRpcPayload,
} from '../src/shared/desktopRpc.js'
import { createDesktopRpcDispatcher } from '../src/main/desktopRpc/core.js'
import {
  createDesktopRpcHandlers,
  isAgentCaller,
  registerDesktopRpc,
  unregisterDesktopRpc,
} from '../src/renderer/livekit/desktopRpc.js'

const requestId = 'test-request-1'
const callerIdentity = 'agent-1'

function baseData(overrides = {}) {
  return {
    method: RPC_METHODS.GET_INFO,
    payload: '{}',
    callerIdentity,
    requestId,
    responseTimeout: 10_000,
    ...overrides,
  }
}

function captureError(promise) {
  return promise.then(
    () => null,
    (error) => error,
  )
}

function decode(message) {
  return JSON.parse(message)
}

test('payload parsing rejects invalid shapes and oversized input', () => {
  assert.deepEqual(parseRpcPayload('null'), {})
  assert.deepEqual(parseRpcPayload('{"app":"notepad"}'), { app: 'notepad' })
  assert.throws(() => parseRpcPayload('[]'), DesktopRpcError)
  assert.throws(() => parseRpcPayload('not-json'), DesktopRpcError)
  assert.throws(() => parseRpcPayload('x'.repeat(20_000)), DesktopRpcError)
})

test('payload validation enforces the method allowlist and app allowlist', () => {
  assert.deepEqual(validateRpcPayload(RPC_METHODS.GET_INFO, {}), {})
  assert.throws(
    () => validateRpcPayload(RPC_METHODS.GET_INFO, { unexpected: true }),
    (error) => error.code === RPC_ERROR_CODES.INVALID_PAYLOAD,
  )
  assert.deepEqual(
    validateRpcPayload(RPC_METHODS.OPEN_APPLICATION, { app: RPC_APP_IDS.NOTEPAD }),
    { app: RPC_APP_IDS.NOTEPAD },
  )
  assert.throws(
    () => validateRpcPayload(RPC_METHODS.OPEN_APPLICATION, { app: 'C:\\Windows\\System32\\cmd.exe' }),
    (error) => error.code === RPC_ERROR_CODES.APP_NOT_ALLOWED,
  )
  assert.throws(
    () => validateRpcPayload('jarvis.desktop.runCommand', {}),
    (error) => error.code === RPC_ERROR_CODES.UNSUPPORTED_METHOD,
  )
})

test('error envelopes are structured, bounded and carry no stack', () => {
  const message = serializeRpcError(RPC_ERROR_CODES.APPROVAL_DENIED, 'x'.repeat(500))
  const body = decode(message)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, RPC_ERROR_CODES.APPROVAL_DENIED)
  assert.ok(byteLength(message) < 256)
  assert.ok(!message.includes('at '))

  assert.throws(
    () => parseRpcResult(serializeRpcError(RPC_ERROR_CODES.INTERNAL, 'nope')),
    (error) => error.code === RPC_ERROR_CODES.INTERNAL && error.message === 'nope',
  )
  assert.deepEqual(parseRpcResult(ok({ launched: true })), { launched: true })
})

test('dispatcher gates on live session, method, payload and approval', async () => {
  let runs = 0
  const tools = {
    [RPC_METHODS.GET_INFO]: { run: async () => ({ platform: 'win32' }) },
    [RPC_METHODS.OPEN_APPLICATION]: {
      sensitive: true,
      label: 'launch an application',
      run: async () => {
        runs += 1
        return { launched: true }
      },
    },
  }
  const dispatch = createDesktopRpcDispatcher({
    tools,
    approval: async () => true,
    logger: { error: () => {} },
  })
  const context = { expectedSessionId: 'session-1', isLiveSession: () => true }
  const call = (overrides, ctx = context) =>
    dispatch(
      {
        sessionId: 'session-1',
        method: RPC_METHODS.GET_INFO,
        payload: '{}',
        callerIdentity,
        requestId,
        ...overrides,
      },
      ctx,
    )

  assert.deepEqual(decode(await call({})).data, { platform: 'win32' })
  assert.equal(
    decode(await call({ sessionId: 'session-0' })).error.code,
    RPC_ERROR_CODES.SESSION_INACTIVE,
  )
  assert.equal(
    decode(await call({}, { expectedSessionId: 'session-1', isLiveSession: () => false })).error.code,
    RPC_ERROR_CODES.SESSION_INACTIVE,
  )
  assert.equal(
    decode(await call({ method: 'jarvis.desktop.exec' })).error.code,
    RPC_ERROR_CODES.UNSUPPORTED_METHOD,
  )

  const approved = await call({
    method: RPC_METHODS.OPEN_APPLICATION,
    payload: '{"app":"notepad"}',
  })
  assert.equal(decode(approved).data.launched, true)
  assert.equal(runs, 1)

  const denied = createDesktopRpcDispatcher({
    tools,
    approval: async () => false,
    logger: { error: () => {} },
  })
  assert.equal(
    decode(
      await denied(
        {
          sessionId: 'session-1',
          method: RPC_METHODS.OPEN_APPLICATION,
          payload: '{"app":"notepad"}',
          callerIdentity,
          requestId,
        },
        context,
      ),
    ).error.code,
    RPC_ERROR_CODES.APPROVAL_DENIED,
  )
  assert.equal(runs, 1, 'denied approval must not run the tool')
})

test('dispatcher never leaks internal errors', async () => {
  const errors = []
  const dispatch = createDesktopRpcDispatcher({
    tools: {
      [RPC_METHODS.GET_INFO]: {
        run: async () => {
          throw new Error('secret C:\\Users\\someone\\stack')
        },
      },
    },
    approval: async () => true,
    logger: { error: (line) => errors.push(line) },
  })
  const raw = await dispatch(
    {
      sessionId: 'session-1',
      method: RPC_METHODS.GET_INFO,
      payload: '{}',
      callerIdentity,
      requestId,
    },
    { expectedSessionId: 'session-1', isLiveSession: () => true },
  )
  assert.equal(decode(raw).error.code, RPC_ERROR_CODES.INTERNAL)
  assert.ok(!raw.includes('secret'))
  assert.equal(errors.length, 1)
})

test('caller validation accepts only the room agent', () => {
  const room = {
    remoteParticipants: new Map([
      ['agent-1', { identity: 'agent-1', isAgent: true }],
      ['intruder', { identity: 'intruder', isAgent: false }],
    ]),
  }
  assert.equal(isAgentCaller(room, 'agent-1'), true)
  assert.equal(isAgentCaller(room, 'intruder'), false)

  const unflagged = {
    remoteParticipants: new Map([['agent-2', { identity: 'agent-2', isAgent: false }]]),
  }
  assert.equal(isAgentCaller(unflagged, 'agent-2'), true)
})

test('renderer handlers bridge a valid call and report structured failures', async () => {
  const seen = []
  const handlers = createDesktopRpcHandlers({
    invoke: async (request) => {
      seen.push(request)
      return ok({ platform: 'win32' })
    },
    getSessionId: () => 'session-1',
    isSessionLive: () => true,
    isCallerAllowed: () => true,
  })

  const result = await handlers[RPC_METHODS.GET_INFO](baseData())
  assert.deepEqual(decode(result).data, { platform: 'win32' })
  assert.deepEqual(seen[0], {
    method: RPC_METHODS.GET_INFO,
    payload: '{}',
    sessionId: 'session-1',
    callerIdentity,
    requestId,
  })

  const forbidden = await captureError(
    createDesktopRpcHandlers({
      invoke: async () => ok({}),
      getSessionId: () => 'session-1',
      isSessionLive: () => true,
      isCallerAllowed: () => false,
    })[RPC_METHODS.GET_INFO](baseData()),
  )
  assert.equal(forbidden.code, 403)
  assert.equal(decode(forbidden.message).error.code, RPC_ERROR_CODES.FORBIDDEN_CALLER)

  const inactive = await captureError(
    createDesktopRpcHandlers({
      invoke: async () => ok({}),
      getSessionId: () => 'session-1',
      isSessionLive: () => false,
      isCallerAllowed: () => true,
    })[RPC_METHODS.GET_INFO](baseData()),
  )
  assert.equal(inactive.code, 503)

  const badApp = await captureError(
    handlers[RPC_METHODS.OPEN_APPLICATION](
      baseData({ method: RPC_METHODS.OPEN_APPLICATION, payload: '{"app":"cmd.exe"}' }),
    ),
  )
  assert.equal(badApp.code, 400)
  assert.equal(decode(badApp.message).error.code, RPC_ERROR_CODES.APP_NOT_ALLOWED)

  const remoteFailure = await captureError(
    createDesktopRpcHandlers({
      invoke: async () => serializeRpcError(RPC_ERROR_CODES.APPROVAL_DENIED, 'User said no.'),
      getSessionId: () => 'session-1',
      isSessionLive: () => true,
      isCallerAllowed: () => true,
    })[RPC_METHODS.OPEN_APPLICATION](
      baseData({
        method: RPC_METHODS.OPEN_APPLICATION,
        payload: '{"app":"notepad"}',
      }),
    ),
  )
  assert.equal(remoteFailure.code, 403)
  assert.equal(decode(remoteFailure.message).error.code, RPC_ERROR_CODES.APPROVAL_DENIED)
})

test('renderer handlers enforce the RPC deadline', async () => {
  const handlers = createDesktopRpcHandlers({
    invoke: () => new Promise(() => {}),
    getSessionId: () => 'session-1',
    isSessionLive: () => true,
    isCallerAllowed: () => true,
  })
  const error = await captureError(
    handlers[RPC_METHODS.GET_INFO](baseData({ responseTimeout: 1_400 })),
  )
  assert.equal(error.code, 408)
  assert.equal(decode(error.message).error.code, RPC_ERROR_CODES.TIMEOUT)
})

test('RPC registration is idempotent and cleans up on teardown', () => {
  let nextId = 0
  const room = {
    remoteParticipants: new Map(),
    registerRpcMethod(method) {
      this.calls.push(['register', method])
      this.handlers.set(method, ++nextId)
    },
    unregisterRpcMethod(method) {
      this.calls.push(['unregister', method])
      this.handlers.delete(method)
    },
    calls: [],
    handlers: new Map(),
  }
  const options = {
    invoke: async () => ok({}),
    getSessionId: () => 'session-1',
    isSessionLive: () => true,
    isCallerAllowed: () => true,
  }

  registerDesktopRpc(room, options)
  registerDesktopRpc(room, options)
  assert.equal(
    room.calls.filter(([action]) => action === 'register').length,
    4,
    'two methods registered on each of two explicit registrations, never 4 live handlers',
  )
  assert.equal(room.handlers.size, 2)

  unregisterDesktopRpc(room)
  assert.equal(room.handlers.size, 0)
  unregisterDesktopRpc(room) // safe no-op
})
