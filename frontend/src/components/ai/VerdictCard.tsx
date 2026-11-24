// The chair's final verdict (mustard-outlined card) with the human-in-the-loop step:
// Approve, Edit (pick another candidate and/or rewrite the explanation, U2a), or Reject.
// Approving never books anything: it only links to the booking page (U3a).
import { useState } from 'react'
import { Link } from 'react-router'
import { AGENT_LABELS, AGENT_TEXT } from '../../agents'
import { approveAiResult, rejectAiResult } from '../../api/ai'
import { errorMessage } from '../../api/client'
import { formatPrice } from '../../labels'
import type { AiResult, HumanDecision } from '../../types/ai'
import ErrorBanner from '../ErrorBanner'

type Props = {
  taskId: string
  guestId: string
  result: AiResult
  decision: HumanDecision | null
  canAct: boolean // false when viewing another guest's task
  onDecided: (result: AiResult) => void
}

const SEVERITY_CLASS = { high: 'text-status-error', medium: 'text-status-pending', low: 'text-fg-muted' }
const labelClass = 'font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase'
const boxClass = 'w-full rounded-2xl border border-line bg-surface-2 px-4 py-2 text-fg focus:border-mustard focus:outline-none'

function VerdictCard({ taskId, guestId, result, decision, canAct, onDecided }: Props) {
  const [mode, setMode] = useState<'idle' | 'edit' | 'reject'>('idle')
  const [pickedId, setPickedId] = useState(result.recommended?.property_id ?? '')
  const [rationale, setRationale] = useState(result.rationale)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rec = result.recommended
  const titleOf = (id: string) => result.ranked.find((r) => r.property_id === id)?.title ?? id

  async function send(action: 'approve' | 'edit' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      let updated: AiResult
      if (action === 'approve') updated = await approveAiResult(taskId, { guest_id: guestId })
      else if (action === 'edit') {
        updated = await approveAiResult(taskId, {
          guest_id: guestId,
          edits: { property_id: pickedId, rationale: rationale.trim() },
          reason: reason.trim() || undefined,
        })
      } else updated = await rejectAiResult(taskId, { guest_id: guestId, reason: reason.trim() })
      setMode('idle')
      onDecided(updated)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Booking link for the approved (or edited) stay, with the parsed dates and guests.
  const bookId = decision?.edited_property_id ?? rec?.property_id
  const bookParams = new URLSearchParams()
  if (result.check_in) bookParams.set('check_in', result.check_in)
  if (result.check_out) bookParams.set('check_out', result.check_out)
  if (result.guest_count) bookParams.set('guests', String(result.guest_count))

  const editChanged = pickedId !== rec?.property_id || rationale.trim() !== result.rationale

  return (
    <section data-verdict className="space-y-4 rounded-2xl border-2 border-mustard bg-verdict p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-condensed text-xl font-bold tracking-[0.08em] text-mustard uppercase">Final verdict</h2>
        <span className="text-sm text-fg-soft">
          {result.consensus ? 'Consensus' : 'No consensus — decision rule applied'} · confidence{' '}
          <span className="font-mono">{Math.round(result.confidence * 100)}%</span>
        </span>
      </div>

      {rec ? (
        <div>
          <p className="font-display text-2xl font-bold">{rec.title}</p>
          <p className="text-fg-soft">
            {rec.city} · {formatPrice(rec.nightly_price)} / night · <span className="font-mono">{rec.property_id}</span>
          </p>
        </div>
      ) : (
        <p className="font-display text-2xl font-bold">No recommendation</p>
      )}

      <p className="text-fg-soft">{result.rationale}</p>

      {result.suggestions.length > 0 && (
        <ul className="list-disc pl-5 text-fg-soft">
          {result.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}

      {/* Measured evidence, kept separate from the generated explanation above (spec 13.6). */}
      {result.evidence.length > 0 && (
        <div>
          <p className={labelClass}>Evidence (measured)</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {result.evidence.map((e) => (
              <li key={e.fact}>
                <span className="font-mono">{e.fact}</span> <span className="text-fg-muted">— {e.source}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.risks.length > 0 && (
        <div>
          <p className={labelClass}>Risks and limitations</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {result.risks.map((r) => (
              <li key={r.text}>
                <span className={`font-semibold uppercase ${SEVERITY_CLASS[r.severity]}`}>{r.severity}</span> {r.text}{' '}
                <span className={`text-xs ${AGENT_TEXT[r.source_agent]}`}>({AGENT_LABELS[r.source_agent]})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.comparison && (
        <div>
          <p className={labelClass}>Why not {result.comparison.rejected_title}?</p>
          <p className="text-sm text-fg-soft">{result.comparison.why_lower}</p>
        </div>
      )}

      {(result.dissent_note || result.decision_rule) && (
        <div className="rounded-xl border border-line-strong p-3 text-sm">
          {result.dissent_note && (
            <p>
              <span className="font-semibold">Dissent: </span>
              {result.dissent_note}
            </p>
          )}
          {result.decision_rule && <p className="mt-1 text-fg-muted">Decision rule: {result.decision_rule}</p>}
        </div>
      )}

      {/* ---------- Human decision ---------- */}
      {decision && (
        <div role="status" className={`rounded-xl border p-3 ${decision.decision === 'rejected' ? 'border-status-error-border text-status-error' : 'border-status-ok text-status-ok'}`}>
          <p className="font-semibold">
            {/* "You" for the guest who asked; "The guest" when someone else is viewing. */}
            {decision.decision === 'approved' && `${canAct ? 'You' : 'The guest'} approved this recommendation.`}
            {decision.decision === 'edited' &&
              `${canAct ? 'You' : 'The guest'} approved it with edits${decision.edited_property_id ? `: picked ${titleOf(decision.edited_property_id)}` : ''}.`}
            {decision.decision === 'rejected' && `${canAct ? 'You' : 'The guest'} rejected this recommendation.`}
          </p>
          {decision.reason && <p className="text-sm">Reason: {decision.reason}</p>}
          {decision.edited_rationale && <p className="text-sm">Your explanation: {decision.edited_rationale}</p>}
          {decision.decision !== 'rejected' && bookId && canAct && (
            <Link
              to={`/properties/${bookId}?${bookParams.toString()}`}
              className="mt-2 inline-block rounded-full bg-primary px-5 py-2 font-semibold text-on-primary hover:brightness-110"
            >
              Request to book {titleOf(bookId)}
            </Link>
          )}
          {decision.decision !== 'rejected' && (
            <p className="mt-1 text-xs text-fg-muted">Nothing has been booked. Sending the request is up to you.</p>
          )}
        </div>
      )}

      {!decision && rec && !canAct && (
        <p className="text-sm text-fg-muted">This request belongs to another guest. Only they can approve or reject it.</p>
      )}

      {!decision && rec && canAct && mode === 'idle' && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => send('approve')}
            disabled={busy}
            className="rounded-full bg-primary px-6 py-2.5 font-semibold text-on-primary hover:brightness-110 disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Approve'}
          </button>
          <button type="button" onClick={() => setMode('edit')} className="rounded-full border border-line-strong px-6 py-2.5 font-semibold hover:bg-surface">
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode('reject')}
            className="rounded-full border border-status-error-border px-6 py-2.5 font-semibold text-status-error hover:bg-surface"
          >
            Reject
          </button>
        </div>
      )}

      {!decision && canAct && mode === 'edit' && (
        <div className="space-y-3 rounded-xl border border-line-strong p-4">
          <p className={labelClass}>Pick the stay</p>
          <div className="space-y-1">
            {result.ranked.map((r) => (
              <label key={r.property_id} className="flex items-center gap-2 text-sm">
                <input type="radio" name="pick" checked={pickedId === r.property_id} onChange={() => setPickedId(r.property_id)} className="accent-primary" />
                {r.title} <span className="text-fg-muted">· {formatPrice(r.nightly_price)} · score {r.score.toFixed(2)}</span>
              </label>
            ))}
          </div>
          <label className="block space-y-1">
            <span className={labelClass}>Explanation</span>
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={4} className={boxClass} />
          </label>
          <label className="block space-y-1">
            <span className={labelClass}>Why are you changing it? (optional)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={`${boxClass} rounded-full`} />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => send('edit')}
              disabled={busy || !editChanged}
              className="rounded-full bg-primary px-5 py-2 font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Approve with edits'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="rounded-full border border-line-strong px-5 py-2 font-semibold">
              Back
            </button>
          </div>
          {!editChanged && <p className="text-sm text-fg-muted">Change the stay or the explanation to approve with edits.</p>}
        </div>
      )}

      {!decision && canAct && mode === 'reject' && (
        <div className="space-y-3 rounded-xl border border-status-error-border p-4">
          <label className="block space-y-1">
            <span className={labelClass}>Why are you rejecting it?</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={boxClass} />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => send('reject')}
              disabled={busy || reason.trim() === ''}
              className="rounded-full bg-status-error px-5 py-2 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Reject'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="rounded-full border border-line-strong px-5 py-2 font-semibold">
              Back
            </button>
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    </section>
  )
}

export default VerdictCard
