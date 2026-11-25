// "Versions and feedback" on the admin AI dashboard (spec 7.5.4 and 7.5.5):
//  - feedback: every human decision (trace_id, recommendation, decision, reason) plus labelled samples
//  - matcher versions side by side with the baseline; nothing is promoted automatically
//  - Promote / Roll back by the admin, with a confirm step, and a history of who did it and when
import { useEffect, useState } from 'react'
import { getAiFeedback, getMatcherVersions, promoteMatcherVersion, rollbackMatcherVersion } from '../../api/ai'
import { errorMessage } from '../../api/client'
import { describeWeights } from '../../aiWeights'
import { formatDateTime } from '../../dates'
import type { FeedbackItem, MatcherVersion, VersionEvaluation, VersionsResponse } from '../../types/ai'
import ErrorBanner from '../ErrorBanner'

const heading = 'font-condensed text-lg font-bold tracking-[0.08em] uppercase'
const sampleChip = (
  <span className="rounded-full border border-line-strong px-2 py-0.5 font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Sample</span>
)

const DECISION_STYLE: Record<FeedbackItem['decision'], string> = {
  approved: 'text-status-ok',
  edited: 'text-status-pending',
  rejected: 'text-status-error',
}

function Metrics({ e }: { e: VersionEvaluation }) {
  return (
    <dl className="grid grid-cols-4 gap-2 text-center">
      {[
        ['P@10', e.precision_at_10.toFixed(2)],
        ['R@10', e.recall_at_10.toFixed(2)],
        ['Mean rank', e.mean_rank.toFixed(1)],
        ['Avg latency', e.avg_latency_ms >= 1000 ? `${(e.avg_latency_ms / 1000).toFixed(1)} s` : `${e.avg_latency_ms} ms`],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="font-condensed text-xs tracking-[0.08em] text-fg-muted uppercase">{label}</dt>
          <dd className="font-condensed text-2xl font-bold">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function VersionsPanel() {
  const [versions, setVersions] = useState<VersionsResponse | null>(null)
  const [feedback, setFeedback] = useState<FeedbackItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [confirming, setConfirming] = useState<{ version: MatcherVersion; action: 'promote' | 'rollback' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    Promise.all([getMatcherVersions(), getAiFeedback()])
      .then(([v, f]) => {
        if (ignore) return
        setVersions(v)
        setFeedback(f.items)
      })
      .catch((err: unknown) => {
        if (!ignore) setError(errorMessage(err))
      })
    return () => {
      ignore = true
    }
  }, [attempt])

  async function confirm() {
    if (!confirming) return
    setBusy(true)
    setActionError(null)
    try {
      const id = confirming.version.version_id
      setVersions(confirming.action === 'promote' ? await promoteMatcherVersion(id) : await rollbackMatcherVersion(id))
      setConfirming(null)
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <ErrorBanner
        message={`Couldn’t load versions and feedback: ${error}`}
        onRetry={() => {
          setError(null)
          setAttempt((n) => n + 1)
        }}
      />
    )
  }
  if (!versions || !feedback) return <p className="text-fg-muted">Loading versions and feedback…</p>

  const activeIndex = versions.versions.findIndex((v) => v.version_id === versions.active_version_id)
  const last = versions.history.at(-1)

  return (
    <section data-versions className="space-y-6">
      <h2 className="font-condensed text-2xl font-bold tracking-[0.06em] uppercase">Versions and feedback</h2>

      {/* ---------- Versions ---------- */}
      <div className="space-y-2">
        <p className="text-sm text-fg-muted">
          A change to the Matcher becomes a new version; the old one is kept for rollback. Nothing is promoted automatically: only the admin
          can, after comparing the evaluation numbers. {versions.evaluation_sample && <>Evaluation numbers are {sampleChip} values until the team’s evaluation run.</>}
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {versions.versions.map((v, i) => {
            const active = i === activeIndex
            const action = i > activeIndex ? 'promote' : 'rollback'
            return (
              <article key={v.version_id} data-version={v.version_id} className={`space-y-3 rounded-2xl border bg-surface p-4 ${active ? 'border-mustard' : 'border-line'}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-mono text-lg">{v.version_id}</h3>
                  <span data-version-status className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${active ? 'border-mustard text-mustard' : 'border-line-strong text-fg-muted'}`}>
                    {active ? 'Active' : i > activeIndex ? 'Proposed' : 'Previous (kept for rollback)'}
                  </span>
                </div>
                <p className="text-sm text-fg-soft">{v.change}</p>
                <p className="font-mono text-xs text-fg-muted">{describeWeights(v.weights)}</p>
                {v.based_on_feedback_ids.length > 0 && <p className="text-xs text-fg-muted">From feedback: {v.based_on_feedback_ids.join(', ')}</p>}
                <Metrics e={v.evaluation} />
                {!active && (
                  <button
                    type="button"
                    onClick={() => setConfirming({ version: v, action })}
                    className="rounded-full border border-line-strong px-4 py-1.5 text-sm font-semibold hover:bg-surface-2"
                  >
                    {action === 'promote' ? `Promote ${v.version_id}` : `Roll back to ${v.version_id}`}
                  </button>
                )}
              </article>
            )
          })}
          <article data-version="baseline" className="space-y-3 rounded-2xl border border-dashed border-line-strong bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">{versions.baseline.name}</h3>
              <span className="text-xs text-fg-muted">for comparison</span>
            </div>
            <p className="text-sm text-fg-soft">Ranks by how many filters a listing passes; no agents, no debate.</p>
            <Metrics e={versions.baseline} />
          </article>
        </div>

        {confirming && (
          <div data-confirm role="alertdialog" className="space-y-2 rounded-2xl border border-status-pending p-4">
            <p className="text-status-pending">
              {confirming.action === 'promote'
                ? `Make ${confirming.version.version_id} the active Matcher for every new debate? Debates already running keep their version.`
                : `Roll back to ${confirming.version.version_id} for every new debate?`}
            </p>
            {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={confirm} className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary disabled:opacity-50">
                {busy ? 'Saving…' : confirming.action === 'promote' ? 'Yes, promote' : 'Yes, roll back'}
              </button>
              <button type="button" onClick={() => setConfirming(null)} className="rounded-full border border-line-strong px-4 py-1.5 text-sm font-semibold">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div data-version-history className="text-sm text-fg-muted">
          {last ? (
            <p>
              {last.action === 'promote' ? 'Promoted' : 'Rolled back to'} <span className="font-mono">{last.version_id}</span> by {last.by_name} (
              <span className="font-mono">{last.by_id}</span>) on {formatDateTime(last.at)}.
              {versions.history.length > 1 && ` ${versions.history.length} changes in total.`}
            </p>
          ) : (
            <p>No promotions yet: matcher-v1 has been active since the start.</p>
          )}
        </div>
      </div>

      {/* ---------- Feedback ---------- */}
      <div className="space-y-2">
        <h3 className={heading}>Feedback ({feedback.length})</h3>
        <p className="text-sm text-fg-muted">Every guest decision on a recommendation, with its trace_id. Sample entries are labelled.</p>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table data-feedback className="w-full text-left text-sm">
            <thead className="font-condensed text-xs tracking-[0.08em] text-fg-muted uppercase">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">trace_id</th>
                <th className="px-3 py-2">Recommended</th>
                <th className="px-3 py-2">Decision</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">What happened</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((f) => (
                <tr key={f.feedback_id} data-feedback-id={f.feedback_id} className="border-t border-line align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(f.decided_datetime)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {f.trace_id.slice(0, 12)}
                    {f.trace_id.length > 12 && '…'} {f.sample && sampleChip}
                  </td>
                  <td className="px-3 py-2">{f.recommended_title ?? '—'}</td>
                  <td className={`px-3 py-2 font-semibold ${DECISION_STYLE[f.decision]}`}>{f.decision}</td>
                  <td className="px-3 py-2 text-fg-soft">{f.reason ?? '—'}</td>
                  <td className="px-3 py-2" data-outcome={f.outcome ?? ''}>
                    {f.outcome === 'led_to_version' && (
                      <span>
                        <span className="font-semibold text-status-ok">Led to {f.outcome_version}</span>
                        <span className="block text-xs text-fg-muted">{f.outcome_reason}</span>
                      </span>
                    )}
                    {f.outcome === 'rejected' && (
                      <span>
                        <span className="font-semibold text-status-error">Rejected: insufficient or unreliable</span>
                        <span className="block text-xs text-fg-muted">{f.outcome_reason}</span>
                      </span>
                    )}
                    {f.outcome === null && <span className="text-fg-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default VersionsPanel
