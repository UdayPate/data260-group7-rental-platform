// Live debate view (/ai/tasks/:taskId). Loading + live stream come from useAiTask().
import { Link, useParams } from 'react-router'
import { AGENT_LABELS } from '../../agents'
import { pendingInRound2, secondsBetween, TASK_STATUS_TEXT } from '../../aiDebate'
import {
  AgentStrip,
  AnswerCard,
  ChallengeCard,
  DeadlineCountdown,
  OpinionCard,
  PlanPanel,
  RejectedOutputCard,
  RoundHeading,
  TimeoutCard,
  VoteList,
  WaitingCard,
} from '../../components/ai/DebateParts'
import VerdictCard from '../../components/ai/VerdictCard'
import ErrorBanner from '../../components/ErrorBanner'
import { useCurrentUser } from '../../context/useCurrentUser'
import { formatDate } from '../../dates'
import { AMENITY_LABELS, formatPrice } from '../../labels'
import type { StreamStatus } from '../../realtime/aiStream'
import { useAiTask } from '../../realtime/useAiTask'
import { AGENTS, ANALYSIS_AGENTS } from '../../types/ai'

const STREAM_TEXT: Record<StreamStatus, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Stream closed',
}

function AiDebatePage() {
  const { taskId = '' } = useParams()
  return <AiDebate key={taskId} taskId={taskId} />
}

