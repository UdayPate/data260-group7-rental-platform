// Follows one AI task live. Used by the full debate page and the floating assistant.
// 1. GET /ai/tasks/{id} loads the task and every event so far (history).
// 2. The WebSocket stream then sends what comes after the last seq we have.
// Everything shown is rebuilt from the event list by buildDebateView().
//
// The component using this should be keyed by taskId (key={taskId}), so a different
// task starts with fresh state.
import { useEffect, useMemo, useState } from 'react'
import { buildDebateView } from '../aiDebate'
import { getAiTask } from '../api/ai'
import { errorMessage } from '../api/client'
import type { AiResult, AiTask, StreamEvent, TaskStatus } from '../types/ai'
import { openAiStream, type StreamStatus } from './aiStream'

export function useAiTask(taskId: string) {
  // What the first GET returned. The stream starts after its last event.
  const [loaded, setLoaded] = useState<{ task: AiTask; events: StreamEvent[] } | null>(null)
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting')
  const [streamAttempt, setStreamAttempt] = useState(0) // bumped by reconnect()
  const [latencies, setLatencies] = useState<number[]>([]) // ms, live events only
  const [foreign, setForeign] = useState(0) // events from another trace that were dropped
  const [decidedResult, setDecidedResult] = useState<AiResult | null>(null) // from the approve/reject response

  // 1. History
  useEffect(() => {
    let ignore = false
    getAiTask(taskId)
      .then((data) => {
        if (ignore) return
        setLoaded(data)
        setEvents(data.events)
      })
      .catch((err: unknown) => {
        if (!ignore) setLoadError(errorMessage(err))
      })
    return () => {
      ignore = true
    }
  }, [taskId, attempt])

  // 2. Live stream, after the history is in.
  useEffect(() => {
    if (!loaded) return
    const lastSeq = loaded.events.reduce((max, e) => Math.max(max, e.seq), 0)
    const close = openAiStream({
      taskId,
      traceId: loaded.task.trace_id,
      afterSeq: lastSeq,
      onEvent: (event, receivedAt) => {
        setEvents((previous) => (previous.some((p) => p.seq === event.seq) ? previous : [...previous, event]))
        setLatencies((previous) => [...previous, receivedAt - Date.parse(event.timestamp)])
      },
      onStatus: setStreamStatus,
      onForeignEvent: () => setForeign((n) => n + 1),
    })
    return close // closes the socket when the component goes away
  }, [loaded, taskId, streamAttempt])

  const view = useMemo(() => buildDebateView(events), [events])

  const task = loaded?.task ?? null
  const result = decidedResult ?? view.result
  const decision = view.decision ?? result?.human_decision ?? null
  // A recorded decision means the task is completed, even if that status event hasn't arrived yet.
  const streamedStatus = view.status ?? task?.status ?? 'waiting'
  const status: TaskStatus = decision && streamedStatus === 'waiting_for_approval' ? 'completed' : streamedStatus

  return {
    task, // null until the history has loaded
    events,
    view,
    result,
    decision,
    status,
    loadError,
    retryLoad: () => {
      setLoadError(null)
      setAttempt((n) => n + 1)
    },
    streamStatus,
    reconnect: () => setStreamAttempt((n) => n + 1),
    latencies,
    foreign,
    setDecidedResult, // call with the result returned by approve/reject
  }
}
