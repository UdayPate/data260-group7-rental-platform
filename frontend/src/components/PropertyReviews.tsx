// Reviews section on the property details page (T4a): newest 5, then "Show more".
// The listing's rating/review_count is its whole history; the Review Service may hold
// fewer full reviews (team decision C4a), so we say "Showing N of M".
import { useEffect, useState } from 'react'
import { errorMessage } from '../api/client'
import { reviewsByProperty } from '../api/reviews'
import { loadGuestNames } from '../api/users'
import { formatDate } from '../dates'
import { plural } from '../labels'
import type { Review } from '../types/review'
import ErrorBanner from './ErrorBanner'
import { StarIcon } from './icons'
import { StarRating } from './Stars'

const PAGE_SIZE = 5

type Props = { propertyId: string; rating: number; reviewCount: number }

function PropertyReviews({ propertyId, rating, reviewCount }: Props) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [total, setTotal] = useState(0) // full reviews available from the Review Service
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1) // pages loaded so far; bump to load more

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const result = await reviewsByProperty({ property_id: propertyId, page, page_size: PAGE_SIZE })
        const guestNames = await loadGuestNames(result.items.map((r) => r.guest_id))
        if (ignore) return
        // Page 1 replaces the list, later pages add to it.
        setReviews((prev) => (page === 1 ? result.items : [...prev, ...result.items]))
        setNames((prev) => ({ ...prev, ...guestNames }))
        setTotal(result.total)
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
  }, [propertyId, page])

  function loadMore() {
    setLoading(true)
    setPage((p) => p + 1)
  }

  return (
    <div data-reviews className="space-y-3">
      <h2 className="flex flex-wrap items-center gap-3 font-condensed text-xl font-bold tracking-[0.06em] uppercase">
        Reviews
        {reviewCount > 0 && (
          <span className="flex items-center gap-2 font-sans text-base font-normal tracking-normal normal-case text-fg-soft">
            {/* One star + the exact average: five whole stars would round 4.6 up to "perfect". */}
            <StarIcon className="h-4 w-4 text-mustard" /> {rating.toFixed(2)} · {plural(reviewCount, 'review')}
          </span>
        )}
      </h2>

      {error && (
        <ErrorBanner
          message={error}
          onRetry={() => {
            setError(null)
            setLoading(true)
            setPage(1)
          }}
        />
      )}
      {!error && !loading && reviews.length === 0 && <p className="text-fg-muted">No reviews yet.</p>}

      <ul className="space-y-3">
        {reviews.map((r) => (
          <li key={r.review_id} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <StarRating value={r.rating} />
              <span className="font-semibold">{names[r.guest_id] ?? 'Former guest'}</span>
              <span className="text-sm text-fg-muted">{formatDate(r.created_datetime.slice(0, 10))}</span>
            </div>
            <p className="text-fg-soft">{r.review_text}</p>
            {r.response_text && (
              <div className="rounded-xl border-l-4 border-mustard bg-surface-2 p-3 text-sm">
                <p className="font-semibold text-mustard">Host’s reply</p>
                <p className="text-fg-soft">{r.response_text}</p>
              </div>
            )}
          </li>
        ))}
      </ul>

      {loading && <p className="text-fg-muted">Loading reviews…</p>}
      {!loading && reviews.length < total && (
        <button type="button" onClick={loadMore} className="rounded-full border border-line-strong px-5 py-2 font-semibold hover:bg-surface">
          Show more reviews
        </button>
      )}
      {!loading && reviews.length > 0 && reviewCount > total && (
        <p data-review-note className="text-sm text-fg-muted">
          Showing {reviews.length} of {plural(reviewCount, 'review')}. Older reviews aren’t available here.
        </p>
      )}
    </div>
  )
}

export default PropertyReviews