function AiDebate({ taskId }: { taskId: string }) {
  const { guestId } = useCurrentUser()
  const { task, events, view, result, decision, status, loadError, retryLoad, streamStatus, reconnect, latencies, foreign, setDecidedResult } =
    useAiTask(taskId)

  if (loadError) {
    return (
      <section className="space-y-4">
        <Link to="/ai" className="text-sm font-semibold text-fg-muted hover:text-fg">
          ← New request
        </Link>
        <ErrorBanner message={loadError} onRetry={retryLoad} />
      </section>
    )
  }
  if (!task) return <p className="text-fg-muted">Loading the debate…</p>

  const canAct = task.guest_id === guestId

  // Property titles for votes and challenges, from everything we've seen.
  const titles = new Map<string, string>()
  for (const o of view.opinions) for (const r of o.ranked) titles.set(r.property_id, r.title)
  for (const r of result?.ranked ?? []) titles.set(r.property_id, r.title)
  const titleOf = (id: string) => titles.get(id) ?? id

  const firstAgentEvent = events.find((e) => (AGENTS as readonly string[]).includes(e.actor_id))?.timestamp ?? null
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null
  const pending = pendingInRound2(view)
  const round2 = view.rounds[2]
  const req = view.requirements
  const finished = status === 'completed' || status === 'failed' || status === 'timed_out'

  return (
    <section className="space-y-6">
      <Link to="/ai" className="text-sm font-semibold text-fg-muted hover:text-fg">
        ← New request
      </Link>

      {/* ---------- Header ---------- */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl font-bold">The Debate</h1>
          <span data-task-status={status} className="rounded-full border border-mustard px-3 py-0.5 font-condensed text-sm font-bold tracking-[0.08em] text-mustard uppercase">
            {TASK_STATUS_TEXT[status]}
          </span>
          <span className={`flex items-center gap-1.5 text-sm ${streamStatus === 'open' ? 'text-status-ok' : 'text-fg-muted'}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${streamStatus === 'open' ? 'bg-status-ok' : 'bg-line-strong'}`} />
            {finished && streamStatus === 'closed' ? 'Finished' : STREAM_TEXT[streamStatus]}
          </span>
          {streamStatus === 'closed' && !finished && (
            <button type="button" onClick={reconnect} className="text-sm font-semibold text-primary hover:underline">
              Reconnect
            </button>
          )}
        </div>
        <p className="text-lg text-fg-soft">“{task.request_text}”</p>
        <p className="font-mono text-sm text-fg-muted">
          trace_id <span data-trace-id className="text-fg-soft">{task.trace_id}</span> · task_id {task.task_id}
        </p>
        {(task.demo.delay_risk_agent || task.demo.invalid_agent_output) && (
          <p className="text-sm text-status-pending">
            Demo failure modes on: {[task.demo.delay_risk_agent && 'Risk agent delayed', task.demo.invalid_agent_output && 'one invalid agent output'].filter(Boolean).join(', ')}
          </p>
        )}
        {foreign > 0 && <p className="text-sm text-status-error">Dropped {foreign} event(s) that belonged to another trace.</p>}
      </div>

      <AgentStrip agents={view.agents} />

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        {/* ---------- Rounds ---------- */}
        <div className="space-y-8">
          <div className="space-y-3">
            <RoundHeading sub="independent opinions, agents can’t see each other’s answers">Round 0</RoundHeading>
            {view.rejectedOutputs.map((r) => (
              <RejectedOutputCard key={r.seq} item={r} />
            ))}
            <div className="grid gap-4 xl:grid-cols-3">
              {ANALYSIS_AGENTS.map((agent) => {
                const opinion = view.opinions.find((o) => o.agent === agent)
                return opinion ? (
                  <OpinionCard key={agent} opinion={opinion} reflection={view.reflections.find((r) => r.agent === agent)} />
                ) : (
                  <WaitingCard key={agent} agent={agent} text={view.rounds[0] ? 'working on its ranking…' : 'waiting for the round to start'} />
                )
              })}
            </div>
            {view.disagreement && (
              <div data-disagreement className="rounded-2xl border border-status-pending bg-surface p-4">
                <p className="font-semibold text-status-pending">
                  {view.disagreement.score === 0 ? 'The agents agree' : 'The agents disagree'} — disagreement{' '}
                  <span className="font-mono">{view.disagreement.score.toFixed(2)}</span>
                </p>
                <p className="text-sm text-fg-soft">
                  {view.disagreement.top_picks.map((p) => `${AGENT_LABELS[p.agent]}: ${titleOf(p.property_id)}`).join(' · ')}
                </p>
                <p className="text-xs text-fg-muted">Measured as {view.disagreement.method}</p>
              </div>
            )}
          </div>

          {view.rounds[1] && (
            <div className="space-y-3">
              <RoundHeading sub="the chair asks hard questions">Round 1</RoundHeading>
              {view.challenges.map((c) => (
                <ChallengeCard key={c.challenge_id} challenge={c} titleOf={titleOf} />
              ))}
            </div>
          )}

          {round2 && (
            <div className="space-y-3">
              <RoundHeading sub="answers and votes">Round 2</RoundHeading>
              {view.challenges.map((c) => (
                <AnswerCard key={c.challenge_id} challenge={c} />
              ))}
              <VoteList votes={view.votes} titleOf={titleOf} />
              {pending.length > 0 && !view.result && <DeadlineCountdown startedAt={round2.timestamp} deadlineMs={round2.deadline_ms} pending={pending} />}
              {view.timeouts.map((t) => (
                <TimeoutCard key={t.seq} item={t} />
              ))}
            </div>
          )}

          {result ? (
            <VerdictCard
              taskId={task.task_id}
              guestId={guestId}
              result={result}
              decision={decision}
              canAct={canAct}
              onDecided={setDecidedResult}
            />
          ) : (
            status !== 'failed' && <p className="text-sm text-fg-muted">The verdict appears here when the chair finishes.</p>
          )}
        </div>

        {/* ---------- Side column ---------- */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <PlanPanel plan={view.plan} />

          <div className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm">
            <h2 className="font-condensed text-lg font-bold tracking-[0.08em] uppercase">What the parser understood</h2>
            {!req && <p className="text-fg-muted">Reading your request…</p>}
            {req && (
              <ul className="space-y-0.5 text-fg-soft">
                <li>Where: {req.location ?? 'anywhere'}</li>
                <li>
                  Dates: {req.check_in && req.check_out ? `${formatDate(req.check_in)} → ${formatDate(req.check_out)}` : '—'}
                  {req.dates_assumed && <span className="text-status-pending"> (assumed)</span>}
                </li>
                <li>Guests: {req.guest_count ?? 'any'}</li>
                <li>Budget: {req.max_nightly_price ? `up to ${formatPrice(req.max_nightly_price)} / night` : 'any'}</li>
                <li>Must have: {req.amenities.length > 0 ? req.amenities.map((a) => AMENITY_LABELS[a]).join(', ') : '—'}</li>
                <li>Rating: {req.min_rating ? `${req.min_rating}+` : 'any'}</li>
                <li>Candidates: {view.candidateCount}</li>
              </ul>
            )}
          </div>

          {/* Timing (spec section 9). Server timestamps; latency = receive time - server time. */}
          <div data-timing className="space-y-1 rounded-2xl border border-line bg-surface p-4 text-sm">
            <h2 className="font-condensed text-lg font-bold tracking-[0.08em] uppercase">Timing</h2>
            <p>First agent update: {secondsBetween(task.created_datetime, firstAgentEvent)}</p>
            <p>First challenge: {secondsBetween(task.created_datetime, view.times.firstChallenge)}</p>
            <p>Verdict: {secondsBetween(task.created_datetime, view.times.verdict)}</p>
            <p>
              WebSocket delivery: {avgLatency === null ? '—' : `avg ${avgLatency} ms`}{' '}
              <span className="text-fg-muted">({latencies.length} live events)</span>
            </p>
            <p className="text-xs text-fg-muted">Each event is also logged in the browser console.</p>
          </div>
        </aside>
      </div>
    </section>
  )
}

export default AiDebatePage
