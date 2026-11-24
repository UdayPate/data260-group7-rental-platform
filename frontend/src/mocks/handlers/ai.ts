// Mock AI Agent Service: REST endpoints + the WebSocket debate stream.
import { delay, http, HttpResponse, passthrough, ws } from 'msw'
import type { AiResult, HumanDecision } from '../../types/ai'
import { socketClaims } from '../auth/gate'
import { CLOSE_DELAY_MS, getTaskEntry, isFinished, publish, startTask, subscribe } from '../ai/bus'
import { db } from '../db'
import { errorResponse, invalidJsonResponse, MOCK_DELAY_MS, readBody, requireFields } from '../responses'

const taskNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No AI task found with id ${String(id)}.`)

// The page URL /ai/tasks/:taskId is the same path as the API's GET /ai/tasks/{task_id}
// when both are on the same server (mock mode). A page load (the browser asking for HTML)
// must go to the app, not to this mock, or reloading the debate page would show raw JSON.
const isPageLoad = (request: Request) =>
  request.mode === 'navigate' || (request.headers.get('accept') ?? '').includes('text/html')

// The live stream: /ai/tasks/{task_id}/stream?after_seq=N on any server (ws:// or wss://).
const debateStream = ws.link(/\/ai\/tasks\/[^/]+\/stream/)

// addEventListener returns the handler that goes in the handlers list.
// The token comes in "?token=" (browsers can't set headers on a WebSocket).
const debateStreamHandler = debateStream.addEventListener('connection', async ({ client }) => {
  const claims = await socketClaims(client.url)
  if (!claims) {
    client.close(4401, 'Missing, invalid or expired token') // the page sends you to the login page
    return
  }
  const taskId = decodeURIComponent(client.url.pathname.split('/')[3] ?? '')
  const entry = getTaskEntry(taskId)
  if (!entry) {
    client.close(4404, 'No AI task with this id') // 4000+ = don't retry
    return
  }
  if (entry.task.guest_id !== claims.sub) {
    client.close(4403, 'This AI request belongs to another guest')
    return
  }
  const afterSeq = Number(client.url.searchParams.get('after_seq') ?? 0) || 0

  // 1. Replay what the page hasn't seen yet.
  for (const event of entry.events) {
    if (event.seq > afterSeq) client.send(JSON.stringify(event))
  }
  if (isFinished(entry)) {
    // Wait for the replayed messages to go out before closing (see CLOSE_DELAY_MS).
    setTimeout(() => client.close(1000, 'Debate finished'), CLOSE_DELAY_MS)
    return
  }
  // 2. Then stream new events for THIS trace only.
  const unsubscribe = subscribe({
    traceId: entry.task.trace_id,
    send: (event) => client.send(JSON.stringify(event)),
    end: () => client.close(1000, 'Debate finished'),
  })
  client.addEventListener('close', unsubscribe)
})

// Approve / reject share these checks. Returns an error response or the task's result.
function checkDecision(taskId: string, guestId: unknown): Response | { result: AiResult } {
  const entry = getTaskEntry(taskId)
  if (!entry) return taskNotFound(taskId)
  if (entry.task.guest_id !== guestId) return errorResponse('UNAUTHORIZED', 'Only the guest who asked can approve or reject this recommendation.')
  if (entry.result?.human_decision) {
    return errorResponse('INVALID_STATUS', `This recommendation was already ${entry.result.human_decision.decision}.`)
  }
  if (entry.task.status !== 'waiting_for_approval' || !entry.result) {
    return errorResponse('INVALID_STATUS', 'The debate is not finished yet, so there is nothing to approve.')
  }
  return { result: entry.result }
}

function recordDecision(taskId: string, result: AiResult, decision: HumanDecision) {
  result.human_decision = decision
  publish(taskId, decision.guest_id, 'decision.recorded', { decision })
  publish(taskId, 'harness', 'task.status', {
    status: 'completed',
    note: `Guest ${decision.decision} the recommendation.`,
  })
  return HttpResponse.json(result)
}

export const aiHandlers = [
  debateStreamHandler,

  http.post('*/ai/requests', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id', 'request_text'])
    if (missing) return missing
    const text = String(body.request_text).trim()
    if (text.length < 10) return errorResponse('VALIDATION_ERROR', 'Please describe what you’re looking for in a little more detail.')
    if (text.length > 500) return errorResponse('VALIDATION_ERROR', 'Please keep the request under 500 characters.')
    if (!db.guests.some((g) => g.guest_id === body.guest_id)) {
      return errorResponse('NOT_FOUND', `No guest found with id ${String(body.guest_id)}.`)
    }
    const demo = (body.demo ?? {}) as Record<string, unknown>
    const task = startTask(String(body.guest_id), text, {
      delay_risk_agent: demo.delay_risk_agent === true,
      invalid_agent_output: demo.invalid_agent_output === true,
    })
    // 202 Accepted: the work continues in the background; follow it on the stream.
    return HttpResponse.json({ task_id: task.task_id, trace_id: task.trace_id, status: task.status }, { status: 202 })
  }),

  http.get('*/ai/tasks/:taskId', async ({ params, request }) => {
    if (isPageLoad(request)) return passthrough()
    await delay(MOCK_DELAY_MS)
    const entry = getTaskEntry(String(params.taskId))
    if (!entry) return taskNotFound(params.taskId)
    return HttpResponse.json({ task: entry.task, events: entry.events })
  }),

  http.get('*/ai/results/:taskId', async ({ params, request }) => {
    if (isPageLoad(request)) return passthrough()
    await delay(MOCK_DELAY_MS)
    const entry = getTaskEntry(String(params.taskId))
    if (!entry) return taskNotFound(params.taskId)
    if (!entry.result) return errorResponse('INVALID_STATUS', 'The debate is still running; the result isn’t ready yet.')
    return HttpResponse.json(entry.result)
  }),

  http.post('*/ai/tasks/:taskId/approve', async ({ params, request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id'])
    if (missing) return missing
    const checked = checkDecision(String(params.taskId), body.guest_id)
    if (checked instanceof Response) return checked
    const { result } = checked

    const edits = (body.edits ?? {}) as { property_id?: unknown; rationale?: unknown }
    const editedProperty = typeof edits.property_id === 'string' && edits.property_id !== result.recommended?.property_id ? edits.property_id : null
    const editedRationale = typeof edits.rationale === 'string' && edits.rationale.trim() !== result.rationale ? edits.rationale.trim() : null
    if (editedProperty && !result.ranked.some((r) => r.property_id === editedProperty)) {
      return errorResponse('VALIDATION_ERROR', 'You can only pick one of the listed candidates.')
    }
    if (editedRationale === '') return errorResponse('VALIDATION_ERROR', 'The explanation can’t be empty.')
    return recordDecision(String(params.taskId), result, {
      decision: editedProperty || editedRationale ? 'edited' : 'approved',
      guest_id: String(body.guest_id),
      reason: typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : null,
      edited_property_id: editedProperty,
      edited_rationale: editedRationale,
      decided_datetime: new Date().toISOString(),
    })
  }),

  http.post('*/ai/tasks/:taskId/reject', async ({ params, request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id', 'reason'])
    if (missing) return missing
    if (String(body.reason).trim() === '') return errorResponse('VALIDATION_ERROR', 'Please give a reason for rejecting.')
    const checked = checkDecision(String(params.taskId), body.guest_id)
    if (checked instanceof Response) return checked
    return recordDecision(String(params.taskId), checked.result, {
      decision: 'rejected',
      guest_id: String(body.guest_id),
      reason: String(body.reason).trim(),
      edited_property_id: null,
      edited_rationale: null,
      decided_datetime: new Date().toISOString(),
    })
  }),
]
