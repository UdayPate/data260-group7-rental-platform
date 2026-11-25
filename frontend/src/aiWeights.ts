// Matcher weights in the UI (spec 13.6): labels, shares, and comparing two runs.
// Everything here is computed from measured numbers (the Matcher's ranking and its score
// parts); the agents' generated text is shown separately.
import type { AiResult, MatcherRankEntry, MatcherWeights, WeightKey } from './types/ai'
import { WEIGHT_KEYS } from './types/ai'

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  amenity_fit: 'Amenity fit',
  price: 'Price',
  rating: 'Rating',
  risk_penalty: 'Risk penalty',
  review_count: 'Review count',
}

export const WEIGHT_HINTS: Record<WeightKey, string> = {
  amenity_fit: 'share of the requested amenities the listing has',
  price: 'how far under the budget it is',
  rating: 'guest rating above 4',
  risk_penalty: 'subtracted: host cancellations, slow replies, unverified host',
  review_count: 'how many reviews (popularity)',
}

const total = (w: MatcherWeights) => WEIGHT_KEYS.reduce((sum, k) => sum + w[k], 0)

// Each weight's share of the total, in % (team decision W2a: the score divides by the sum).
export const sharePercent = (w: MatcherWeights, key: WeightKey) => (total(w) === 0 ? 0 : Math.round((w[key] / total(w)) * 100))

export const sameWeights = (a: MatcherWeights, b: MatcherWeights) => WEIGHT_KEYS.every((k) => a[k] === b[k])

// "Amenity fit 0.60 · Price 0.35 · …"
export const describeWeights = (w: MatcherWeights) => WEIGHT_KEYS.map((k) => `${WEIGHT_LABELS[k]} ${w[k].toFixed(2)}`).join(' · ')

// ---------- Comparing a rerun with its original ----------

export type ComparisonRow = {
  property_id: string
  title: string
  oldRank: number | null // null = not in that run's top 10
  newRank: number | null
  oldScore: number | null
  newScore: number | null
  moved: number | null // + = moved up, - = moved down, null = entered or left the top 10
}

export type WeightChange = { key: WeightKey; from: number; to: number }

export type Comparison = {
  rows: ComparisonRow[] // in the new order; listings that left the top 10 at the end
  changes: WeightChange[]
  oldTop: MatcherRankEntry | null // the Matcher's #1
  newTop: MatcherRankEntry | null
  recommendedBefore: string | null // the debate's final pick (title)
  recommendedAfter: string | null
  cause: string | null // the measured reason for the biggest change, in one sentence
}

// How much a part moved the score gap between two listings, when the weights changed.
// The score is sum(weight x part) / sum(weights), with risk subtracted, so part k adds
// share_k x part_k (or takes it away for risk). For "B over A", the gap's part k is
// share_k x (B_k - A_k); the change caused by the new weights is new share minus old share.
function biggestCause(a: MatcherRankEntry, b: MatcherRankEntry, oldW: MatcherWeights, newW: MatcherWeights) {
  const share = (w: MatcherWeights, k: WeightKey) => (total(w) === 0 ? 0 : w[k] / total(w))
  const effects = WEIGHT_KEYS.map((k) => {
    const sign = k === 'risk_penalty' ? -1 : 1
    const gapPart = sign * (b.parts[k] - a.parts[k])
    return { key: k, effect: (share(newW, k) - share(oldW, k)) * gapPart }
  })
  return effects.sort((x, y) => y.effect - x.effect)[0]
}

export function compareRuns(original: AiResult, rerun: AiResult): Comparison {
  const oldList = original.matcher_ranking
  const newList = rerun.matcher_ranking
  const ids = [...new Set([...newList.map((e) => e.property_id), ...oldList.map((e) => e.property_id)])]
  const rows: ComparisonRow[] = ids.map((id) => {
    const o = oldList.find((e) => e.property_id === id)
    const n = newList.find((e) => e.property_id === id)
    return {
      property_id: id,
      title: (n ?? o)!.title,
      oldRank: o?.rank ?? null,
      newRank: n?.rank ?? null,
      oldScore: o?.score ?? null,
      newScore: n?.score ?? null,
      moved: o && n ? o.rank - n.rank : null,
    }
  })
  rows.sort((x, y) => (x.newRank ?? 99) - (y.newRank ?? 99) || (x.oldRank ?? 99) - (y.oldRank ?? 99))

  const changes = WEIGHT_KEYS.filter((k) => original.weights[k] !== rerun.weights[k]).map((k) => ({
    key: k,
    from: original.weights[k],
    to: rerun.weights[k],
  }))

  const oldTop = oldList[0] ?? null
  const newTop = newList[0] ?? null
  let cause: string | null = null
  // A listing's parts are measurements, the same in both runs: take them from whichever list has it.
  const partsOf = (id: string) => newList.find((e) => e.property_id === id) ?? oldList.find((e) => e.property_id === id)!
  if (oldTop && newTop && oldTop.property_id !== newTop.property_id && changes.length > 0) {
    const c = biggestCause(partsOf(oldTop.property_id), partsOf(newTop.property_id), original.weights, rerun.weights)
    const ch = changes.find((x) => x.key === c.key)
    cause =
      `The Matcher’s #1 changed from ${oldTop.title} to ${newTop.title} mainly because of ${WEIGHT_LABELS[c.key].toLowerCase()}` +
      (ch ? ` (${ch.from.toFixed(2)} → ${ch.to.toFixed(2)})` : ' (its share changed when other weights moved)') +
      `: it moved the score gap by ${c.effect >= 0 ? '+' : ''}${c.effect.toFixed(3)} in ${newTop.title}’s favour.`
  } else if (changes.length > 0) {
    // #1 unchanged: explain the biggest climber against the listing it passed.
    const climber = rows.filter((r) => (r.moved ?? 0) > 0).sort((x, y) => (y.moved ?? 0) - (x.moved ?? 0))[0]
    const passed = climber ? oldList.find((e) => e.rank === climber.newRank) : undefined
    if (climber && passed && passed.property_id !== climber.property_id) {
      const c = biggestCause(partsOf(passed.property_id), partsOf(climber.property_id), original.weights, rerun.weights)
      cause = `The Matcher’s #1 did not change. The biggest move: ${climber.title} up ${climber.moved}, past ${passed.title}, mainly because of ${WEIGHT_LABELS[c.key].toLowerCase()}.`
    } else {
      cause = 'The Matcher’s #1 did not change, and no listing moved up.'
    }
  }

  return {
    rows,
    changes,
    oldTop,
    newTop,
    recommendedBefore: original.recommended?.title ?? null,
    recommendedAfter: rerun.recommended?.title ?? null,
    cause,
  }
}
