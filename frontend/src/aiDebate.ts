// Turns the list of debate events into what the debate page shows.
// The page only ever stores events; everything on screen is recalculated from them,
// so a reload (history + replay) always rebuilds exactly the same view.
import { actorLabel } from './agents'
import type {
  AgentId,
  AiResult,
  EventPayloads,
  HumanDecision,
  ParsedRequirements,
  Plan,
  StreamEvent,
  TaskStatus,
} from './types/ai'

export type AgentState = 'waiting' | 'working' | 'published' | 'challenged' | 'answered' | 'voted' | 'timed_out' | 'done'

type WithTime<T> = T & { agent: AgentId; timestamp: string; seq: number }

export type Challenge = WithTime<EventPayloads['challenge.issued']> & {
  answer: WithTime<EventPayloads['challenge.answered']> | null
}

export type DebateView = {
  status: TaskStatus | null
  plan: Plan | null
  requirements: ParsedRequirements | null
  candidateCount: number
  rounds: Partial<Record<0 | 1 | 2, WithTime<EventPayloads['round.started']>>>
  opinions: WithTime<EventPayloads['opinion.published']>[]
  rejectedOutputs: WithTime<EventPayloads['agent.output_rejected']>[]
  reflections: WithTime<EventPayloads['reflection.recorded']>[]
  disagreement: WithTime<EventPayloads['disagreement.detected']> | null
  challenges: Challenge[]
  votes: WithTime<EventPayloads['vote.cast']>[]
  timeouts: WithTime<EventPayloads['agent.timed_out']>[]
  result: AiResult | null
  decision: HumanDecision | null
  agents: Record<AgentId, AgentState>
  // Server timestamps of the milestones, for the timing line (spec section 9).
  times: { first: string | null; firstOpinion: string | null; firstChallenge: string | null; verdict: string | null }
}

export function emptyView(): DebateView {
  return {
    status: null,
    plan: null,
    requirements: null,
    candidateCount: 0,
    rounds: {},
    opinions: [],
    rejectedOutputs: [],
    reflections: [],
    disagreement: null,
    challenges: [],
    votes: [],
    timeouts: [],
    result: null,
    decision: null,
    agents: { parser: 'waiting', matcher: 'waiting', risk: 'waiting', fairness: 'waiting', explanation: 'waiting', chair: 'waiting' },
    times: { first: null, firstOpinion: null, firstChallenge: null, verdict: null },
  }
}

// Applies events in seq order. Each case reads one event type.
export function buildDebateView(events: StreamEvent[]): DebateView {
  const view = emptyView()
  const sorted = [...events].sort((a, b) => a.seq - b.seq)

  for (const e of sorted) {
    view.times.first ??= e.timestamp
    const meta = { agent: e.actor_id as AgentId, timestamp: e.timestamp, seq: e.seq }

    switch (e.event_type) {
      case 'task.status':
        view.status = e.payload.status
        break
      case 'plan.created':
        view.plan = structuredClone(e.payload.plan)
        view.agents.chair = 'working'
        break
      case 'plan.step_updated': {
        const step = view.plan?.steps.find((s) => s.step_id === e.payload.step_id)
        if (step) {
          step.status = e.payload.status
          step.note = e.payload.note
          if (step.agent === 'explanation' && e.payload.status === 'in_progress') view.agents.explanation = 'working'
          if (step.agent === 'parser' && e.payload.status === 'in_progress') view.agents.parser = 'working'
        }
        break
      }
      case 'requirements.parsed':
        view.requirements = e.payload.requirements
        view.candidateCount = e.payload.candidate_ids.length
        view.agents.parser = 'done'
        break
      case 'round.started':
        view.rounds[e.payload.round] = { ...e.payload, ...meta }
        if (e.payload.round === 0) for (const a of e.payload.waiting_for) view.agents[a] = 'working'
        break
      case 'opinion.published':
        view.opinions.push({ ...e.payload, ...meta })
        view.agents[meta.agent] = 'published'
        view.times.firstOpinion ??= e.timestamp
        break
      case 'agent.output_rejected':
        view.rejectedOutputs.push({ ...e.payload, ...meta, agent: e.payload.agent })
        break
      case 'reflection.recorded':
        view.reflections.push({ ...e.payload, ...meta })
        break
      case 'disagreement.detected':
        view.disagreement = { ...e.payload, ...meta }
        break
      case 'challenge.issued':
        view.challenges.push({ ...e.payload, ...meta, answer: null })
        view.agents[e.payload.to_agent] = 'challenged'
        view.times.firstChallenge ??= e.timestamp
        break
      case 'challenge.answered': {
        const challenge = view.challenges.find((c) => c.challenge_id === e.payload.challenge_id)
        if (challenge) challenge.answer = { ...e.payload, ...meta }
        view.agents[meta.agent] = 'answered'
        break
      }
      case 'vote.cast':
        view.votes.push({ ...e.payload, ...meta })
        view.agents[meta.agent] = 'voted'
        break
      case 'agent.timed_out':
        // The harness reports it, but it's about payload.agent.
        view.timeouts.push({ ...e.payload, ...meta, agent: e.payload.agent })
        view.agents[e.payload.agent] = 'timed_out'
        break
      case 'result.published':
        view.result = e.payload.result
        view.agents.chair = 'done'
        view.agents.explanation = 'done'
        view.times.verdict = e.timestamp
        break
      case 'decision.recorded':
        view.decision = e.payload.decision
        break
    }
  }

  return view
}

