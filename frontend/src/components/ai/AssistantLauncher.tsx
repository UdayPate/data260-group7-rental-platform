// Floating AI assistant on guest pages (bottom-right). Not a chatbot: one request at a time.
//  - Round button with a tooltip (hover and keyboard focus) (D2a).
//  - Opens a small non-blocking panel (D3a) with the request box, prefilled from the
//    search filters on the search page (D4a).
//  - While the debate runs: agent chips + a "Now:" line; then a compact verdict with
//    Approve / Reject and "Open full debate" (D7a). Edit lives on the full page.
//  - A mustard dot on the button when the verdict is ready and the panel is closed (D8a).
// It is mounted once in the layout, so the current task survives page changes (D6a).
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { describeEvent, TASK_STATUS_TEXT } from '../../aiDebate'
import { approveAiResult, createAiRequest, rejectAiResult } from '../../api/ai'
import { errorMessage } from '../../api/client'
import { useCurrentUser } from '../../context/useCurrentUser'
import { AMENITY_LABELS, PROPERTY_TYPE_LABELS, formatPrice } from '../../labels'
import { isHostPath } from '../../mode'
import { useAiTask } from '../../realtime/useAiTask'
import { describeFiltersForAi, readFilters } from '../../searchFilters'
import ErrorBanner from '../ErrorBanner'
import { SparkleIcon } from '../icons'
import { AgentStrip } from './DebateParts'

