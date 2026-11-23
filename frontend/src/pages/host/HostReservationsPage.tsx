// Host: reservation requests for all of the host's listings (U6a).
// Tabs: Requests (pending) / Upcoming (approved, not over) / Past & closed.
// Approve is one click; Decline and Cancel need a reason (U8a). The server enforces
// the booking rules (contract §5) and its errors are shown in the row.
//
// There's no "bookings by host" endpoint, so (U7a) we load the host's listings,
// then /bookings/byProperty for each, then /guests/get for the guest names.
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { approveBooking, bookingsByProperty, cancelBooking, declineBooking, newIdempotencyKey } from '../../api/bookings'
import { errorMessage } from '../../api/client'
import { searchProperties } from '../../api/properties'
import { getGuest } from '../../api/users'
import ErrorBanner from '../../components/ErrorBanner'
import StatusBadge from '../../components/StatusBadge'
import { useCurrentUser } from '../../context/useCurrentUser'
import { formatDate, formatDateTime, localDate } from '../../dates'
import { formatPrice, plural } from '../../labels'
import type { Property } from '../../types/property'
import type { Reservation } from '../../types/reservation'

type Tab = 'requests' | 'upcoming' | 'past'

const TABS: { id: Tab; label: string }[] = [
  { id: 'requests', label: 'Requests' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past & closed' },
]

// Which tab a reservation belongs in.
function tabOf(r: Reservation): Tab {
  if (r.status === 'pending') return 'requests'
  if (r.status === 'approved' && r.check_out > localDate()) return 'upcoming'
  return 'past'
}

function HostReservationsPage() {
  const { hostId } = useCurrentUser()
  const [attempt, setAttempt] = useState(0) // bumped by Refresh / Retry
  return <HostReservations key={`${hostId}|${attempt}`} hostId={hostId} onReload={() => setAttempt((n) => n + 1)} />
}

function HostReservations({ hostId, onReload }: { hostId: string; onReload: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = tabParam === 'upcoming' || tabParam === 'past' ? tabParam : 'requests'
  const listingFilter = searchParams.get('listing') ?? '' // '' = all listings

  const [listings, setListings] = useState<Property[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [guestNames, setGuestNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const mine = await searchProperties({ host_id: hostId, page: 1, page_size: 100 })
        // One request per listing, all at the same time.
        const lists = await Promise.all(mine.items.map((p) => bookingsByProperty({ property_id: p.property_id })))
        const all = lists.flatMap((list) => list.items)
        // Guest names; a guest that can't be loaded (e.g. deleted) just shows its id.
        const guestIds = [...new Set(all.map((r) => r.guest_id))]
        const guests = await Promise.all(guestIds.map((id) => getGuest({ guest_id: id }).catch(() => null)))
        if (ignore) return
        const names: Record<string, string> = {}
        for (const g of guests) if (g) names[g.guest_id] = `${g.first_name} ${g.last_name}`
        setListings(mine.items)
        setReservations(all)
        setGuestNames(names)
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

  // A row finished an action: swap in the server's updated reservation.
  function updated(reservation: Reservation, message: string) {
    setReservations((previous) => previous.map((r) => (r.reservation_id === reservation.reservation_id ? reservation : r)))
    setNotice(message)
  }

  const titleOf = (propertyId: string) => listings.find((p) => p.property_id === propertyId)?.title ?? propertyId
  const inListing = reservations.filter((r) => !listingFilter || r.property_id === listingFilter)
  const countFor = (t: Tab) => inListing.filter((r) => tabOf(r) === t).length
  const shown = inListing
    .filter((r) => tabOf(r) === tab)
    // Requests and upcoming: soonest check-in first. Past: most recent first.
    .sort((a, b) => (tab === 'past' ? b.check_in.localeCompare(a.check_in) : a.check_in.localeCompare(b.check_in)))

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-condensed text-3xl font-bold tracking-[0.06em] uppercase">Reservations</h1>
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
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParam('tab', t.id === 'requests' ? '' : t.id)}
            className={`rounded-full border px-4 py-1.5 font-semibold ${
              tab === t.id ? 'border-mustard-border bg-mustard text-bg' : 'border-line text-fg-muted hover:text-fg'
            }`}
          >
            {t.label} {!loading && !error && `(${countFor(t.id)})`}
          </button>
        ))}
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-2xl border border-status-ok bg-surface px-4 py-3 text-status-ok" role="status">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="text-sm font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {loading && <p className="text-fg-muted">Loading reservations…</p>}
      {error && <ErrorBanner message={error} onRetry={onReload} />}

      {!loading && !error && shown.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-fg-soft">
          {tab === 'requests' ? 'No requests waiting for you.' : tab === 'upcoming' ? 'No upcoming stays.' : 'Nothing here yet.'}
        </div>
      )}

      {!loading && !error && (
        <ul className="space-y-4">
          {shown.map((r) => (
            <ReservationRow
              key={r.reservation_id}
              reservation={r}
              listingTitle={titleOf(r.property_id)}
              guestName={guestNames[r.guest_id] ?? 'Unknown guest'}
              hostId={hostId}
              onUpdated={updated}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------- One reservation with its actions ----------

type RowProps = {
  reservation: Reservation
  listingTitle: string
  guestName: string
  hostId: string
  onUpdated: (reservation: Reservation, message: string) => void
}

type Action = 'approve' | 'decline' | 'cancel'

function ReservationRow({ reservation: r, listingTitle, guestName, hostId, onUpdated }: RowProps) {
  const [openBox, setOpenBox] = useState<'decline' | 'cancel' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One idempotency key per action, reused if that action is retried after an error.
  // A ref (not state) because changing it doesn't need to redraw anything.
  const keys = useRef(new Map<Action, string>())

  function keyFor(action: Action): string {
    if (!keys.current.has(action)) keys.current.set(action, newIdempotencyKey())
    return keys.current.get(action)!
  }

  async function run(action: Action) {
    setBusy(true)
    setError(null)
    const base = { reservation_id: r.reservation_id, host_id: hostId, idempotency_key: keyFor(action) }
    try {
      let result: Reservation
      if (action === 'approve') result = await approveBooking(base)
      else if (action === 'decline') result = await declineBooking({ ...base, reason: reason.trim() })
      else result = await cancelBooking({ ...base, cancellation_reason: reason.trim() })
      keys.current.delete(action)
      const verb = action === 'approve' ? 'Approved' : action === 'decline' ? 'Declined' : 'Cancelled'
      onUpdated(result, `${verb} ${guestName}’s stay at ${listingTitle} (${r.reservation_id}).`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  function open(box: 'decline' | 'cancel') {
    setOpenBox(box)
    setReason('')
    setError(null)
  }

  const canCancel = r.status === 'approved' && r.check_in > localDate()

  return (
    <li className="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-condensed text-xl font-bold">{guestName}</p>
            <StatusBadge status={r.status} />
          </div>
          <p className="text-fg-soft">
            {listingTitle} · {formatDate(r.check_in)} → {formatDate(r.check_out)} ({plural(r.price_breakdown.nights, 'night')}) ·{' '}
            {plural(r.guest_count, 'guest')} · <span className="font-mono">{formatPrice(r.price_breakdown.total)}</span>
          </p>
          <p className="font-mono text-xs text-fg-muted">
            {r.reservation_id} · {r.guest_id} · requested {formatDateTime(r.booking_datetime)}
          </p>
          {r.guest_message && <p className="text-fg-soft">“{r.guest_message}”</p>}
          {r.cancellation_reason && <p className="text-sm text-fg-muted">Reason: {r.cancellation_reason}</p>}
        </div>

        {openBox === null && (
          <div className="flex gap-2">
            {r.status === 'pending' && (
              <>
                <button
                  type="button"
                  onClick={() => run('approve')}
                  disabled={busy}
                  className="rounded-full bg-primary px-5 py-2 font-semibold text-on-primary hover:brightness-110 disabled:opacity-60"
                >
                  {busy ? 'Approving…' : 'Approve'}
                </button>
                <button
                  type="button"
                  onClick={() => open('decline')}
                  disabled={busy}
                  className="rounded-full border border-status-error-border px-5 py-2 font-semibold text-status-error hover:bg-surface-2"
                >
                  Decline
                </button>
              </>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => open('cancel')}
                className="rounded-full border border-status-error-border px-5 py-2 font-semibold text-status-error hover:bg-surface-2"
              >
                Cancel stay
              </button>
            )}
          </div>
        )}
      </div>

      {openBox !== null && (
        <div className="space-y-3 rounded-2xl border border-status-error-border p-4">
          <label className="block space-y-1">
            <span className="text-sm text-fg-soft">
              {openBox === 'decline' ? 'Why are you declining? (shared with the guest)' : 'Why are you cancelling? (shared with the guest)'}
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-2 text-fg focus:border-mustard focus:outline-none"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => run(openBox)}
              disabled={busy || reason.trim() === ''}
              className="rounded-full bg-status-error px-5 py-2 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Sending…' : openBox === 'decline' ? 'Decline request' : 'Cancel stay'}
            </button>
            <button type="button" onClick={() => setOpenBox(null)} className="rounded-full border border-line-strong px-5 py-2 font-semibold hover:bg-surface-2">
              Back
            </button>
          </div>
          {reason.trim() === '' && <p className="text-sm text-fg-muted">Please give the guest a reason.</p>}
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <p className="text-sm">
        <Link to={`/properties/${r.property_id}`} className="text-fg-muted hover:text-fg">
          View listing →
        </Link>
      </p>
    </li>
  )
}

export default HostReservationsPage
