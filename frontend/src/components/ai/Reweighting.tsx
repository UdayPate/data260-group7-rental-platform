// "Change weights and rerun" and "Compared with the original run" (spec 13.6).
// Measured numbers (ranks, scores, weights) are kept apart from the agents' generated text.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { createAiRequest, getAiResult } from '../../api/ai'
import { errorMessage } from '../../api/client'
import { compareRuns, sameWeights, sharePercent, WEIGHT_HINTS, WEIGHT_LABELS } from '../../aiWeights'
import type { AiResult, AiTask, MatcherWeights } from '../../types/ai'
import { WEIGHT_KEYS } from '../../types/ai'
import ErrorBanner from '../ErrorBanner'

const heading = 'font-condensed text-lg font-bold tracking-[0.08em] uppercase'

// ---------- Change weights and rerun ----------

export function RerunPanel({ task, guestId }: { task: AiTask; guestId: string }) {
  const navigate = useNavigate()
  const [weights, setWeights] = useState<MatcherWeights>(task.weights)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unchanged = sameWeights(weights, task.weights)
  const allZero = WEIGHT_KEYS.every((k) => weights[k] === 0)

  async function rerun(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    setError(null)
    try {
      // Same request text, new weights, linked to this task (a full new debate, team decision W3a).
      const created = await createAiRequest({ guest_id: guestId, request_text: task.request_text, weights, parent_task_id: task.task_id })
      navigate(`/ai/tasks/${created.task_id}`)
    } catch (err) {
      setError(errorMessage(err))
      setSending(false)
    }
  }

  return (
    <form onSubmit={rerun} data-rerun-panel className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div>
        <h2 className={heading}>Change weights and rerun</h2>
        <p className="text-sm text-fg-muted">
          How much each measured part counts in the Matcher’s score. Each slider’s share of the total is shown in %. Listings that miss a
          must-have (guests, dates, budget, type, minimum rating) always rank below the ones that don’t.
        </p>
      </div>
      <div className="space-y-3">
        {WEIGHT_KEYS.map((key) => (
          <label key={key} className="grid grid-cols-[150px_1fr_110px] items-center gap-3 text-sm">
            <span>
              <span className="font-semibold">{WEIGHT_LABELS[key]}</span>
              <span className="block text-xs text-fg-muted">{WEIGHT_HINTS[key]}</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weights[key]}
              aria-label={WEIGHT_LABELS[key]}
              data-weight={key}
              onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
              className="accent-mustard"
            />
            <span className="text-right font-mono">
              {weights[key].toFixed(2)} <span className="text-fg-muted">({sharePercent(weights, key)}%)</span>
              {weights[key] !== task.weights[key] && <span className="block text-xs text-status-pending">was {task.weights[key].toFixed(2)}</span>}
            </span>
          </label>
        ))}
      </div>
      {allZero && <p className="text-sm text-status-error">At least one weight must be above 0.</p>}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={sending || unchanged || allZero}
          className="rounded-full bg-primary px-5 py-2 font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Starting…' : 'Rerun with these weights'}
        </button>
        <button type="button" onClick={() => setWeights(task.weights)} disabled={unchanged} className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">
          Reset
        </button>
        <span className="text-xs text-fg-muted">Starts a new debate with the same request; this one stays as it is.</span>
      </div>
    </form>
  )
}

// ---------- Compared with the original run ----------

function Movement({ moved, newRank }: { moved: number | null; newRank: number | null }) {
  if (moved === null) return <span className="text-fg-muted">{newRank === null ? 'left top 10' : 'new in top 10'}</span>
  if (moved === 0) return <span className="text-fg-muted">same</span>
  return <span className={moved > 0 ? 'text-status-ok' : 'text-status-error'}>{moved > 0 ? `up ${moved}` : `down ${-moved}`}</span>
}

export function RunComparison({ parentTaskId, rerun }: { parentTaskId: string; rerun: AiResult }) {
  const [original, setOriginal] = useState<AiResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    getAiResult(parentTaskId)
      .then((r) => {
        if (!ignore) setOriginal(r)
      })
      .catch((err: unknown) => {
        if (!ignore) setError(errorMessage(err))
      })
    return () => {
      ignore = true
    }
  }, [parentTaskId, attempt])

  if (error) {
    return (
      <ErrorBanner
        message={`Couldn’t load the original run: ${error}`}
        onRetry={() => {
          setError(null)
          setAttempt((n) => n + 1)
        }}
      />
    )
  }
  if (!original) return <p className="text-sm text-fg-muted">Loading the original run…</p>

  const c = compareRuns(original, rerun)
  const recommendationChanged = c.recommendedBefore !== c.recommendedAfter

  return (
    <section data-comparison className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div>
        <h2 className={heading}>Compared with the original run</h2>
        <p className="text-sm text-fg-muted">
          Original: <Link to={`/ai/tasks/${parentTaskId}`} className="font-mono text-primary hover:underline">{parentTaskId}</Link> · same request, different weights.
        </p>
      </div>

      {/* Measured: weights, rankings, scores */}
      <div data-measured className="space-y-3">
        <p className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Measured</p>
        <ul data-weight-changes className="text-sm">
          {c.changes.length === 0 && <li className="text-fg-muted">No weight changed.</li>}
          {c.changes.map((ch) => (
            <li key={ch.key}>
              {WEIGHT_LABELS[ch.key]}: <span className="font-mono">{ch.from.toFixed(2)} → {ch.to.toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <div data-recommendation-change className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            Matcher’s #1: <strong>{c.oldTop?.title ?? '—'}</strong> → <strong>{c.newTop?.title ?? '—'}</strong>
            {c.oldTop?.property_id === c.newTop?.property_id && <span className="text-fg-muted"> (unchanged)</span>}
          </p>
          <p>
            Recommended after the debate: <strong>{c.recommendedBefore ?? '—'}</strong> → <strong>{c.recommendedAfter ?? '—'}</strong>{' '}
            <span className={recommendationChanged ? 'text-status-pending' : 'text-fg-muted'}>({recommendationChanged ? 'changed' : 'unchanged'})</span>
          </p>
        </div>
        {c.cause && <p data-cause className="rounded-xl border border-line-strong p-3 text-sm text-fg-soft">{c.cause}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="font-condensed text-xs tracking-[0.08em] text-fg-muted uppercase">
              <tr>
                <th className="py-1 pr-3">Listing</th>
                <th className="py-1 pr-3 text-right">Original rank</th>
                <th className="py-1 pr-3 text-right">New rank</th>
                <th className="py-1 pr-3">Moved</th>
                <th className="py-1 text-right">Score (original → new)</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.property_id} data-row={r.property_id} className="border-t border-line">
                  <td className="py-1.5 pr-3">{r.title}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{r.oldRank ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{r.newRank ?? '—'}</td>
                  <td className="py-1.5 pr-3">
                    <Movement moved={r.moved} newRank={r.newRank} />
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {r.oldScore?.toFixed(2) ?? '—'} → {r.newScore?.toFixed(2) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generated: the agents' own words, never mixed with the numbers above */}
      <div data-generated className="rounded-xl border border-dashed border-line-strong p-3 text-sm">
        <p className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Generated explanation (written by the agents, not measured)</p>
        <p className="mt-1 text-fg-soft">{rerun.rationale}</p>
      </div>
    </section>
  )
}
