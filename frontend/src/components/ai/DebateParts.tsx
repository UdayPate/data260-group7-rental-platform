// Pieces of the live debate view (U1a). Each one only displays data it is given.
import { useEffect, useState, type ReactNode } from 'react'
import { AGENT_BORDER, AGENT_LABELS, AGENT_TEXT } from '../../agents'
import type { AgentState, Challenge, DebateView } from '../../aiDebate'
import type { AgentId, Plan, PlanStepStatus } from '../../types/ai'

const roundTitleClass = 'font-condensed text-xl font-bold tracking-[0.08em] uppercase'

export function RoundHeading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <h2 className={roundTitleClass}>{children}</h2>
      {sub && <span className="text-sm text-fg-muted">{sub}</span>}
    </div>
  )
}

// ---------- Agent status strip ----------

const STATE_TEXT: Record<AgentState, string> = {
  waiting: 'Waiting',
  working: 'Working…',
  published: 'Published',
  challenged: 'Challenged',
  answered: 'Answered',
  voted: 'Voted',
  timed_out: 'Timed out',
  done: 'Done',
}

export function AgentStrip({ agents }: { agents: Record<AgentId, AgentState> }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Agent status">
      {(Object.keys(agents) as AgentId[]).map((agent) => {
        const state = agents[agent]
        return (
          <li
            key={agent}
            data-agent={agent}
            data-state={state}
            className={`flex items-center gap-2 rounded-full border bg-surface px-3 py-1.5 text-sm ${
              state === 'timed_out' ? 'border-status-error-border' : AGENT_BORDER[agent]
            } ${state === 'waiting' ? 'opacity-60' : ''}`}
          >
            <span className={`font-semibold ${AGENT_TEXT[agent]}`}>{AGENT_LABELS[agent]}</span>
            <span className={state === 'timed_out' ? 'text-status-error' : 'text-fg-muted'}>{STATE_TEXT[state]}</span>
          </li>
        )
      })}
    </ul>
  )
}

// ---------- Plan ----------

const STEP_MARK: Record<PlanStepStatus, string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
  skipped: '–',
  failed: '✕',
}

