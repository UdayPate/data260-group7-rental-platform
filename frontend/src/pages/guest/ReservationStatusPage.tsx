// One reservation's status (guest): status badge with an explanation, the stay details,
// the price breakdown, a Refresh button (D8a) and a Cancel button (D7a).
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { cancelBooking, getBooking, newIdempotencyKey } from '../../api/bookings'
import { errorMessage } from '../../api/client'
import { getProperty } from '../../api/properties'
import ErrorBanner from '../../components/ErrorBanner'
import MessageButton from '../../components/MessageButton'
import StatusBadge from '../../components/StatusBadge'
import { useCurrentUser } from '../../context/useCurrentUser'
import { formatDate, formatDateTime, localDate } from '../../dates'
import { formatPrice, plural } from '../../labels'
import type { Property } from '../../types/property'
import type { Reservation } from '../../types/reservation'

function ReservationStatusPage() {
  const { reservationId = '' } = useParams()
  const { guestId } = useCurrentUser()
  return <ReservationStatus key={`${reservationId}|${guestId}`} reservationId={reservationId} guestId={guestId} />
}

// What each status means for the guest.
function statusExplanation(reservation: Reservation): string {
  switch (reservation.status) {
    case 'pending':
      return 'Waiting for the host to respond. Your dates are held until then.'
    case 'approved':
      return `Confirmed by the host. Check-in is ${formatDate(reservation.check_in)}.`
    case 'declined':
      return 'The host declined this request. Your dates were released.'
    case 'cancelled':
      return 'This reservation was cancelled. The dates were released.'
    case 'completed':
      return 'This stay is complete.'
  }
}

type Props = { reservationId: string; guestId: string }

