// The "Request to book" panel on the property page: dates, guests, an optional
// message, a price preview, and the request itself (POST /bookings/request).
// The dates live in the page (the calendar shows them too), so they come in as props.
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { newIdempotencyKey, requestBooking } from '../api/bookings'
import { ApiError, errorMessage } from '../api/client'
import { stayHasUnavailableNight } from '../availability'
import { clockTime, localDate, nightsBetween } from '../dates'
import { AVAILABILITY_REASON_TEXT, formatPrice, plural } from '../labels'
import { notificationLatencyMs, type LiveUpdate } from '../realtime/useAvailabilityStream'
import type { AvailabilityBlock } from '../types/availability'
import type { Property } from '../types/property'
import ErrorBanner from './ErrorBanner'

type Props = {
  property: Property
  blocks: AvailabilityBlock[]
  guestId: string
  checkIn: string
  checkOut: string
  guests: number
  onCheckInChange: (value: string) => void
  onCheckOutChange: (value: string) => void
  onGuestsChange: (value: number) => void
  // The live update (spec 13.4) that just took some of the picked nights, if any.
  liveClash: LiveUpdate | undefined
}

// What went wrong with the last request, kept with its code so we can add a link
// for DUPLICATE_BOOKING.
type RequestError = { message: string; code?: string; reservationId?: string }

const labelClass = 'font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase'
const inputClass =
  'w-full rounded-full border border-line bg-surface-2 px-4 py-2 text-fg focus:border-mustard focus:outline-none [color-scheme:dark]'

function BookingPanel(props: Props) {
  const { property, blocks, guestId, checkIn, checkOut, guests } = props
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<RequestError | null>(null)
  // The idempotency key of the last attempt, and the form values it was for.
  // Retrying with the same values reuses the key, so the server can't create the booking twice.
  const [lastAttempt, setLastAttempt] = useState<{ values: string; key: string } | null>(null)

  const datesPicked = checkIn !== '' && checkOut !== ''
  const nights = datesPicked ? nightsBetween(checkIn, checkOut) : 0
  const subtotal = nights * property.nightly_price
  // Any picked night that is taken blocks the request (team decision R4a). The server's
  // 409 DATE_CONFLICT stays as the backstop if a request still gets through.
  const looksUnavailable = datesPicked && stayHasUnavailableNight(blocks, checkIn, checkOut)
  const inactive = property.status !== 'active'

  // Keep nothing of the old dates: the guest picks again (R5a).
  function chooseNewDates() {
    props.onCheckInChange('')
    props.onCheckOutChange('')
  }

  function changeCheckIn(value: string) {
    props.onCheckInChange(value)
    // A check-out on or before the new check-in no longer makes sense: clear it.
    if (checkOut && value && checkOut <= value) props.onCheckOutChange('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const values = JSON.stringify({ checkIn, checkOut, guests, message, guestId })
    const key = lastAttempt?.values === values ? lastAttempt.key : newIdempotencyKey()
    setLastAttempt({ values, key })
    setSubmitting(true)
    setError(null)
    try {
      const reservation = await requestBooking({
        property_id: property.property_id,
        guest_id: guestId,
        check_in: checkIn,
        check_out: checkOut,
        guest_count: guests,
        guest_message: message.trim() || undefined,
        idempotency_key: key,
      })
      // Success: show the new reservation's status page, with a "Request sent" note.
      navigate(`/guest/trips/${reservation.reservation_id}`, { state: { justRequested: true } })
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null
      setError({
        message: errorMessage(err),
        code: apiError?.code,
        reservationId: typeof apiError?.details?.reservation_id === 'string' ? apiError.details.reservation_id : undefined,
      })
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <p>
        <span className="font-condensed text-3xl font-bold">{formatPrice(property.nightly_price)}</span>{' '}
        <span className="text-fg-muted">/ night</span>
      </p>

      {inactive && (
        <p className="rounded-xl border border-line-strong p-3 text-sm text-fg-soft">
          This listing isn’t taking bookings right now.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className={labelClass}>Check-in</span>
          <input type="date" value={checkIn} min={localDate()} onChange={(e) => changeCheckIn(e.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Check-out</span>
          <input
            type="date"
            value={checkOut}
            min={checkIn ? localDate(1, checkIn) : localDate(1)}
            onChange={(e) => props.onCheckOutChange(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className={labelClass}>Guests</span>
        <select value={guests} onChange={(e) => props.onGuestsChange(Number(e.target.value))} className={inputClass}>
          {/* 1 up to this listing's capacity */}
          {Array.from({ length: property.capacity }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {plural(n, 'guest')}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className={labelClass}>Message to the host (optional)</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Say hello and share why you’re visiting"
          className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-2 text-fg placeholder:text-fg-muted focus:border-mustard focus:outline-none"
        />
      </label>

      {/* Hidden while sending: our own request's update arrives here too, just before we move on. */}
      {looksUnavailable && !submitting && (
        <div data-date-clash className="space-y-2 rounded-xl border border-status-error-border p-3 text-sm text-status-error" role="alert">
          {props.liveClash ? (
            <p>
              {AVAILABILITY_REASON_TEXT[props.liveClash.event.payload.reason]} some of these nights (at{' '}
              <span className="font-mono">{clockTime(Date.parse(props.liveClash.event.timestamp))}</span>). They can’t be booked
              any more.
            </p>
          ) : (
            <p>Some of these nights are already taken (struck through in the calendar).</p>
          )}
          {props.liveClash && props.liveClash.shownAt !== null && (
            <p className="text-xs text-fg-muted">This page updated {notificationLatencyMs(props.liveClash)} ms after the change, without a refresh.</p>
          )}
          <button type="button" onClick={chooseNewDates} className="rounded-full border border-line-strong px-3 py-1 font-semibold text-fg hover:bg-surface-2">
            Choose new dates
          </button>
        </div>
      )}

      {datesPicked && nights > 0 && (
        <dl className="space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-fg-soft">
              {formatPrice(property.nightly_price)} × {plural(nights, 'night')}
            </dt>
            <dd className="font-mono">{formatPrice(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-fg-soft">Cleaning fee</dt>
            <dd className="font-mono">{formatPrice(property.cleaning_fee)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-semibold">
            <dt>Total</dt>
            <dd className="font-mono">{formatPrice(subtotal + property.cleaning_fee)}</dd>
          </div>
        </dl>
      )}

      {error && (
        <ErrorBanner message={error.message} onDismiss={() => setError(null)}>
          {error.code === 'DUPLICATE_BOOKING' && error.reservationId && (
            <Link to={`/guest/trips/${error.reservationId}`} className="mt-1 inline-block text-sm font-semibold text-primary hover:underline">
              View your existing request
            </Link>
          )}
        </ErrorBanner>
      )}

      <button
        type="submit"
        disabled={!datesPicked || submitting || inactive || looksUnavailable}
        className="w-full rounded-full bg-primary py-3 font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Sending request…' : 'Request to book'}
      </button>
      {!datesPicked && !inactive && <p className="text-center text-sm text-fg-muted">Pick your dates to see the total.</p>}
      <p className="text-center text-xs text-fg-muted">You won’t be charged. The host approves or declines your request.</p>
    </form>
  )
}

export default BookingPanel