export function PlanPanel({ plan }: { plan: Plan | null }) {
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-condensed text-lg font-bold tracking-[0.08em] uppercase">Plan</h2>
        {plan && <span className="font-mono text-xs text-fg-muted">{plan.plan_id}</span>}
      </div>
      {!plan && <p className="text-sm text-fg-muted">The chair is writing the plan…</p>}
      <ol className="space-y-2">
        {plan?.steps.map((s) => (
          <li key={s.step_id} data-step={s.step_id} data-status={s.status} className="text-sm">
            <div className="flex gap-2">
              <span
                aria-hidden="true"
                className={s.status === 'done' ? 'text-status-ok' : s.status === 'in_progress' ? 'text-mustard' : s.status === 'failed' ? 'text-status-error' : 'text-fg-muted'}
              >
                {STEP_MARK[s.status]}
              </span>
              <div>
                <p className={s.status === 'pending' ? 'text-fg-muted' : ''}>
                  {s.order}. {s.title} <span className={`text-xs ${AGENT_TEXT[s.agent]}`}>({AGENT_LABELS[s.agent]})</span>
                  <span className="sr-only"> — {s.status}</span>
                </p>
                {s.note && <p className="text-xs text-fg-muted">{s.note}</p>}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ---------- Round 0 ----------

export function OpinionCard({ opinion, reflection }: { opinion: DebateView['opinions'][number]; reflection?: DebateView['reflections'][number] }) {
  return (
    <article data-opinion={opinion.agent} className={`space-y-3 rounded-2xl border border-t-4 bg-surface p-4 ${AGENT_BORDER[opinion.agent]}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={`font-condensed text-lg font-bold ${AGENT_TEXT[opinion.agent]}`}>{AGENT_LABELS[opinion.agent]}</h3>
        <span className="font-mono text-sm text-fg-soft">{Math.round(opinion.confidence * 100)}% sure</span>
      </div>
      <ol className="space-y-2">
        {opinion.ranked.slice(0, 3).map((r, i) => (
          <li key={r.property_id} className="text-sm">
            <p>
              <span className="font-mono text-fg-muted">#{i + 1}</span> <span className="font-semibold">{r.title}</span>{' '}
              <span className="font-mono text-fg-muted">{r.score.toFixed(2)}</span>
            </p>
            <p className="text-xs text-fg-muted">{r.reasons.join(' · ')}</p>
          </li>
        ))}
      </ol>
      <p className="text-sm text-fg-soft">{opinion.reasoning}</p>
      {reflection && (
        <div className="rounded-xl bg-surface-2 p-2 text-xs">
          <p className="font-semibold text-fg-soft">
            Reflection (check {reflection.cycle}): <span className="uppercase">{reflection.decision}</span>
          </p>
          {Object.entries(reflection.checks)
            .filter(([, c]) => c.result === 'concern')
            .map(([name, c]) => (
              <p key={name} className="text-status-pending">
                {name} concern: {c.note}
              </p>
            ))}
        </div>
      )}
    </article>
  )
}

export function WaitingCard({ agent, text }: { agent: AgentId; text: string }) {
  return (
    <div className={`rounded-2xl border border-dashed p-4 text-sm text-fg-muted ${AGENT_BORDER[agent]}`}>
      <span className={AGENT_TEXT[agent]}>{AGENT_LABELS[agent]}</span> — {text}
    </div>
  )
}

export function RejectedOutputCard({ item }: { item: DebateView['rejectedOutputs'][number] }) {
  return (
    <div role="status" className="space-y-1 rounded-2xl border border-status-error-border bg-surface p-4 text-sm">
      <p className="font-semibold text-status-error">
        Harness rejected the {AGENT_LABELS[item.agent]}’s output ({item.action === 'retry' ? 'asked it to retry' : 'dropped'})
      </p>
      <p className="text-fg-soft">{item.reason}</p>
      <p className="font-mono text-xs text-fg-muted">invalid: {item.invalid_fields.join(', ')}</p>
    </div>
  )
}

// ---------- Rounds 1 and 2 ----------

// Round 1: the chair's challenge, on a cream card (CLAUDE.md).
export function ChallengeCard({ challenge, titleOf }: { challenge: Challenge; titleOf: (id: string) => string }) {
  return (
    <div data-challenge={challenge.challenge_id} className="rounded-2xl border border-cream-border bg-cream p-4 text-cream-ink">
      <p className="font-condensed text-sm font-bold tracking-[0.08em] uppercase">
        Chair → <span>{AGENT_LABELS[challenge.to_agent]}</span>
        {challenge.about_property_id && <span className="text-cream-ink-soft"> · about {titleOf(challenge.about_property_id)}</span>}
        <span className="font-mono text-cream-ink-soft"> · {challenge.challenge_id}</span>
      </p>
      <p className="mt-1">{challenge.question}</p>
    </div>
  )
}

// Round 2: the challenged agent's answer, with its evidence.
export function AnswerCard({ challenge }: { challenge: Challenge }) {
  if (!challenge.answer) return null
  return (
    <div data-answer={challenge.challenge_id} className={`rounded-2xl border-l-4 bg-surface p-4 text-sm ${AGENT_BORDER[challenge.to_agent]}`}>
      <p className={`font-semibold ${AGENT_TEXT[challenge.to_agent]}`}>
        {AGENT_LABELS[challenge.to_agent]} answers <span className="font-mono text-xs text-fg-muted">re: {challenge.challenge_id}</span>
      </p>
      <p className="text-fg-soft">{challenge.answer.answer}</p>
      {challenge.answer.evidence.length > 0 && (
        <ul className="mt-1 list-disc pl-5 font-mono text-xs text-fg-muted">
          {challenge.answer.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

const VOTE_TEXT = { keep: 'keeps', switch: 'switches to', abstain: 'abstains' }

export function VoteList({ votes, titleOf }: { votes: DebateView['votes']; titleOf: (id: string) => string }) {
  if (votes.length === 0) return null
  return (
    <ul className="space-y-2">
      {votes.map((v) => (
        <li key={v.seq} data-vote={v.agent} className="rounded-xl border border-line bg-surface px-4 py-2 text-sm">
          <span className={`font-semibold ${AGENT_TEXT[v.agent]}`}>{AGENT_LABELS[v.agent]}</span> votes:{' '}
          <span className="font-semibold">
            {VOTE_TEXT[v.vote]} {v.property_id ? titleOf(v.property_id) : ''}
          </span>
          <span className="text-fg-muted"> — {v.reason}</span>
        </li>
      ))}
    </ul>
  )
}

export function TimeoutCard({ item }: { item: DebateView['timeouts'][number] }) {
  return (
    <div role="status" className="space-y-1 rounded-2xl border border-status-error-border bg-surface p-4 text-sm">
      <p className="font-semibold text-status-error">
        {AGENT_LABELS[item.agent]} timed out in round {item.round} (deadline {item.deadline_ms / 1000} s)
      </p>
      <p className="text-fg-soft">{item.reason}</p>
      <p className="text-fg-muted">{item.fallback}</p>
    </div>
  )
}

// Live "deadline in N s" while agents still owe an answer. Ticks twice a second.
export function DeadlineCountdown({ startedAt, deadlineMs, pending }: { startedAt: string; deadlineMs: number; pending: AgentId[] }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer) // stop ticking when this goes away
  }, [])
  const left = Math.max(0, Math.ceil((Date.parse(startedAt) + deadlineMs - now) / 1000))
  return (
    <p className="text-sm text-status-pending" role="timer">
      Round deadline in {left} s — waiting for {pending.map((a) => AGENT_LABELS[a]).join(', ')}
    </p>
  )
}
