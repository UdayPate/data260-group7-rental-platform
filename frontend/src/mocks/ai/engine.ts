// Mock AI debate engine (team decision M1a): simple rules over the real seed data.
// It plans the whole debate up front as a timeline of events; bus.ts publishes them
// one by one at their time, like agents finishing their work over Kafka.
//
// Agents:
//   Parser     - reads city, guests, budget, amenities, rating out of the text
//   Matcher    - fit + price, plus a small review-count ("popularity") term the Fairness Auditor flags
//   Risk       - fit + host trust, minus host-caused cancellations
//   Fairness   - fit + price + rating only (ignores popularity and host history)
//   Chair      - finds disagreement, always challenges the Fairness Auditor (spec 7.2), counts votes
import type { AgentId, AiResult, DemoOptions, EventPayloads, EventType, ParsedRequirements, Plan, RankedProperty } from '../../types/ai'
import type { Amenity, Property, PropertyType } from '../../types/property'
import { daysFromToday, nightsBetween, rangesOverlap } from '../dates'
import { db } from '../db'

// ---------- Parsing the request ----------

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }
const toNumber = (s: string) => WORD_NUMBERS[s.toLowerCase()] ?? Number(s)
const NUMBER = '(\\d+|one|two|three|four|five|six|seven|eight)'

const AMENITY_WORDS: [Amenity, RegExp][] = [
  ['parking', /parking/i],
  ['kitchen', /kitchen/i],
  ['wifi', /wi-?fi/i],
  ['washer', /washer|laundry/i],
  ['dryer', /dryer/i],
  ['air_conditioning', /air ?condition|\ba\/?c\b/i],
  ['heating', /heating/i],
  ['workspace', /workspace|desk/i],
  ['pool', /\bpool\b/i],
  ['hot_tub', /hot ?tub/i],
  ['ev_charger', /\bev\b|electric car/i],
]

const TYPE_WORDS: [PropertyType, RegExp][] = [
  ['house', /\bhouse\b/i],
  ['apartment', /apartment|studio/i],
  ['condo', /condo/i],
  ['townhouse', /townho/i],
  ['private_room', /private room/i],
  ['guest_suite', /guest suite/i],
]

export function parseRequest(text: string): ParsedRequirements {
  const cities = [...new Set(db.properties.map((p) => p.city))]
  const location = cities.find((c) => text.toLowerCase().includes(c.toLowerCase())) ?? null

  const nightsMatch = text.match(new RegExp(`${NUMBER}[\\s-]*nights?`, 'i'))
  const nights = nightsMatch ? toNumber(nightsMatch[1]) : 2
  const guestsMatch = text.match(new RegExp(`for\\s+${NUMBER}\\b(?:\\s+(?:people|guests|adults|persons))?`, 'i'))
  const priceMatch = text.match(/(?:under|below|less than|max(?:imum)?|up to|≤|<=)\s*\$?\s*(\d+)/i) ?? text.match(/\$(\d+)/)
  const ratingMatch = text.match(/rating\s*(?:of\s*)?(?:at least|≥|>=|above|over)?\s*(\d(?:\.\d+)?)/i)

  // Dates: two YYYY-MM-DD dates if given, otherwise assume a stay two weeks from now.
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g)
  const datesGiven = dates !== null && dates.length >= 2
  const checkIn = datesGiven ? dates[0] : daysFromToday(14)
  const checkOut = datesGiven ? dates[1] : daysFromToday(14 + nights)

  return {
    location,
    check_in: checkIn,
    check_out: checkOut,
    dates_assumed: !datesGiven,
    guest_count: guestsMatch ? toNumber(guestsMatch[1]) : null,
    max_nightly_price: priceMatch ? Number(priceMatch[1]) : null,
    min_rating: ratingMatch ? Number(ratingMatch[1]) : null,
    amenities: AMENITY_WORDS.filter(([, re]) => re.test(text)).map(([a]) => a),
    property_types: TYPE_WORDS.filter(([, re]) => re.test(text)).map(([t]) => t),
  }
}

// ---------- Facts every agent can use ----------