function AssistantLauncher() {
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const { guestId } = useCurrentUser()

  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null) // the one request in progress
  const [verdictReady, setVerdictReady] = useState(false) // waiting for the guest's decision

  // Escape closes the panel (it doesn't block the page, so outside clicks don't).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Guest pages only, and not on the AI pages themselves (D1a), nor on Messages, where it
  // would sit on top of the message box. Returning null keeps this component (and its
  // state) alive, so the task is still here when you come back.
  const hidden = isHostPath(pathname) || pathname.startsWith('/ai') || pathname === '/guest/messages'
  if (hidden) return null

  const onSearchPage = pathname === '/'
  const filterText = onSearchPage ? describeFiltersForAi(readFilters(searchParams), PROPERTY_TYPE_LABELS, AMENITY_LABELS) : ''

  function toggle() {
    // Opening with an empty box on the search page: start from the current filters.
    if (!open && taskId === null && text === '' && filterText) setText(filterText)
    setOpen(!open)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    setError(null)
    try {
      const created = await createAiRequest({ guest_id: guestId, request_text: text.trim() })
      setTaskId(created.task_id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  function startOver() {
    setTaskId(null)
    setVerdictReady(false)
    setText(filterText)
    setError(null)
  }

  const tooltip = verdictReady ? 'Verdict ready' : 'Ask the AI assistant'

  return (
    <div className="fixed right-6 bottom-6 z-40 flex flex-col items-end gap-3">
      {/* The panel stays mounted while closed (just hidden), so the stream keeps running. */}
      <section
        id="ai-assistant-panel"
        aria-label="AI assistant"
        hidden={!open}
        className="max-h-[70vh] w-[380px] overflow-y-auto rounded-2xl border border-line-strong bg-surface p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-condensed text-lg font-bold tracking-[0.08em] uppercase">
            <SparkleIcon className="h-4 w-4 text-primary" /> AI assistant
          </h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close the AI assistant" className="rounded-full px-2 text-xl text-fg-muted hover:text-fg">
            ×
          </button>
        </div>

        {taskId === null ? (
          <form onSubmit={submit} className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={500}
              autoFocus
              aria-label="What are you looking for?"
              placeholder="e.g. 2 nights in San Jose for 2, under $250, parking, kitchen, rating ≥ 4.5"
              className="w-full rounded-2xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-mustard focus:outline-none"
            />
            {filterText && text !== filterText && (
              <button type="button" onClick={() => setText(filterText)} className="text-sm font-semibold text-primary hover:underline">
                Use my search filters
              </button>
            )}
            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
            <button
              type="submit"
              disabled={sending || text.trim() === ''}
              className="w-full rounded-full bg-primary py-2 font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? 'Starting…' : 'Ask the agents'}
            </button>
            <p className="text-xs text-fg-muted">The agents debate in the open. Nothing is booked without you.</p>
          </form>
        ) : (
          <TaskProgress key={taskId} taskId={taskId} guestId={guestId} onVerdictReady={setVerdictReady} onStartOver={startOver} />
        )}
      </section>

      {/* The round launcher button, with its tooltip on hover and keyboard focus. */}
      <div className="group relative">
        <button
          type="button"
          onClick={toggle}
          aria-label={tooltip}
          aria-expanded={open}
          aria-controls="ai-assistant-panel"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg hover:brightness-110 focus-visible:ring-2 focus-visible:ring-mustard focus-visible:outline-none"
        >
          <SparkleIcon className="h-7 w-7" />
        </button>
        {verdictReady && !open && (
          <span data-verdict-dot className="absolute top-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-bg bg-mustard" aria-hidden="true" />
        )}
        <span
          role="tooltip"
          className="pointer-events-none absolute top-1/2 right-full mr-3 -translate-y-1/2 rounded-full bg-cream px-3 py-1 text-sm font-semibold whitespace-nowrap text-cream-ink opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {tooltip}
        </span>
      </div>
    </div>
  )
}

// ---------- The compact live view of one task ----------

type ProgressProps = {
  taskId: string
  guestId: string
  onVerdictReady: (ready: boolean) => void
  onStartOver: () => void
}

function TaskProgress({ taskId, guestId, onVerdictReady, onStartOver }: ProgressProps) {
  const { task, events, view, result, decision, status, loadError, retryLoad, setDecidedResult } = useAiTask(taskId)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tell the launcher when a verdict is waiting for the guest (for the dot on the button).
  const waiting = result !== null && result.recommended !== null && decision === null
  useEffect(() => {
    onVerdictReady(waiting)
  }, [waiting, onVerdictReady])

  async function decide(action: 'approve' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      const updated =
        action === 'approve'
          ? await approveAiResult(taskId, { guest_id: guestId })
          : await rejectAiResult(taskId, { guest_id: guestId, reason: reason.trim() })
      setDecidedResult(updated)
      setRejecting(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const fullLink = (
    <Link to={`/ai/tasks/${taskId}`} className="text-sm font-semibold text-primary hover:underline">
      Open full debate →
    </Link>
  )
  const newRequest = (
    <button type="button" onClick={onStartOver} className="text-sm font-semibold text-fg-muted hover:text-fg">
      New request
    </button>
  )

  if (loadError) {
    return (
      <div className="space-y-3">
        <ErrorBanner message={loadError} onRetry={retryLoad} />
        {newRequest}
      </div>
    )
  }
  if (!task) return <p className="text-sm text-fg-muted">Starting the debate…</p>

  const last = events.length > 0 ? events.reduce((a, b) => (b.seq > a.seq ? b : a)) : null
  const rec = result?.recommended ?? null
  const topRisk = result?.risks.find((r) => r.severity === 'high') ?? result?.risks.find((r) => r.severity === 'medium')
  const finished = status === 'completed' || status === 'failed' || status === 'timed_out'

  // Booking link with the parsed dates and guests (nothing is booked automatically).
  const bookParams = new URLSearchParams()
  if (result?.check_in) bookParams.set('check_in', result.check_in)
  if (result?.check_out) bookParams.set('check_out', result.check_out)
  if (result?.guest_count) bookParams.set('guests', String(result.guest_count))
  const bookId = decision?.edited_property_id ?? rec?.property_id

  return (
    <div className="space-y-3 text-sm">
      <p className="line-clamp-2 text-fg-soft">“{task.request_text}”</p>
      <p className="flex flex-wrap items-center gap-x-2">
        <span data-assistant-status={status} className="font-condensed font-bold tracking-[0.08em] text-mustard uppercase">
          {TASK_STATUS_TEXT[status]}
        </span>
        <span className="font-mono text-xs text-fg-muted" title={task.trace_id}>
          trace {task.trace_id.slice(0, 8)}
        </span>
      </p>

      <AgentStrip agents={view.agents} />

      {last && !result && (
        <p data-assistant-now className="text-fg-soft">
          <span className="text-fg-muted">Now: </span>
          {describeEvent(last)}
        </p>
      )}
      {view.rejectedOutputs.map((r) => (
        <p key={r.seq} className="text-status-error">Harness rejected one {r.agent} output and asked it to retry.</p>
      ))}
      {view.timeouts.map((t) => (
        <p key={t.seq} className="text-status-error">The {t.agent} agent timed out; the debate continued without it.</p>
      ))}

      {/* ---------- Compact verdict ---------- */}
      {result && (
        <div data-assistant-verdict className="space-y-2 rounded-xl border-2 border-mustard bg-verdict p-3">
          {rec ? (
            <>
              <p className="font-condensed text-lg font-bold">{rec.title}</p>
              <p className="text-fg-soft">
                {formatPrice(rec.nightly_price)} / night · confidence <span className="font-mono">{Math.round(result.confidence * 100)}%</span>
                {!result.consensus && <span className="text-status-pending"> · no consensus</span>}
              </p>
              <p className="line-clamp-2 text-fg-soft">{result.rationale}</p>
              {topRisk && (
                <p className="line-clamp-2">
                  <span className="font-semibold text-status-pending uppercase">{topRisk.severity} risk</span> {topRisk.text}
                </p>
              )}
              {result.dissent_note && <p className="line-clamp-2 text-fg-muted">Dissent: {result.dissent_note}</p>}
            </>
          ) : (
            <>
              <p className="font-condensed text-lg font-bold">No match</p>
              <p className="text-fg-soft">{result.rationale}</p>
            </>
          )}

          {decision && (
            <div role="status" className={decision.decision === 'rejected' ? 'text-status-error' : 'text-status-ok'}>
              <p className="font-semibold">
                {decision.decision === 'rejected' ? 'You rejected it.' : decision.decision === 'edited' ? 'You approved it with edits.' : 'You approved it.'}
              </p>
              {decision.decision !== 'rejected' && bookId && (
                <Link
                  to={`/properties/${bookId}?${bookParams.toString()}`}
                  className="mt-1 inline-block rounded-full bg-primary px-4 py-1.5 font-semibold text-on-primary hover:brightness-110"
                >
                  Request to book
                </Link>
              )}
            </div>
          )}

          {!decision && rec && !rejecting && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => decide('approve')}
                disabled={busy}
                className="rounded-full bg-primary px-4 py-1.5 font-semibold text-on-primary hover:brightness-110 disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                className="rounded-full border border-status-error-border px-4 py-1.5 font-semibold text-status-error"
              >
                Reject
              </button>
            </div>
          )}

          {!decision && rejecting && (
            <div className="space-y-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label="Why are you rejecting it?"
                placeholder="Why are you rejecting it?"
                className="w-full rounded-full border border-line bg-surface-2 px-3 py-1.5 text-fg placeholder:text-fg-muted focus:border-mustard focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => decide('reject')}
                  disabled={busy || reason.trim() === ''}
                  className="rounded-full bg-status-error px-4 py-1.5 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Reject'}
                </button>
                <button type="button" onClick={() => setRejecting(false)} className="rounded-full border border-line-strong px-4 py-1.5 font-semibold">
                  Back
                </button>
              </div>
            </div>
          )}

          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        {fullLink}
        {/* One request at a time: a new one only once there's a verdict or the task ended. */}
        {(result || finished) && newRequest}
      </div>
    </div>
  )
}

export default AssistantLauncher
