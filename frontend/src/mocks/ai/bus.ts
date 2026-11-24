// Mock "Kafka" for the AI debates: ONE shared in-memory stream that every debate in
// this tab publishes to (like the debate.round.* topics shared by all debates).
// Each WebSocket subscriber receives only events whose trace_id matches its task,
// the way a real consumer filters by the message key (spec 13.11, trace isolation).
import type { AiResult, AiTask, DemoOptions, EventPayloads, EventType, StreamEvent } from '../../types/ai'
import { planDebate } from './engine'

type TaskEntry = { task: AiTask; events: StreamEvent[]; result: AiResult | null }

type Subscriber = {
  traceId: string
  send: (event: StreamEvent) => void
  end: () => void // close the stream (debate finished)
}

// How long to wait after the last event before closing a finished stream.
export const CLOSE_DELAY_MS = 300

const tasks = new Map<string, TaskEntry>()
const subscribers = new Set<Subscriber>()
let taskCounter = 0

export const getTaskEntry = (taskId: string) => tasks.get(taskId)

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

// Creates a task and schedules its whole debate (events go out at their planned times).
export function startTask(guestId: string, requestText: string, demo: DemoOptions): AiTask {
  taskCounter += 1
  const taskId = `task_${String(taskCounter).padStart(3, '0')}`
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
    created_datetime: now,
    updated_datetime: now,
    error: null,
  }
  tasks.set(taskId, { task, events: [], result: null })
  publish(taskId, 'harness', 'task.status', { status: 'waiting', note: null })

  const script = planDebate(taskId, traceId, `plan_${String(taskCounter).padStart(3, '0')}`, requestText, demo)
  for (const item of script.timeline) {
    setTimeout(() => publish(taskId, item.actor, item.type, item.payload as never), item.at)
  }
  return task
}