function ReservationStatus({ reservationId, guestId }: Props) {
  const location = useLocation()
  // Set by the booking panel when it sends us here right after a successful request.
  const justRequested = (location.state as { justRequested?: boolean } | null)?.justRequested === true

  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0) // bumped by Retry and Refresh

  // Cancel flow: a confirm box with an optional reason.
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [reason, setReason] = useState('')
  const [cancelKey, setCancelKey] = useState('') // one idempotency key per confirm box, reused on retry
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const loadedReservation = await getBooking({ reservation_id: reservationId })
        const loadedProperty = await getProperty({ property_id: loadedReservation.property_id })
        if (ignore) return
        setReservation(loadedReservation)
        setProperty(loadedProperty)
        setError(null)
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
  }, [reservationId, attempt])

  function reload() {
    setLoading(true)
    setAttempt((n) => n + 1)
  }

  function openCancel() {
    setConfirmingCancel(true)
    setReason('')
    setCancelError(null)
    setCancelKey(newIdempotencyKey())
  }

  async function confirmCancel() {
    if (!reservation) return
    setCancelling(true)
    setCancelError(null)
    try {
      const updated = await cancelBooking({
        reservation_id: reservation.reservation_id,
        guest_id: guestId,
        cancellation_reason: reason.trim(),
        idempotency_key: cancelKey,
      })
      setReservation(updated)
      setConfirmingCancel(false)
    } catch (err) {
      setCancelError(errorMessage(err))
    } finally {
      setCancelling(false)
    }
  }

  const backLink = (
    <Link to="/guest/trips" className="text-sm font-semibold text-fg-muted hover:text-fg">
      ← My trips
    </Link>
  )

  if (loading) {
    return (
      <section className="space-y-4">
        {backLink}
        <h1 className="font-condensed text-3xl font-bold tracking-[0.06em] text-fg-muted uppercase">Loading reservation…</h1>
      </section>
    )
  }

  if (error || !reservation || !property) {
    return (
      <section className="space-y-4">
        {backLink}
        <ErrorBanner message={error ?? 'Something went wrong. Please try again.'} onRetry={reload} />
      </section>
    )
  }

  // No login yet, so anyone can type a reservation URL. Only its own guest sees it (D11a).
  if (reservation.guest_id !== guestId) {
    return (
      <section className="space-y-4">
        {backLink}
        <div className="rounded-2xl border border-line bg-surface p-6">
          <p className="text-fg-soft">This reservation belongs to another guest.</p>
          <p className="mt-1 text-sm text-fg-muted">Log in as that guest to see it.</p>
        </div>
      </section>
    )
  }

  const { price_breakdown: price } = reservation
  // Guests can cancel pending or approved stays before the check-in day (team rule).
  const canCancel =
    (reservation.status === 'pending' || reservation.status === 'approved') && reservation.check_in > localDate()

  return (
    <section className="max-w-3xl space-y-6">
      {backLink}

      {justRequested && reservation.status === 'pending' && (
        <div className="rounded-2xl border border-status-ok bg-surface px-4 py-3 text-status-ok" role="status">
          Request sent! The host will approve or decline it.
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-bold">Your reservation</h1>
          <StatusBadge status={reservation.status} />
        </div>
        <p className="text-fg-soft">{statusExplanation(reservation)}</p>
        {reservation.cancellation_reason && (
          <p className="text-sm text-fg-muted">Reason: {reservation.cancellation_reason}</p>
        )}
        <p className="font-mono text-sm text-fg-muted">
          {reservation.reservation_id} · requested {formatDateTime(reservation.booking_datetime)}
        </p>
        {/* The id of this booking's journey. Only the admin can open journeys; a guest can quote it to support. */}
        <p className="font-mono text-xs text-fg-muted">trace_id {reservation.trace_id}</p>
      </div>

      <div className="grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Link to={`/properties/${property.property_id}`} className="font-condensed text-2xl font-bold hover:underline">
            {property.title}
          </Link>
          <p className="text-sm text-fg-muted">
            {property.address}, {property.city}
          </p>
        </div>
        <div>
          <p className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Dates</p>
          <p>
            {formatDate(reservation.check_in)} → {formatDate(reservation.check_out)} ({plural(price.nights, 'night')})
          </p>
        </div>
        <div>
          <p className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Guests</p>
          <p>{plural(reservation.guest_count, 'guest')}</p>
        </div>
        {reservation.guest_message && (
          <div className="sm:col-span-2">
            <p className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Your message</p>
            <p className="text-fg-soft">“{reservation.guest_message}”</p>
          </div>
        )}
        <dl className="space-y-1 border-t border-line pt-3 text-sm sm:col-span-2">
          <div className="flex justify-between">
            <dt className="text-fg-soft">
              {formatPrice(price.nightly_price)} × {plural(price.nights, 'night')}
            </dt>
            <dd className="font-mono">{formatPrice(price.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-fg-soft">Cleaning fee</dt>
            <dd className="font-mono">{formatPrice(price.cleaning_fee)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-semibold">
            <dt>Total</dt>
            <dd className="font-mono">{formatPrice(price.total)}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reload}
          className="rounded-full border border-line-strong px-5 py-2 font-semibold hover:bg-surface"
        >
          Refresh status
        </button>
        <MessageButton
          label="Message host"
          inbox="/guest/messages"
          className="px-5 py-2 text-base"
          request={{
            guest_id: guestId,
            host_id: property.host_id,
            property_id: property.property_id,
            reservation_id: reservation.reservation_id,
            actor_id: guestId,
          }}
        />
        {canCancel && !confirmingCancel && (
          <button
            type="button"
            onClick={openCancel}
            className="rounded-full border border-status-error-border px-5 py-2 font-semibold text-status-error hover:bg-surface"
          >
            {reservation.status === 'pending' ? 'Cancel request' : 'Cancel reservation'}
          </button>
        )}
      </div>

      {confirmingCancel && (
        <div className="space-y-3 rounded-2xl border border-status-error-border bg-surface p-5">
          <p className="font-semibold">Cancel this {reservation.status === 'pending' ? 'request' : 'reservation'}?</p>
          <label className="block space-y-1">
            <span className="text-sm text-fg-muted">Reason (optional, shared with the host)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-2 text-fg focus:border-mustard focus:outline-none"
            />
          </label>
          {cancelError && <ErrorBanner message={cancelError} onDismiss={() => setCancelError(null)} />}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={confirmCancel}
              disabled={cancelling}
              className="rounded-full bg-status-error px-5 py-2 font-semibold text-bg disabled:opacity-60"
            >
              {cancelling ? 'Cancelling…' : 'Yes, cancel'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingCancel(false)}
              className="rounded-full border border-line-strong px-5 py-2 font-semibold hover:bg-surface-2"
            >
              Keep it
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default ReservationStatusPage
