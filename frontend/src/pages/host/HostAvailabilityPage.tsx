// Host: manage one listing's availability (U5a). Pick a first and last night and
// block them; see every upcoming block, and unblock your own ones.
// Rules are enforced by the server (contract §4 availability rules): no overlapping
// blocks (409), only host blocks can be unblocked, only the owner may change it (403).
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { errorMessage } from '../../api/client'
import { blockDates, getAvailability, getProperty, unblockDates } from '../../api/properties'
import { stayHasUnavailableNight } from '../../availability'
import AvailabilityCalendar from '../../components/AvailabilityCalendar'
import ErrorBanner from '../../components/ErrorBanner'
import { useCurrentUser } from '../../context/useCurrentUser'
import { dateString, formatDate, localDate, nightsBetween } from '../../dates'
import { plural } from '../../labels'
import type { AvailabilityBlock } from '../../types/availability'
import type { Property } from '../../types/property'

function HostAvailabilityPage() {
  const { propertyId = '' } = useParams()
  const { hostId } = useCurrentUser()
  return <HostAvailability key={`${propertyId}|${hostId}`} propertyId={propertyId} hostId={hostId} />
}

// Blocks we load: from the 1st of this month to one year ahead.
function loadRange() {
  const now = new Date()
  return {
    start: dateString(now.getFullYear(), now.getMonth() + 1, 1),
    end: dateString(now.getFullYear() + 1, now.getMonth() + 1, 1),
  }
}

type Props = { propertyId: string; hostId: string }

const inputClass =
  'w-full rounded-full border border-line bg-surface-2 px-4 py-2 text-fg focus:border-gold focus:outline-none [color-scheme:dark]'
const labelClass = 'font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase'