type Fit = { passed: string[]; failed: string[]; fit: number; available: boolean }

function isAvailable(p: Property, req: ParsedRequirements): boolean {
  if (!req.check_in || !req.check_out) return true
  return !db.availability.some(
    (b) => b.property_id === p.property_id && b.status !== 'available' && rangesOverlap(b.start_date, b.end_date, req.check_in!, req.check_out!),
  )
}

// Which requirements a listing meets.
function fitOf(p: Property, req: ParsedRequirements): Fit {
  const passed: string[] = []
  const failed: string[] = []
  const check = (ok: boolean, label: string) => (ok ? passed : failed).push(label)
  if (req.guest_count !== null) check(p.capacity >= req.guest_count, `fits ${req.guest_count} guests`)
  if (req.max_nightly_price !== null) check(p.nightly_price <= req.max_nightly_price, `under $${req.max_nightly_price}`)
  for (const a of req.amenities) check(p.amenities.includes(a), `has ${a.replace('_', ' ')}`)
  if (req.min_rating !== null) check(p.rating >= req.min_rating, `rated ${req.min_rating}+`)
  if (req.property_types.length > 0) check(req.property_types.includes(p.property_type), 'right property type')
  const available = isAvailable(p, req)
  check(available, 'free on the dates')
  const total = passed.length + failed.length
  return { passed, failed, fit: total === 0 ? 1 : passed.length / total, available }
}

// Cancellations the host caused (seed reasons start with "Host cancelled").
function hostCancellations(hostId: string) {
  const ids = db.properties.filter((p) => p.host_id === hostId).map((p) => p.property_id)
  return db.reservations.filter(
    (r) => ids.includes(r.property_id) && r.status === 'cancelled' && (r.cancellation_reason ?? '').startsWith('Host cancelled'),
  )
}

// Warning signs the Risk agent looks for.
function riskFlags(p: Property): string[] {
  const host = db.hosts.find((h) => h.host_id === p.host_id)
  const flags: string[] = []
  const cancelled = hostCancellations(p.host_id)
  if (cancelled.length > 0) {
    flags.push(`host cancelled ${cancelled.length} stay(s) (${cancelled.map((r) => r.reservation_id).join(', ')})`)
  }
  if (host && host.response_rate < 80) flags.push(`host replies to only ${host.response_rate}% of messages`)
  if (host && host.verification_status !== 'verified') flags.push(`host verification is ${host.verification_status}`)
  return flags
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n))
const round2 = (n: number) => Math.round(n * 100) / 100

function priceBonus(p: Property, req: ParsedRequirements) {
  return req.max_nightly_price ? clamp((req.max_nightly_price - p.nightly_price) / req.max_nightly_price) : clamp(1 - p.nightly_price / 400)
}
const ratingNorm = (p: Property) => clamp(p.rating - 4)
const popularity = (p: Property) => clamp(p.review_count / 60)

type Scored = { p: Property; score: number; reasons: string[] }

// Each agent's scoring rule. `withPopularity` lets the Fairness Auditor rerun the Matcher without it.
function matcherScore(p: Property, req: ParsedRequirements, withPopularity = true): Scored {
  const f = fitOf(p, req)
  const score = 0.7 * f.fit + 0.2 * priceBonus(p, req) + (withPopularity ? 0.05 * popularity(p) : 0)
  const reasons = [`meets ${f.passed.length} of ${f.passed.length + f.failed.length} requirements`, `$${p.nightly_price}/night`]
  if (f.failed.length > 0) reasons.push(`misses: ${f.failed.join(', ')}`)
  if (withPopularity) reasons.push(`${p.review_count} reviews`)
  return { p, score, reasons }
}

function riskScore(p: Property, req: ParsedRequirements): Scored {
  const f = fitOf(p, req)
  const host = db.hosts.find((h) => h.host_id === p.host_id)
  const trust = host ? (host.response_rate / 100) * (host.verification_status === 'verified' ? 1 : 0.8) : 0.5
  const cancelled = hostCancellations(p.host_id).length
  const score = 0.6 * f.fit + 0.25 * trust + 0.15 * ratingNorm(p) - 0.12 * cancelled
  const flags = riskFlags(p)
  const reasons = flags.length > 0 ? flags : [`host replies to ${host?.response_rate ?? '?'}% of messages`, 'no host cancellations']
  return { p, score, reasons }
}

