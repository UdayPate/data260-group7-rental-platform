// Mock AI Agent Service: REST endpoints + the WebSocket debate stream.
import { delay, http, HttpResponse, passthrough, ws } from 'msw'
import type { AiResult, FeedbackItem, HumanDecision, MatcherWeights, VersionsResponse } from '../../types/ai'
import { WEIGHT_KEYS } from '../../types/ai'
import { requestClaims, socketClaims } from '../auth/gate'
import { allTaskEntries, CLOSE_DELAY_MS, getTaskEntry, isFinished, publish, startTask, subscribe } from '../ai/bus'
import { BASELINE, SAMPLE_FEEDBACK, state as versionState, VERSIONS, versionById } from '../ai/versions'
import { db } from '../db'
import { errorResponse, invalidJsonResponse, MOCK_DELAY_MS, readBody, requireFields } from '../responses'

const taskNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No AI task found with id ${String(id)}.`)

// Checks optional rerun weights: all five, each a number from 0 to 1, not all zero.
// Returns the weights, or an error message.
function readWeights(value: unknown): MatcherWeights | string {
  if (typeof value !== 'object' || value === null) return 'weights must be an object with the five Matcher weights.'
  const w = value as Record<string, unknown>
  for (const key of WEIGHT_KEYS) {
    const n = w[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) return `weights.${key} must be a number from 0 to 1.`
  }
  const extra = Object.keys(w).filter((k) => !(WEIGHT_KEYS as readonly string[]).includes(k))
  if (extra.length > 0) return `Unknown weight(s): ${extra.join(', ')}.`
  if (WEIGHT_KEYS.every((k) => w[k] === 0)) return 'At least one weight must be above 0.'
  return w as MatcherWeights
}

// Every human decision so far, newest first, plus the labelled sample entries (team decision V1a).
function feedbackItems(): FeedbackItem[] {
  const real: FeedbackItem[] = allTaskEntries()
    .filter((e) => e.result?.human_decision)
    .map((e) => {
      const d = e.result!.human_decision!
      const recommended = e.result!.recommended
      return {
        feedback_id: `fb_${e.task.task_id}_${e.task.trace_id.slice(0, 8)}`,
        trace_id: e.task.trace_id,
        task_id: e.task.task_id,
        guest_id: d.guest_id,
        recommended_property_id: recommended?.property_id ?? null,
        recommended_title: recommended?.title ?? null,
        decision: d.decision,
        reason: d.reason ?? d.edited_rationale,
        decided_datetime: d.decided_datetime,
        sample: false,
        outcome: null,
        outcome_version: null,
        outcome_reason: null,
      }
    })
  return [...real, ...SAMPLE_FEEDBACK].sort((a, b) => b.decided_datetime.localeCompare(a.decided_datetime))
}

function versionsResponse(): VersionsResponse {
  return {
    active_version_id: versionState.active_version_id,
    versions: VERSIONS,
    baseline: BASELINE,
    history: versionState.history,
    evaluation_sample: true,
  }
}

// Promote (to a newer version) or roll back (to an older one). Admin only (checked by the gate).
async function switchVersion(request: Request, versionId: string, action: 'promote' | 'rollback') {
  await delay(MOCK_DELAY_MS)
  const target = versionById(versionId)
  if (!target) return errorResponse('NOT_FOUND', `No matcher version ${versionId}.`)
  if (versionId === versionState.active_version_id) {
    return errorResponse('INVALID_STATUS', `${versionId} is already the active version.`)
  }
  const newer = VERSIONS.indexOf(target) > VERSIONS.findIndex((v) => v.version_id === versionState.active_version_id)
  if (action === 'promote' && !newer) return errorResponse('INVALID_STATUS', `${versionId} is older than the active version: roll back to it instead.`)
  if (action === 'rollback' && newer) return errorResponse('INVALID_STATUS', `${versionId} is newer than the active version: promote it instead.`)
  const admin = (await requestClaims(request))!
  versionState.active_version_id = versionId
  versionState.history.push({ action, version_id: versionId, by_id: admin.sub, by_name: admin.name, at: new Date().toISOString() })
  return HttpResponse.json(versionsResponse())
}

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
    // Optional rerun (spec 13.6): new weights, and the task it reruns.
    let weights: MatcherWeights | null = null
    if (body.weights !== undefined) {
      const checked = readWeights(body.weights)
      if (typeof checked === 'string') return errorResponse('VALIDATION_ERROR', checked)
      weights = checked
    }
    let parentTaskId: string | null = null
    if (body.parent_task_id !== undefined) {
      const parent = getTaskEntry(String(body.parent_task_id))
      if (!parent) return taskNotFound(body.parent_task_id)
      if (parent.task.guest_id !== body.guest_id) return errorResponse('UNAUTHORIZED', 'You can only rerun your own AI requests.')
      if (parent.task.request_text !== text) {
        return errorResponse('VALIDATION_ERROR', 'A rerun must use the same request text as the request it reruns.')
      }
      parentTaskId = parent.task.task_id
    }
    const demo = (body.demo ?? {}) as Record<string, unknown>
    const task = startTask(
      String(body.guest_id),
      text,
      {
        delay_risk_agent: demo.delay_risk_agent === true,
        invalid_agent_output: demo.invalid_agent_output === true,
      },
      { weights, parentTaskId },
    )
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

  // ----- Self-improvement (spec 7.5.4): admin only, checked by the auth gate -----
  http.get('*/ai/feedback', async () => {
    await delay(MOCK_DELAY_MS)
    return HttpResponse.json({ items: feedbackItems() })
  }),
  http.get('*/ai/versions', async () => {
    await delay(MOCK_DELAY_MS)
    return HttpResponse.json(versionsResponse())
  }),
  http.post('*/ai/versions/:versionId/promote', ({ params, request }) => switchVersion(request, String(params.versionId), 'promote')),
  http.post('*/ai/versions/:versionId/rollback', ({ params, request }) => switchVersion(request, String(params.versionId), 'rollback')),

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