function HostAvailability({ propertyId, hostId }: Props) {
  const [property, setProperty] = useState<Property | null>(null)
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // The form uses first night + last night (both included), which is how hosts think.
  // The API wants end_date = the day AFTER the last night, so we add one day when sending.
  const [firstNight, setFirstNight] = useState('')
  const [lastNight, setLastNight] = useState('')
  const [blocking, setBlocking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [unblockingId, setUnblockingId] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const range = loadRange()
        const [loadedProperty, availability] = await Promise.all([
          getProperty({ property_id: propertyId }),
          getAvailability({ property_id: propertyId, start_date: range.start, end_date: range.end }),
        ])
        if (ignore) return
        setProperty(loadedProperty)
        setBlocks(availability.items)
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
  }, [propertyId, attempt])

  const endDate = lastNight ? localDate(1, lastNight) : '' // exclusive end for the API
  const rangePicked = firstNight !== '' && lastNight !== '' && lastNight >= firstNight
  const looksTaken = rangePicked && stayHasUnavailableNight(blocks, firstNight, endDate)

  function changeFirstNight(value: string) {
    setFirstNight(value)
    if (lastNight && value && lastNight < value) setLastNight('')
  }

  async function block(event: FormEvent) {
    event.preventDefault()
    setBlocking(true)
    setActionError(null)
    setNotice(null)
    try {
      const created = await blockDates({ property_id: propertyId, host_id: hostId, start_date: firstNight, end_date: endDate })
      setBlocks((previous) => [...previous, created])
      setNotice(`Blocked ${formatDate(firstNight)} – ${formatDate(lastNight)}.`)
      setFirstNight('')
      setLastNight('')
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBlocking(false)
    }
  }

  async function unblock(target: AvailabilityBlock) {
    setUnblockingId(target.availability_id)
    setActionError(null)
    setNotice(null)
    try {
      await unblockDates({ availability_id: target.availability_id, host_id: hostId })
      setBlocks((previous) => previous.filter((b) => b.availability_id !== target.availability_id))
      setNotice(`Reopened ${formatDate(target.start_date)} – ${formatDate(localDate(-1, target.end_date))}.`)
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setUnblockingId(null)
    }
  }

  const backLink = (
    <Link to="/host/listings" className="text-sm font-semibold text-fg-muted hover:text-fg">
      ← My listings
    </Link>
  )

  if (loading) return <section className="space-y-4">{backLink}<p className="text-fg-muted">Loading calendar…</p></section>

  if (error || !property) {
    return (
      <section className="space-y-4">
        {backLink}
        <ErrorBanner
          message={error ?? 'Something went wrong. Please try again.'}
          onRetry={() => {
            setError(null)
            setLoading(true)
            setAttempt((n) => n + 1)
          }}
        />
      </section>
    )
  }

  if (property.host_id !== hostId) {
    return (
      <section className="space-y-4">
        {backLink}
        <div className="rounded-2xl border border-line bg-surface p-6">
          <p className="text-fg-soft">This listing belongs to another host.</p>
          <p className="mt-1 text-sm text-fg-muted">Log in as its host to manage its calendar.</p>
        </div>
      </section>
    )
  }

  // Upcoming blocks (ending after today), soonest first.
  const upcoming = blocks
    .filter((b) => b.status !== 'available' && b.end_date > localDate())
    .sort((a, b) => a.start_date.localeCompare(b.start_date))

  return (
    <section className="space-y-6">
      {backLink}
      <div>
        <h1 className="cornice font-display text-3xl font-bold">Availability</h1>
        <p className="text-fg-soft">
          {property.title} · <span className="font-mono text-sm">{property.property_id}</span>
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <AvailabilityCalendar blocks={blocks} checkIn={rangePicked ? firstNight : ''} checkOut={rangePicked ? endDate : ''} hostView />

        <div className="space-y-6">
          <form onSubmit={block} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">Block dates</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={labelClass}>First night</span>
                <input type="date" required value={firstNight} min={localDate()} onChange={(e) => changeFirstNight(e.target.value)} className={inputClass} />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Last night</span>
                <input type="date" required value={lastNight} min={firstNight || localDate()} onChange={(e) => setLastNight(e.target.value)} className={inputClass} />
              </label>
            </div>
            {rangePicked && <p className="text-sm text-fg-soft">{plural(nightsBetween(firstNight, endDate), 'night')} selected.</p>}
            {looksTaken && (
              <p className="rounded-xl border border-status-pending p-3 text-sm text-status-pending" role="status">
                Some of these nights are already blocked or booked. The server will refuse overlapping blocks.
              </p>
            )}
            <button
              type="submit"
              disabled={!rangePicked || blocking}
              className="w-full rounded-full bg-primary py-2.5 font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {blocking ? 'Blocking…' : 'Block these dates'}
            </button>
          </form>

          {notice && (
            <div className="rounded-2xl border border-status-ok bg-surface px-4 py-3 text-status-ok" role="status">
              {notice}
            </div>
          )}
          {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

          <div className="space-y-2">
            <h2 className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">Upcoming blocks</h2>
            {upcoming.length === 0 && <p className="text-fg-muted">Nothing blocked or booked in the next year.</p>}
            <ul className="space-y-2">
              {upcoming.map((b) => (
                <li key={b.availability_id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-2">
                  <div>
                    <p>
                      {formatDate(b.start_date)} – {formatDate(localDate(-1, b.end_date))}{' '}
                      <span className="text-fg-muted">({plural(nightsBetween(b.start_date, b.end_date), 'night')})</span>
                    </p>
                    <p className="text-sm text-fg-muted">
                      {b.source === 'host' ? 'Blocked by you' : 'Held by a reservation'} ·{' '}
                      <span className="font-mono">{b.availability_id}</span>
                    </p>
                  </div>
                  {b.source === 'host' ? (
                    <button
                      type="button"
                      onClick={() => unblock(b)}
                      disabled={unblockingId === b.availability_id}
                      className="rounded-full border border-line-strong px-3 py-1 text-sm font-semibold hover:bg-surface-2 disabled:opacity-60"
                    >
                      {unblockingId === b.availability_id ? 'Unblocking…' : 'Unblock'}
                    </button>
                  ) : (
                    <Link to="/host/reservations" className="text-sm font-semibold whitespace-nowrap text-fg-muted hover:text-fg">
                      Reservations →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

export default HostAvailabilityPage