function fairnessScore(p: Property, req: ParsedRequirements): Scored {
  const f = fitOf(p, req)
  const score = 0.7 * f.fit + 0.2 * priceBonus(p, req) + 0.1 * ratingNorm(p)
  return { p, score, reasons: [`meets ${f.passed.length} of ${f.passed.length + f.failed.length} requirements`, 'scored without review count or host popularity'] }
}

function rank(pool: Property[], scorer: (p: Property) => Scored): Scored[] {
  return pool.map(scorer).sort((a, b) => b.score - a.score || a.p.nightly_price - b.p.nightly_price)
}

const toRanked = (s: Scored): RankedProperty => ({
  property_id: s.p.property_id,
  title: s.p.title,
  score: round2(clamp(s.score)),
  reasons: s.reasons,
})

// Confidence grows with the lead over the runner-up.
const confidenceOf = (list: Scored[]) => round2(clamp(0.6 + (list.length > 1 ? (list[0].score - list[1].score) * 2 : 0.2), 0.55, 0.92))

// ---------- The timeline ----------

export type TimelineItem = {
  at: number // ms after the task was created
  actor: string
  type: EventType
  payload: EventPayloads[EventType]
}

const ROUND_DEADLINE_MS = 8000

function makePlan(planId: string, traceId: string): Plan {
  const step = (n: number, title: string, input: string, expected: string, agent: AgentId) => ({
    step_id: `s${n}`,
    order: n,
    title,
    input,
    expected_output: expected,
    agent,
    status: 'pending' as const,
    note: null,
  })
  return {
    plan_id: planId,
    trace_id: traceId,
    created_datetime: new Date().toISOString(),
    steps: [
      step(1, 'Read the guest’s dates and requirements', 'request text', 'structured requirements', 'parser'),
      step(2, 'Retrieve available properties', 'requirements', 'candidate property pool', 'chair'),
      step(3, 'Ask independent agents to rank them', 'candidate pool', 'three ranked opinions (round 0)', 'chair'),
      step(4, 'Identify disagreements', 'round 0 opinions', 'disagreement score and summary', 'chair'),
      step(5, 'Request challenges and responses', 'disagreement', 'answers and votes (rounds 1-2)', 'chair'),
      step(6, 'Verify availability again', 'winning property and dates', 'still available: yes/no', 'chair'),
      step(7, 'Prepare a recommendation for human approval', 'votes and evidence', 'result with rationale, risks, dissent', 'explanation'),
    ],
  }
}

export type DebateScript = { timeline: TimelineItem[]; result: AiResult; requirements: ParsedRequirements; plan: Plan }

