// Write a review for a completed stay (T2a): five stars + text (20-1000 characters).
// Checks first that the stay belongs to the current guest, is completed, and isn't
// already reviewed; the server enforces the same rules (contract: Review Service).
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { getBooking } from '../../api/bookings'
import { errorMessage } from '../../api/client'
import { getProperty } from '../../api/properties'
import { createReview, reviewsByGuest } from '../../api/reviews'
import ErrorBanner from '../../components/ErrorBanner'
import { StarPicker, StarRating } from '../../components/Stars'
import { useCurrentUser } from '../../context/useCurrentUser'
import { formatDate } from '../../dates'
import type { Property } from '../../types/property'
import type { Reservation } from '../../types/reservation'
import { REVIEW_TEXT_MAX, REVIEW_TEXT_MIN, type Review } from '../../types/review'

function WriteReviewPage() {
  const { reservationId = '' } = useParams()
  const { guestId } = useCurrentUser()
  return <WriteReview key={`${reservationId}|${guestId}`} reservationId={reservationId} guestId={guestId} />
}

function WriteReview({ reservationId, guestId }: { reservationId: string; guestId: string }) {
  const navigate = useNavigate()
  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [property, setProperty] = useState<Property | null>(null)
  const [existing, setExisting] = useState<Review | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const loadedReservation = await getBooking({ reservation_id: reservationId })
        const [loadedProperty, mine] = await Promise.all([
          getProperty({ property_id: loadedReservation.property_id }),
          reviewsByGuest({ guest_id: guestId }),
        ])
        if (ignore) return
        setReservation(loadedReservation)
        setProperty(loadedProperty)
        setExisting(mine.items.find((v) => v.reservation_id === reservationId) ?? null)
        setLoading(false)
      } catch (err) {
        if (ignore) return
        setLoadError(errorMessage(err))
        setLoading(false)
      }
    }
    load()
    return () => {
      ignore = true
    }
  }, [reservationId, guestId, attempt])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    setError(null)
    try {
      await createReview({ reservation_id: reservationId, guest_id: guestId, rating, review_text: text.trim() })
      navigate('/guest/trips?tab=past', { state: { notice: `Thanks for your review of ${property?.title ?? 'your stay'}!` } })
    } catch (err) {
      setError(errorMessage(err))
      setSending(false)
    }
  }

  const backLink = (
    <Link to="/guest/trips?tab=past" className="text-sm font-semibold text-fg-muted hover:text-fg">
      ← My trips
    </Link>
  )
  const message = (text: string) => (
    <section className="space-y-4">
      {backLink}
      <div className="rounded-2xl border border-line bg-surface p-6 text-fg-soft">{text}</div>
    </section>
  )

  if (loading) return <section className="space-y-4">{backLink}<p className="text-fg-muted">Loading your stay…</p></section>
  if (loadError || !reservation || !property) {
    return (
      <section className="space-y-4">
        {backLink}
        <ErrorBanner
          message={loadError ?? 'Something went wrong. Please try again.'}
          onRetry={() => {
            setLoadError(null)
            setLoading(true)
            setAttempt((n) => n + 1)
          }}
        />
      </section>
    )
  }
  if (reservation.guest_id !== guestId) return message('This stay belongs to another guest.')
  if (existing) {
    return (
      <section className="space-y-4">
        {backLink}
        <div className="space-y-2 rounded-2xl border border-line bg-surface p-6">
          <p className="text-fg-soft">You already reviewed {property.title}.</p>
          <StarRating value={existing.rating} />
          <p className="text-fg-soft">“{existing.review_text}”</p>
        </div>
      </section>
    )
  }
  if (reservation.status !== 'completed') return message('You can review a stay once it’s completed.')

  const length = text.trim().length
  const lengthOk = length >= REVIEW_TEXT_MIN && length <= REVIEW_TEXT_MAX

  return (
    <section className="max-w-2xl space-y-6">
      {backLink}
      <div>
        <h1 className="cornice font-display text-3xl font-bold">Review your stay</h1>
        <p className="text-fg-soft">
          {property.title} · {formatDate(reservation.check_in)} → {formatDate(reservation.check_out)}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5 rounded-2xl border border-line bg-surface p-5">
        <StarPicker value={rating} onChange={setRating} />

        <label className="block space-y-1">
          <span className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Your review</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            maxLength={REVIEW_TEXT_MAX}
            placeholder="What was great? What could be better?"
            className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-fg placeholder:text-fg-muted focus:border-gold focus:outline-none"
          />
          <span data-char-count className={`block text-right text-xs ${length > 0 && !lengthOk ? 'text-status-pending' : 'text-fg-muted'}`}>
            {length} / {REVIEW_TEXT_MAX}
            {length < REVIEW_TEXT_MIN && ` · at least ${REVIEW_TEXT_MIN}`}
          </span>
        </label>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <button
          type="submit"
          disabled={sending || rating === 0 || !lengthOk}
          className="rounded-full bg-primary px-6 py-2.5 font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Posting…' : 'Post review'}
        </button>
        <p className="text-xs text-fg-muted">Reviews are public and can’t be edited later. The host can reply once.</p>
      </form>
    </section>
  )
}

export default WriteReviewPage
