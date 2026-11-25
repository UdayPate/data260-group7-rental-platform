// Mock "Kafka" for the AI debates: ONE shared in-memory stream that every debate in
// this tab publishes to (like the debate.round.* topics shared by all debates).
// Each WebSocket subscriber receives only events whose trace_id matches its task,
// the way a real consumer filters by the message key (spec 13.11, trace isolation).
import type { AiResult, AiTask, DemoOptions, EventPayloads, EventType, MatcherWeights, StreamEvent } from '../../types/ai'
import { planDebate } from './engine'
import { activeVersion } from './versions'

export type TaskEntry = { task: AiTask; events: StreamEvent[]; result: AiResult | null }

type Subscriber = {
  traceId: string
  send: (event: StreamEvent) => void
  end: () => void // close the stream (debate finished)
}

// How long to wait after the last event before closing a finished stream.
export const CLOSE_DELAY_MS = 300

const tasks = new Map<string, TaskEntry>() // debates started in THIS window, by task_id
// Debates started in other windows of this browser (copied in by mocks/sync.ts), by trace_id.
// Kept apart so a task_id that two windows happened to pick at once never replaces a local debate.
const otherWindows = new Map<string, TaskEntry>()
const subscribers = new Set<Subscriber>()

export const getTaskEntry = (taskId: string) =>
  tasks.get(taskId) ?? [...otherWindows.values()].find((e) => e.task.task_id === taskId)
// Every debate this window knows about (for the analytics mock and the admin dashboards).
// (storeOtherWindowEntry never stores a copy of one of ours, so nothing is counted twice.)
export const allTaskEntries = () => [...tasks.values(), ...otherWindows.values()]

// Cross-window sync (team decision S1a): told about every change to a local debate.
let onChange: ((entry: TaskEntry) => void) | null = null
export function setTaskChangeListener(listener: (entry: TaskEntry) => void) {
  onChange = listener
}
// A debate from another window: store or update it (never one of ours).
export function storeOtherWindowEntry(entry: TaskEntry) {
  const local = tasks.get(entry.task.task_id)
  if (local && local.task.trace_id === entry.task.trace_id) return
  otherWindows.set(entry.task.trace_id, entry)
}
export const localTaskEntries = () => [...tasks.values()]

const FINISHED = ['completed', 'failed', 'timed_out']
export const isFinished = (entry: TaskEntry) => FINISHED.includes(entry.task.status)

// Adds one event to a task's history, updates the task, and delivers it to matching subscribers.
export function publish<T extends EventType>(taskId: string, actor: string, type: T, payload: EventPayloads[T]) {
  const entry = tasks.get(taskId)
  if (!entry) return
  const seq = entry.events.length + 1
  const event = {
    event_type: type,
    trace_id: entry.task.trace_id,
    timestamp: new Date().toISOString(), // with milliseconds, for latency measurement
    actor_id: actor,
    entity: { entity_type: 'ai_task', entity_id: taskId },
    idempotency_key: `${taskId}:${seq}`,
    seq,
    payload,
  } as StreamEvent
  entry.events.push(event)

  // Keep the task record in step with its events.
  entry.task.updated_datetime = event.timestamp
  if (event.event_type === 'task.status') entry.task.status = event.payload.status
  if (event.event_type === 'plan.created') entry.task.plan = structuredClone(event.payload.plan)
  if (event.event_type === 'plan.step_updated' && entry.task.plan) {
    const step = entry.task.plan.steps.find((s) => s.step_id === event.payload.step_id)
    if (step) {
      step.status = event.payload.status
      step.note = event.payload.note
    }
  }
  if (event.event_type === 'requirements.parsed') entry.task.requirements = event.payload.requirements
  if (event.event_type === 'result.published') {
    entry.result = { ...event.payload.result, created_datetime: event.timestamp }
    event.payload.result = entry.result
  }

  onChange?.(entry)

  for (const sub of subscribers) {
    if (sub.traceId !== event.trace_id) continue // never deliver another debate's events
    sub.send(event)
    // Close a moment later: MSW delivers messages asynchronously but closes at once,
    // so closing right away would drop the last events.
    if (isFinished(entry)) setTimeout(sub.end, CLOSE_DELAY_MS)
  }
}

export function subscribe(sub: Subscriber): () => void {
  subscribers.add(sub)
  return () => subscribers.delete(sub)
}

// Next number after every task_id this window knows (its own and other windows').
function nextTaskNumber() {
  const numbers = allTaskEntries().map((e) => Number(e.task.task_id.replace('task_', '')) || 0)
  return Math.max(0, ...numbers) + 1
}

// Creates a task and schedules its whole debate (events go out at their planned times).
// weights: a rerun's own weights; otherwise the active matcher version's.
export function startTask(
  guestId: string,
  requestText: string,
  demo: DemoOptions,
  rerun: { weights: MatcherWeights | null; parentTaskId: string | null } = { weights: null, parentTaskId: null },
): AiTask {
  const taskCounter = nextTaskNumber()
  const taskId = `task_${String(taskCounter).padStart(3, '0')}`
  const version = activeVersion()
  const weights = rerun.weights ?? version.weights
  const traceId = crypto.randomUUID()
  const now = new Date().toISOString()
  const task: AiTask = {
    task_id: taskId,
    trace_id: traceId,
    guest_id: guestId,
    request_text: requestText,
    status: 'waiting',
    demo,
    plan: null,
    requirements: null,
    matcher_version: version.version_id,
    weights,
    parent_task_id: rerun.parentTaskId,
    created_datetime: now,
    updated_datetime: now,
    error: null,
  }
  tasks.set(taskId, { task, events: [], result: null })
  publish(taskId, 'harness', 'task.status', { status: 'waiting', note: null })

  const script = planDebate(taskId, traceId, `plan_${String(taskCounter).padStart(3, '0')}`, requestText, demo, {
    version: version.version_id,
    weights,
    parentTaskId: rerun.parentTaskId,
  })
  for (const item of script.timeline) {
    setTimeout(() => publish(taskId, item.actor, item.type, item.payload as never), item.at)
  }
  return task
}
