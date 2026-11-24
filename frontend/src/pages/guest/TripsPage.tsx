// Guest "My trips" (T1a): a "To review" callout for completed stays without a review,
// then tabs Upcoming / Past / Cancelled. Loads the guest's reservations, the listings'
// titles, and the guest's own reviews (POST /reviews/byGuest).
import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { bookingsByGuest } from '../../api/bookings'
import { errorMessage } from '../../api/client'
import { getProperty } from '../../api/properties'
import { reviewsByGuest } from '../../api/reviews'
import ErrorBanner from '../../components/ErrorBanner'
import { StarRating } from '../../components/Stars'
import StatusBadge from '../../components/StatusBadge'
import { useCurrentUser } from '../../context/useCurrentUser'
import { formatDate, localDate } from '../../dates'
import { formatPrice, plural } from '../../labels'
import type { Property } from '../../types/property'
import type { Reservation } from '../../types/reservation'
import type { Review } from '../../types/review'

type Tab = 'upcoming' | 'past' | 'cancelled'

const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'cancelled', label: 'Cancelled' },
]

// Which tab a reservation belongs in.
function tabOf(r: Reservation): Tab {
  if (r.status === 'cancelled' || r.status === 'declined') return 'cancelled'
  if ((r.status === 'pending' || r.status === 'approved') && r.check_out > localDate()) return 'upcoming'
  return 'past' // completed, or approved and already over
}

function TripsPage() {
  const { guestId } = useCurrentUser()
  return <Trips key={guestId} guestId={guestId} />
}

function Trips({ guestId }: { guestId: string }) {
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = tabParam === 'past' || tabParam === 'cancelled' ? tabParam : 'upcoming'

  const [reservations, setReservations] = useState<Reservation[]>([])
  const [listings, setListings] = useState<Record<string, Property | null>>({}) // null = listing no longer exists
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const [bookings, mine] = await Promise.all([bookingsByGuest({ guest_id: guestId }), reviewsByGuest({ guest_id: guestId })])
        // Titles for each listing; a deleted listing just shows as unavailable.
        const ids = [...new Set(bookings.items.map((r) => r.property_id))]
        const loaded = await Promise.all(ids.map((id) => getProperty({ property_id: id }).catch(() => null)))
        if (ignore) return
        const byId: Record<string, Property | null> = {}
        ids.forEach((id, i) => (byId[id] = loaded[i]))
        setReservations(bookings.items)
        setReviews(mine.items)
        setListings(byId)
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
  }, [guestId, attempt])

  const reviewFor = (reservationId: string) => reviews.find((v) => v.reservation_id === reservationId)
  // Completed stays without a review: the "To review" prompts.
  const toReview = reservations.filter((r) => r.status === 'completed' && !reviewFor(r.reservation_id))
  const shown = reservations
    .filter((r) => tabOf(r) === tab)
    .sort((a, b) => (tab === 'upcoming' ? a.check_in.localeCompare(b.check_in) : b.check_in.localeCompare(a.check_in)))
  const count = (t: Tab) => reservations.filter((r) => tabOf(r) === t).length
  const titleOf = (propertyId: string) => listings[propertyId]?.title ?? 'Listing no longer available'

  return (
    <section className="space-y-6">
      <h1 className="font-display text-4xl font-bold">My trips</h1>

      {notice && (
        <div role="status" className="rounded-2xl border border-status-ok bg-surface px-4 py-3 text-status-ok">
          {notice}
        </div>
      )}
      {error && (
        <ErrorBanner
          message={error}
          onRetry={() => {
            setError(null)
            setLoading(true)
            setAttempt((n) => n + 1)
          }}
        />
      )}
      {loading && <p className="text-fg-muted">Loading your trips…</p>}

      {!loading && !error && toReview.length > 0 && (
        <div data-to-review className="space-y-3 rounded-2xl border border-cream-border bg-cream p-4 text-cream-ink">
          <p className="font-condensed text-lg font-bold tracking-[0.06em] uppercase">To review</p>
          {toReview.map((r) => (
            <div key={r.reservation_id} className="flex flex-wrap items-center justify-between gap-3">
              <p>
                How was <strong>{titleOf(r.property_id)}</strong>?{' '}
                <span className="text-cream-ink-soft">
                  {formatDate(r.check_in)} → {formatDate(r.check_out)}
                </span>
              </p>
              <Link to={`/guest/reviews/new/${r.reservation_id}`} className="rounded-full bg-primary px-4 py-1.5 font-semibold text-on-primary hover:brightness-110">
                Write a review
              </Link>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="flex gap-2" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setSearchParams(t.id === 'upcoming' ? {} : { tab: t.id })}
                className={`rounded-full border px-4 py-1.5 font-semibold ${
                  tab === t.id ? 'border-mustard-border bg-mustard text-bg' : 'border-line text-fg-muted hover:text-fg'
                }`}
              >
                {t.label} ({count(t.id)})
              </button>
            ))}
          </div>

          {shown.length === 0 && (
            <div className="rounded-2xl border border-line bg-surface p-8 text-center text-fg-soft">
              {tab === 'upcoming' ? (
                <>
                  No upcoming trips.{' '}
                  <Link to="/" className="font-semibold text-primary hover:underline">
                    Find a stay
                  </Link>
                </>
              ) : tab === 'past' ? (
                'No past stays yet.'
              ) : (
                'No cancelled trips.'
              )}
            </div>
          )}

          <ul className="space-y-3">
            {shown.map((r) => {
              const review = reviewFor(r.reservation_id)
              return (
                <li key={r.reservation_id} data-trip={r.reservation_id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link to={`/guest/trips/${r.reservation_id}`} className="font-condensed text-xl font-bold hover:underline">
                        {titleOf(r.property_id)}
                      </Link>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-fg-soft">
                      {listings[r.property_id]?.city ? `${listings[r.property_id]!.city} · ` : ''}
                      {formatDate(r.check_in)} → {formatDate(r.check_out)} · {plural(r.price_breakdown.nights, 'night')} ·{' '}
                      {plural(r.guest_count, 'guest')} · <span className="font-mono">{formatPrice(r.price_breakdown.total)}</span>
                    </p>
                    {r.cancellation_reason && <p className="text-sm text-fg-muted">Reason: {r.cancellation_reason}</p>}
                    {review && (
                      <p className="flex items-center gap-2 text-sm text-fg-muted">
                        Your review: <StarRating value={review.rating} />
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {r.status === 'completed' && !review && (
                      <Link to={`/guest/reviews/new/${r.reservation_id}`} className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary">
                        Write a review
                      </Link>
                    )}
                    <Link to={`/guest/trips/${r.reservation_id}`} className="rounded-full border border-line-strong px-4 py-1.5 text-sm font-semibold hover:bg-surface-2">
                      Details
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

export default TripsPage