// Agents still owing an answer/vote in round 2 (for the countdown).
export function pendingInRound2(view: DebateView): AgentId[] {
  const round = view.rounds[2]
  if (!round) return []
  return round.waiting_for.filter(
    (a) => !view.votes.some((v) => v.agent === a) && !view.timeouts.some((t) => t.agent === a && t.round === 2),
  )
}

export const TASK_STATUS_TEXT: Record<TaskStatus, string> = {
  waiting: 'Waiting',
  planning: 'Planning',
  in_debate: 'In debate',
  waiting_for_approval: 'Waiting for your approval',
  completed: 'Completed',
  failed: 'Failed',
  timed_out: 'Timed out',
}

// One short line about an event, for the assistant panel's "Now:" line.
export function describeEvent(e: StreamEvent): string {
  const who = actorLabel(e.actor_id)
  switch (e.event_type) {
    case 'task.status':
      return `Status: ${TASK_STATUS_TEXT[e.payload.status]}`
    case 'plan.created':
      return `The chair wrote a ${e.payload.plan.steps.length}-step plan`
    case 'plan.step_updated':
      return `Plan step ${e.payload.step_id.slice(1)} ${e.payload.status.replace('_', ' ')}`
    case 'requirements.parsed':
      return `The parser read your request (${e.payload.candidate_ids.length} candidates)`
    case 'round.started':
      return `Round ${e.payload.round} started`
    case 'opinion.published':
      return `${who} published its ranking`
    case 'agent.output_rejected':
      return `Harness rejected the ${actorLabel(e.payload.agent)}’s output`
    case 'reflection.recorded':
      return `${who} checked its own answer`
    case 'disagreement.detected':
      return e.payload.score === 0 ? 'The agents agree' : `The agents disagree (${e.payload.score.toFixed(2)})`
    case 'challenge.issued':
      return `The chair challenged the ${actorLabel(e.payload.to_agent)}`
    case 'challenge.answered':
      return `${who} answered the challenge`
    case 'vote.cast':
      return `${who} voted`
    case 'agent.timed_out':
      return `${actorLabel(e.payload.agent)} timed out`
    case 'result.published':
      return 'The verdict is ready'
    case 'decision.recorded':
      return 'Your decision was recorded'
  }
}

// Seconds between two ISO timestamps, one decimal ("4.2 s").
export function secondsBetween(from: string | null, to: string | null): string {
  if (!from || !to) return '—'
  return `${((Date.parse(to) - Date.parse(from)) / 1000).toFixed(1)} s`
}