export function planDebate(taskId: string, traceId: string, planId: string, text: string, demo: DemoOptions): DebateScript {
  const items: TimelineItem[] = []
  const add = <T extends EventType>(at: number, actor: string, type: T, payload: EventPayloads[T]) =>
    items.push({ at, actor, type, payload })
  const step = (at: number, id: string, status: 'in_progress' | 'done' | 'skipped', note: string | null = null) =>
    add(at, 'harness', 'plan.step_updated', { step_id: id, status, note })

  const req = parseRequest(text)
  const plan = makePlan(planId, traceId)
  const pool = db.properties
    .filter((p) => p.status === 'active' && (!req.location || p.city === req.location))
    .sort((a, b) => a.property_id.localeCompare(b.property_id))

  add(600, 'harness', 'task.status', { status: 'planning', note: null })
  add(1200, 'chair', 'plan.created', { plan })
  step(1600, 's1', 'in_progress')
  add(3000, 'parser', 'requirements.parsed', { requirements: req, candidate_ids: pool.map((p) => p.property_id) })
  step(3000, 's1', 'done', req.dates_assumed ? `No dates in the request; assumed ${req.check_in} to ${req.check_out}.` : null)
  step(3200, 's2', 'in_progress')
  step(3600, 's2', 'done', `${pool.length} active listing(s)${req.location ? ` in ${req.location}` : ''}.`)

  const baseResult = {
    task_id: taskId,
    trace_id: traceId,
    check_in: req.check_in,
    check_out: req.check_out,
    guest_count: req.guest_count,
    human_decision: null,
    created_datetime: '', // filled when published
  }

  // ----- Nothing to debate: stop safely with an explanation (never continue silently) -----
  if (pool.length === 0) {
    for (const id of ['s3', 's4', 's5', 's6']) step(4000, id, 'skipped', 'No candidate properties.')
    step(4200, 's7', 'in_progress')
    const result: AiResult = {
      ...baseResult,
      recommended: null,
      ranked: [],
      confidence: 0,
      rationale: 'No listings matched where you want to stay, so there is nothing to recommend yet.',
      evidence: [{ fact: `0 active listings${req.location ? ` in ${req.location}` : ''}`, source: 'property search' }],
      risks: [],
      consensus: true,
      decision_rule: null,
      dissent: [],
      dissent_note: null,
      missing_agents: [],
      comparison: null,
      suggestions: ['Try San Jose, Sunnyvale or Mountain View.', 'Remove a requirement or raise the budget.'],
    }
    add(5000, 'chair', 'result.published', { result })
    step(5000, 's7', 'done')
    add(5000, 'harness', 'task.status', { status: 'completed', note: 'No candidates; nothing to approve.' })
    return { timeline: items, result, requirements: req, plan }
  }

  // ----- Round 0: independent opinions -----
  const matcher = rank(pool, (p) => matcherScore(p, req))
  const risk = rank(pool, (p) => riskScore(p, req))
  const fairness = rank(pool, (p) => fairnessScore(p, req))
  const picks: Record<'matcher' | 'risk' | 'fairness', Property> = { matcher: matcher[0].p, risk: risk[0].p, fairness: fairness[0].p }

  add(4000, 'harness', 'task.status', { status: 'in_debate', note: null })
  step(4000, 's3', 'in_progress')
  add(4000, 'chair', 'round.started', { round: 0, deadline_ms: ROUND_DEADLINE_MS, waiting_for: ['matcher', 'risk', 'fairness'] })

  let t = 5600
  if (demo.invalid_agent_output) {
    add(5200, 'harness', 'agent.output_rejected', {
      agent: 'matcher',
      round: 0,
      reason:
        'Harness check failed: property p_999 is not in the candidate pool, and score 1.7 is outside 0–1. Asking the Matcher to try again (retry 1 of 1).',
      invalid_fields: ['ranked[0].property_id', 'ranked[0].score'],
      action: 'retry',
    })
    t = 6400
  }
  add(t, 'matcher', 'opinion.published', {
    round: 0,
    ranked: matcher.slice(0, 5).map(toRanked),
    confidence: confidenceOf(matcher),
    reasoning: `${picks.matcher.title} meets the most requirements at the lowest price ($${picks.matcher.nightly_price}/night).`,
  })
  add(7000, 'fairness', 'opinion.published', {
    round: 0,
    ranked: fairness.slice(0, 5).map(toRanked),
    confidence: confidenceOf(fairness),
    reasoning: 'Ranked on fit, price and rating only, without review counts or host popularity, so newer listings are not pushed down.',
  })
  const matcherPickFlags = riskFlags(picks.matcher)
  add(8200, 'risk', 'opinion.published', {
    round: 0,
    ranked: risk.slice(0, 5).map(toRanked),
    confidence: confidenceOf(risk),
    reasoning:
      matcherPickFlags.length > 0 && picks.risk.property_id !== picks.matcher.property_id
        ? `${picks.matcher.title} is cheaper, but its ${matcherPickFlags[0]}. ${picks.risk.title} has a reliable host and no cancellations.`
        : `${picks.risk.title} has the most reliable host among listings that fit.`,
  })

  // Reflection (spec 7.5.3): one check per agent, at most one revision. Here both keep.
  const pass = (note: string) => ({ result: 'pass' as const, note })
  const concern = (note: string) => ({ result: 'concern' as const, note })
  add(8800, 'risk', 'reflection.recorded', {
    round: 0,
    cycle: 1,
    checks: {
      constraint: pass(`${picks.risk.title} meets ${fitOf(picks.risk, req).passed.length} requirement(s).`),
      evidence: pass('Cancellation counts come from reservation records; response rates from host profiles.'),
      risk: matcherPickFlags.length > 0 ? concern(`${picks.matcher.title}: ${matcherPickFlags.join('; ')}.`) : pass('No warning signs on the top candidates.'),
      conflict: picks.matcher.property_id !== picks.risk.property_id ? concern(`The Matcher ranks ${picks.matcher.title} first.`) : pass('Agrees with the Matcher.'),
      action: pass('Booking requires the guest’s approval; no action taken.'),
    },
    decision: 'keep',
  })
  add(9400, 'matcher', 'reflection.recorded', {
    round: 0,
    cycle: 1,
    checks: {
      constraint: pass(`${picks.matcher.title} meets ${fitOf(picks.matcher, req).passed.length} requirement(s).`),
      evidence: pass('Price, amenities and rating come from the property record.'),
      risk: matcherPickFlags.length > 0 ? concern(`Not scored by the Matcher: ${matcherPickFlags.join('; ')}.`) : pass('None found.'),
      conflict: pass('No other agent’s output read yet (round 0 is independent).'),
      action: pass('No external action.'),
    },
    decision: 'keep',
  })
  step(9600, 's3', 'done', demo.invalid_agent_output ? 'Matcher output rejected once (invalid property id and score); retry succeeded.' : null)

  // ----- Disagreement (formula from the contract) -----
  step(9800, 's4', 'in_progress')
  const topPicks = (['matcher', 'risk', 'fairness'] as const).map((a) => ({ agent: a as AgentId, property_id: picks[a].property_id }))
  const counts = new Map<string, number>()
  for (const tp of topPicks) counts.set(tp.property_id, (counts.get(tp.property_id) ?? 0) + 1)
  const plurality = Math.max(...counts.values())
  const disagreement = round2(1 - plurality / topPicks.length)
  const titleOf = (id: string) => pool.find((p) => p.property_id === id)?.title ?? id
  add(10200, 'chair', 'disagreement.detected', {
    round: 0,
    score: disagreement,
    method: '1 - (agents agreeing with the most common #1 pick / agents that published)',
    top_picks: topPicks,
    summary:
      disagreement === 0
        ? `All three agents rank ${titleOf(topPicks[0].property_id)} first.`
        : topPicks.map((tp) => `${tp.agent}: ${titleOf(tp.property_id)}`).join(' · '),
  })
  step(10200, 's4', 'done', `Disagreement ${disagreement}.`)

  // ----- Round 1: challenges -----
  step(10400, 's5', 'in_progress')
  add(10800, 'chair', 'round.started', { round: 1, deadline_ms: 5000, waiting_for: ['chair'] })
  type Challenge = { id: string; to: 'matcher' | 'risk' | 'fairness'; about: string | null; question: string }
  const challenges: Challenge[] = []
  if (picks.matcher.property_id !== picks.risk.property_id) {
    challenges.push({
      id: 'c1',
      to: 'matcher',
      about: picks.matcher.property_id,
      question:
        matcherPickFlags.length > 0
          ? `Matcher, explain why “${matcherPickFlags[0]}” should not lower ${picks.matcher.title}.`
          : `Matcher, explain why ${picks.matcher.title} beats ${picks.risk.title}.`,
    })
    challenges.push({
      id: 'c2',
      to: 'risk',
      about: picks.risk.property_id,
      question: `Risk agent, show which evidence makes ${picks.risk.title} safer than ${picks.matcher.title}, given it costs $${picks.risk.nightly_price - picks.matcher.nightly_price} more per night.`,
    })
  }
  // The Fairness Auditor is always challenged at least once (spec 7.2).
  challenges.push({
    id: `c${challenges.length + 1}`,
    to: 'fairness',
    about: null,
    question:
      matcherPickFlags.length > 0
        ? `Fairness Auditor, was any good listing ranked lower because of popularity (review count) rather than fit? And is the cancellation penalty on ${picks.matcher.title} fair?`
        : 'Fairness Auditor, was any good listing ranked lower because of popularity (review count) rather than fit?',
  })
  challenges.forEach((c, i) =>
    add(11400 + i * 600, 'chair', 'challenge.issued', { round: 1, challenge_id: c.id, to_agent: c.to, about_property_id: c.about, question: c.question }),
  )

  // ----- Round 2: answers and votes -----
  const round2Start = 11400 + challenges.length * 600 + 600
  add(round2Start, 'chair', 'round.started', { round: 2, deadline_ms: ROUND_DEADLINE_MS, waiting_for: ['matcher', 'fairness', 'risk'] })

  // Fairness finding: rerun the Matcher without the review-count term.
  const withoutPopularity = rank(pool, (p) => matcherScore(p, req, false))
  const moved = withoutPopularity
    .slice(0, 5)
    .map((s, i) => ({ s, before: matcher.findIndex((m) => m.p.property_id === s.p.property_id), after: i }))
    .filter((x) => x.after < x.before)
  const fairnessFinding =
    moved.length > 0
      ? `The Matcher’s score includes review count. Without it, ${moved.map((x) => `${x.s.p.title} moves from #${x.before + 1} to #${x.after + 1}`).join('; ')}. The top pick ${withoutPopularity[0].p.property_id === picks.matcher.property_id ? 'does not change' : 'changes'}, but the review-count term should be removed (proposal: matcher-v2).`
      : 'Review count does not change the Matcher’s order for these listings.'

  let at = round2Start + 1400
  const answer = (c: Challenge, text: string, evidence: string[]) => {
    add(at, c.to, 'challenge.answered', { round: 2, challenge_id: c.id, answer: text, evidence })
    at += 600
  }
  const votes: { agent: 'matcher' | 'risk' | 'fairness'; property_id: string; weight: number; vote: 'keep' | 'switch'; reason: string }[] = []
  const cast = (agent: 'matcher' | 'risk' | 'fairness', vote: 'keep' | 'switch', propertyId: string, reason: string) => {
    add(at, agent, 'vote.cast', { round: 2, vote, property_id: propertyId, reason })
    votes.push({ agent, property_id: propertyId, weight: 1, vote, reason })
    at += 1000
  }

  // Matcher
  const cMatcher = challenges.find((c) => c.to === 'matcher')
  if (cMatcher) {
    answer(
      cMatcher,
      `${picks.matcher.title} meets every requirement and is $${picks.risk.nightly_price - picks.matcher.nightly_price} cheaper per night than ${picks.risk.title}. I note the host history, but fit and price still rank it first.`,
      [`nightly_price ${picks.matcher.property_id}: $${picks.matcher.nightly_price}`, `nightly_price ${picks.risk.property_id}: $${picks.risk.nightly_price}`],
    )
  }
  cast('matcher', 'keep', picks.matcher.property_id, 'Lowest price among listings that meet every requirement.')

  // Fairness
  const fairnessPickFlags = riskFlags(picks.fairness)
  const fairnessSwitches = fairnessPickFlags.length > 0 && picks.risk.property_id !== picks.fairness.property_id
  answer(
    challenges.find((c) => c.to === 'fairness')!,
    fairnessFinding +
      (matcherPickFlags.length > 0
        ? ` The cancellation penalty on ${picks.matcher.title} rests on documented host-caused cancellations, so it is a legitimate safety signal, not a popularity bias.`
        : ''),
    moved.length > 0 ? moved.map((x) => `${x.s.p.property_id}: rank ${x.before + 1} → ${x.after + 1} without review count`) : ['no rank changes'],
  )
  if (fairnessSwitches) {
    cast('fairness', 'switch', picks.risk.property_id, `The penalty is justified by the reservation records; ${picks.risk.title} meets the requirements without that risk.`)
  } else {
    cast('fairness', 'keep', picks.fairness.property_id, `${picks.fairness.title} ranks first on fit, price and rating, with no unfair signal involved.`)
  }

  // Risk (may miss its deadline in the demo)
  const missing: AiResult['missing_agents'] = []
  if (demo.delay_risk_agent) {
    const deadlineAt = round2Start + ROUND_DEADLINE_MS
    at = Math.max(at, deadlineAt)
    add(at, 'harness', 'agent.timed_out', {
      agent: 'risk',
      round: 2,
      deadline_ms: ROUND_DEADLINE_MS,
      reason: 'No answer or vote before the round 2 deadline.',
      fallback: `Continuing without it; its round 0 pick (${picks.risk.title}) counts as half a vote.`,
    })
    missing.push({ agent: 'risk', round: 2, reason: 'Timed out in round 2 (no answer, no vote).' })
    votes.push({ agent: 'risk', property_id: picks.risk.property_id, weight: 0.5, vote: 'keep', reason: 'round 0 position (timed out)' })
    at += 600
  } else {
    const cRisk = challenges.find((c) => c.to === 'risk')
    if (cRisk) {
      const host = db.hosts.find((h) => h.host_id === picks.risk.host_id)
      answer(
        cRisk,
        `${picks.risk.title}: host replies to ${host?.response_rate}% of messages and has no cancellations. ${picks.matcher.title}: ${matcherPickFlags.join('; ')}.`,
        hostCancellations(picks.matcher.host_id).map((r) => `${r.reservation_id}: ${r.cancellation_reason}`),
      )
    }
    cast('risk', 'keep', picks.risk.property_id, 'Safety and reliability outweigh a small price difference.')
  }

  // ----- Tally -----
  const tally = new Map<string, number>()
  for (const v of votes) tally.set(v.property_id, (tally.get(v.property_id) ?? 0) + v.weight)
  const fullVotes = votes.filter((v) => v.weight === 1)
  const sorted = [...tally.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    // Tie: fewer risk flags wins, then the lower price (the written decision rule).
    const pa = pool.find((p) => p.property_id === a[0])!
    const pb = pool.find((p) => p.property_id === b[0])!
    return riskFlags(pa).length - riskFlags(pb).length || pa.nightly_price - pb.nightly_price
  })
  const winnerId = sorted[0][0]
  const winner = pool.find((p) => p.property_id === winnerId)!
  const winnerFullVotes = fullVotes.filter((v) => v.property_id === winnerId).length
  // Consensus = a strict majority of the three analysis agents voted for it, and nobody is missing.
  const consensus = missing.length === 0 && winnerFullVotes >= 2
  const tieOrMissing = !consensus
  const decisionRule = tieOrMissing
    ? 'No clear majority. Rule: a timed-out agent’s round 0 pick counts as half a vote; on a tie, the listing with fewer risk flags wins, then the lower price.'
    : null

  step(at, 's5', 'done')
  step(at + 200, 's6', 'in_progress')
  const stillFree = isAvailable(winner, req)
  step(at + 1000, 's6', 'done', `${winner.title} ${stillFree ? 'is still free' : 'is NO LONGER free'} ${req.check_in} to ${req.check_out}.`)
  step(at + 1200, 's7', 'in_progress')

  // ----- Result -----
  const winnerFit = fitOf(winner, req)
  const winnerHost = db.hosts.find((h) => h.host_id === winner.host_id)
  const runnerUp = sorted[1] ? pool.find((p) => p.property_id === sorted[1][0])! : picks.matcher.property_id !== winnerId ? picks.matcher : null
  const dissent = votes
    .filter((v) => v.property_id !== winnerId && v.weight === 1)
    .map((v) => ({ agent: v.agent as AgentId, preferred_property_id: v.property_id, reason: v.reason }))

  const nights = req.check_in && req.check_out ? nightsBetween(req.check_in, req.check_out) : null
  const toResultProperty = (s: Scored) => ({ ...toRanked(s), nightly_price: s.p.nightly_price, city: s.p.city })
  // Combined order for the top 5: by votes first, then the Matcher's order.
  const top5 = [winner, ...matcher.map((m) => m.p).filter((p) => p.property_id !== winnerId)].slice(0, 5)
  const result: AiResult = {
    ...baseResult,
    recommended: toResultProperty(matcher.find((m) => m.p.property_id === winnerId)!),
    ranked: top5.map((p) => toResultProperty(matcher.find((m) => m.p.property_id === p.property_id)!)),
    confidence: round2(clamp((tally.get(winnerId)! / votes.reduce((s, v) => s + v.weight, 0)) * 0.9, 0.4, 0.95)),
    rationale:
      `${winner.title} in ${winner.city} meets ${winnerFit.passed.length} of ${winnerFit.passed.length + winnerFit.failed.length} of your requirements ` +
      `for $${winner.nightly_price}/night, rated ${winner.rating} from ${winner.review_count} reviews, and its host replies to ${winnerHost?.response_rate}% of messages.` +
      (runnerUp && runnerUp.property_id !== winnerId
        ? ` It was chosen over ${runnerUp.title} ($${runnerUp.nightly_price}/night)${riskFlags(runnerUp).length > 0 ? ` because that ${riskFlags(runnerUp)[0]}` : ''}.`
        : ''),
    evidence: [
      { fact: `nightly_price $${winner.nightly_price}${req.max_nightly_price ? ` ≤ $${req.max_nightly_price}` : ''}`, source: `property ${winner.property_id}` },
      { fact: `rating ${winner.rating} (${winner.review_count} reviews)`, source: `property ${winner.property_id}` },
      { fact: `amenities: ${winner.amenities.join(', ')}`, source: `property ${winner.property_id}` },
      { fact: `free ${req.check_in} to ${req.check_out}${nights ? ` (${nights} nights)` : ''}`, source: 'availability re-check (plan step 6)' },
      { fact: `host response rate ${winnerHost?.response_rate}%`, source: `host ${winner.host_id}` },
    ],
    risks: [
      ...riskFlags(winner).map((text) => ({ severity: 'high' as const, text, source_agent: 'risk' as AgentId })),
      ...winnerFit.failed.map((f) => ({ severity: 'medium' as const, text: `Does not meet: ${f}`, source_agent: 'matcher' as AgentId })),
      ...(req.dates_assumed
        ? [{ severity: 'medium' as const, text: `No dates in the request; assumed ${req.check_in} to ${req.check_out}.`, source_agent: 'parser' as AgentId }]
        : []),
      ...(moved.length > 0 ? [{ severity: 'low' as const, text: 'Matcher score uses review count (popularity); flagged for matcher-v2.', source_agent: 'fairness' as AgentId }] : []),
    ],
    consensus,
    decision_rule: decisionRule,
    dissent,
    dissent_note:
      dissent.length > 0 || missing.length > 0
        ? [
            ...dissent.map((d) => `${d.agent} preferred ${titleOf(d.preferred_property_id!)}: ${d.reason}`),
            ...missing.map((m) => `${m.agent} did not answer in round ${m.round}; its round 0 position was used at half weight.`),
          ].join(' ')
        : null,
    missing_agents: missing,
    comparison:
      runnerUp && runnerUp.property_id !== winnerId
        ? {
            rejected_property_id: runnerUp.property_id,
            rejected_title: runnerUp.title,
            why_lower:
              riskFlags(runnerUp).length > 0
                ? `Cheaper or similar on fit, but ${riskFlags(runnerUp).join('; ')}.`
                : `Fewer votes in round 2 (${tally.get(runnerUp.property_id) ?? 0} vs ${tally.get(winnerId)}).`,
          }
        : null,
    suggestions: [],
  }

  add(at + 2800, 'chair', 'result.published', { result })
  step(at + 2800, 's7', 'done')
  add(at + 2800, 'harness', 'task.status', { status: 'waiting_for_approval', note: null })
  return { timeline: items, result, requirements: req, plan }
}
