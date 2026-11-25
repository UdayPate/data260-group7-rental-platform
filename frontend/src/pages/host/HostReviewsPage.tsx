// Host: reviews of my listings (T3a). Tabs "Needs a reply" / "All", a listing filter,
// and an inline reply (once per review; the server enforces it).
// Loads the host's listings, then /reviews/byProperty for each (reviews carry the guest's name).
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { errorMessage } from '../../api/client'
import { searchProperties } from '../../api/properties'
import { respondToReview, reviewsByProperty } from '../../api/reviews'
import ErrorBanner from '../../components/ErrorBanner'
import { StarRating } from '../../components/Stars'
import { useCurrentUser } from '../../context/useCurrentUser'
import { formatDateTime } from '../../dates'
import type { Property } from '../../types/property'
import { RESPONSE_TEXT_MAX, RESPONSE_TEXT_MIN, type Review } from '../../types/review'

function HostReviewsPage() {
  const { hostId } = useCurrentUser()
  const [attempt, setAttempt] = useState(0)
  return <HostReviews key={`${hostId}|${attempt}`} hostId={hostId} onReload={() => setAttempt((n) => n + 1)} />
}

function HostReviews({ hostId, onReload }: { hostId: string; onReload: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'all' ? 'all' : 'needs_reply'
  const listingFilter = searchParams.get('listing') ?? ''

  const [listings, setListings] = useState<Property[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const mine = await searchProperties({ host_id: hostId, page: 1, page_size: 100 })
        const pages = await Promise.all(mine.items.map((p) => reviewsByProperty({ property_id: p.property_id, page: 1, page_size: 100 })))
        const all = pages.flatMap((p) => p.items).sort((a, b) => b.created_datetime.localeCompare(a.created_datetime))
        if (ignore) return
        setListings(mine.items)
        setReviews(all)
        setLoading(false)
      } catch (err) {
        if (ignore) return
        setError(errorMessage(err))
        setLoading(false)
      }
    }
    load()
    return () => {
      ignore = true
    }
  }, [hostId])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  const inListing = reviews.filter((r) => !listingFilter || r.property_id === listingFilter)
  const needsReply = inListing.filter((r) => r.response_text === null)
  const shown = tab === 'all' ? inListing : needsReply
  const titleOf = (id: string) => listings.find((p) => p.property_id === id)?.title ?? id
  const replaced = (updated: Review) => setReviews((prev) => prev.map((r) => (r.review_id === updated.review_id ? updated : r)))

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="cornice font-display text-3xl font-bold">Reviews</h1>
        <div className="flex items-center gap-3">
          <select
            value={listingFilter}
            onChange={(e) => setParam('listing', e.target.value)}
            aria-label="Filter by listing"
            className="rounded-full border border-line bg-surface-2 px-4 py-2 text-sm text-fg"
          >
            <option value="">All listings</option>
            {listings.map((p) => (
              <option key={p.property_id} value={p.property_id}>
                {p.title}
              </option>
            ))}
          </select>
          <button type="button" onClick={onReload} className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-surface">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-2" role="tablist">
        {[
          { id: 'needs_reply', label: `Needs a reply (${needsReply.length})` },
          { id: 'all', label: `All (${inListing.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParam('tab', t.id === 'all' ? 'all' : '')}
            className={`rounded-full border px-4 py-1.5 font-semibold ${
              tab === t.id ? 'border-gold-border bg-gold text-bg' : 'border-line text-fg-muted hover:text-fg'
            }`}
          >
            {loading ? t.label.replace(/ \(\d+\)/, '') : t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-fg-muted">Loading reviews…</p>}
      {error && <ErrorBanner message={error} onRetry={onReload} />}
      {!loading && !error && shown.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-fg-soft">
          {tab === 'all' ? 'No reviews yet.' : 'You’ve replied to every review.'}
        </div>
      )}

      <ul className="space-y-4">
        {!loading &&
          shown.map((r) => (
            <HostReviewCard key={r.review_id} review={r} hostId={hostId} guestName={r.guest_name} listingTitle={titleOf(r.property_id)} onReplied={replaced} />
          ))}
      </ul>
    </section>
  )
}

type CardProps = { review: Review; hostId: string; guestName: string; listingTitle: string; onReplied: (r: Review) => void }

function HostReviewCard({ review, hostId, guestName, listingTitle, onReplied }: CardProps) {
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const length = reply.trim().length
  const lengthOk = length >= RESPONSE_TEXT_MIN && length <= RESPONSE_TEXT_MAX

  async function send() {
    setSending(true)
    setError(null)
    try {
      onReplied(await respondToReview({ review_id: review.review_id, host_id: hostId, response_text: reply.trim() }))
    } catch (err) {
      setError(errorMessage(err))
      setSending(false)
    }
  }

  return (
    <li data-review={review.review_id} className="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <StarRating value={review.rating} />
        <span className="font-semibold">{guestName}</span>
        <span className="text-sm text-fg-muted">
          {listingTitle} · {formatDateTime(review.created_datetime)} · <span className="font-mono">{review.reservation_id}</span>
        </span>
      </div>
      <p className="text-fg-soft">“{review.review_text}”</p>

      {review.response_text !== null ? (
        <div className="rounded-xl border-l-4 border-gold bg-surface-2 p-3 text-sm">
          <p className="font-semibold text-gold">Your reply</p>
          <p className="text-fg-soft">{review.response_text}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-sm text-fg-muted">Reply publicly (once)</span>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              maxLength={RESPONSE_TEXT_MAX}
              className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-2 text-fg focus:border-gold focus:outline-none"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-fg-muted">
              {length} / {RESPONSE_TEXT_MAX}
              {length < RESPONSE_TEXT_MIN && ` · at least ${RESPONSE_TEXT_MIN}`}
            </span>
            <button
              type="button"
              onClick={send}
              disabled={sending || !lengthOk}
              className="rounded-full bg-primary px-5 py-1.5 font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? 'Posting…' : 'Post reply'}
            </button>
          </div>
        </div>
      )}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <Link to={`/properties/${review.property_id}`} className="inline-block text-sm text-fg-muted hover:text-fg">
        View listing →
      </Link>
    </li>
  )
}

export default HostReviewsPage
