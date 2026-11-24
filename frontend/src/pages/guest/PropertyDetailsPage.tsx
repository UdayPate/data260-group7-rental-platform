// Property details (guest): photo, title, rating, save heart, host, description,
// amenities, availability calendar, and the booking panel on the right.
// Dates and guests can arrive in the URL from the search page (team decision D5a).
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { trackEvent } from '../../api/analytics'
import { errorMessage } from '../../api/client'
import { getAvailability, getProperty, saveProperty } from '../../api/properties'
import { getHost } from '../../api/users'
import AvailabilityCalendar from '../../components/AvailabilityCalendar'
import MessageButton from '../../components/MessageButton'
import PropertyReviews from '../../components/PropertyReviews'
import BookingPanel from '../../components/BookingPanel'
import ErrorBanner from '../../components/ErrorBanner'
import { HeartIcon, HouseIcon, StarIcon } from '../../components/icons'
import { useCurrentUser } from '../../context/useCurrentUser'
import { dateString, localDate } from '../../dates'
import { AMENITY_LABELS, PROPERTY_TYPE_LABELS, plural } from '../../labels'
import type { AvailabilityBlock } from '../../types/availability'
import type { Host } from '../../types/host'
import type { PropertyWithSaved } from '../../types/property'

function PropertyDetailsPage() {
  const { propertyId = '' } = useParams()
  const { guestId } = useCurrentUser()
  // A different property or guest = start fresh (the key resets all state below).
  return <PropertyDetails key={`${propertyId}|${guestId}`} propertyId={propertyId} guestId={guestId} />
}

// The dates the calendar covers: the 1st of this month up to the 1st of the month after next.
function calendarRange() {
  const now = new Date()
  const start = dateString(now.getFullYear(), now.getMonth() + 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 1) // JS months start at 0, so +2 = month after next
  return { start, end: dateString(end.getFullYear(), end.getMonth() + 1, 1) }
}

// "about 22 minutes" / "about 9 hours"
function formatResponseTime(minutes: number): string {
  return minutes < 60 ? `about ${plural(minutes, 'minute')}` : `about ${plural(Math.round(minutes / 60), 'hour')}`
}

const VERIFICATION_TEXT: Record<Host['verification_status'], string> = {
  verified: 'Verified host',
  pending: 'Verification pending',
  unverified: 'Not verified',
}

type DetailsProps = { propertyId: string; guestId: string }

function PropertyDetails({ propertyId, guestId }: DetailsProps) {
  const [searchParams] = useSearchParams()

  const [property, setProperty] = useState<PropertyWithSaved | null>(null)
  const [host, setHost] = useState<Host | null>(null)
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0) // bumped by Retry

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Booking form values, shared by the booking panel and the calendar.
  // They start from the URL when we came from a search with dates/guests.
  const [checkIn, setCheckIn] = useState(searchParams.get('check_in') ?? '')
  const [checkOut, setCheckOut] = useState(searchParams.get('check_out') ?? '')
  const [guests, setGuests] = useState(Number(searchParams.get('guests')) || 1)

  // Load the property first (we need its host_id), then its host and availability together.
  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const loadedProperty = await getProperty({ property_id: propertyId, guest_id: guestId })
        const range = calendarRange()
        const [loadedHost, availability] = await Promise.all([
          getHost({ host_id: loadedProperty.host_id }),
          getAvailability({ property_id: propertyId, start_date: range.start, end_date: range.end }),
        ])
        if (ignore) return
        setProperty(loadedProperty)
        setHost(loadedHost)
        setBlocks(availability.items)
        setLoading(false)
        // Analytics (C4a): feeds the host's views -> bookings funnel. Fire-and-forget.
        trackEvent('property.viewed', guestId, { entity_type: 'property', entity_id: propertyId })
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
  }, [propertyId, guestId, attempt])

  function retry() {
    setError(null)
    setLoading(true)
    setAttempt((n) => n + 1)
  }

  // Heart: wait for the server, then show what it says (same as the search page).
  async function toggleSave() {
    if (!property) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await saveProperty({ guest_id: guestId, property_id: property.property_id, saved: !property.is_saved })
      setProperty({ ...property, is_saved: result.saved })
    } catch (err) {
      setSaveError(`Couldn’t ${property.is_saved ? 'remove' : 'save'} this stay: ${errorMessage(err)}`)
    } finally {
      setSaving(false)
    }
  }

  // Back to search, keeping the dates and guests we came with.
  const backParams = new URLSearchParams()
  for (const key of ['check_in', 'check_out', 'guests']) {
    const value = searchParams.get(key)
    if (value) backParams.set(key, value)
  }
  const backLink = (
    <Link to={`/?${backParams.toString()}`} className="text-sm font-semibold text-fg-muted hover:text-fg">
      ← Back to search
    </Link>
  )

  if (loading) {
    return (
      <section className="space-y-4">
        {backLink}
        <h1 className="font-condensed text-3xl font-bold tracking-[0.06em] text-fg-muted uppercase">Loading stay…</h1>
        <div className="h-[340px] animate-pulse rounded-2xl bg-surface-2" />
      </section>
    )
  }

  if (error || !property || !host) {
    return (
      <section className="space-y-4">
        {backLink}
        <ErrorBanner message={error ?? 'Something went wrong. Please try again.'} onRetry={retry} />
      </section>
    )
  }

  const typeLabel = PROPERTY_TYPE_LABELS[property.property_type]

  return (
    <section className="space-y-6">
      {backLink}

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        {/* ---------- Left column ---------- */}
        <div className="space-y-8">
          {property.photo_url ? (
            <img src={property.photo_url} alt="" className="h-[340px] w-full rounded-2xl object-cover" />
          ) : (
            <div className="flex h-[340px] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface-2 text-fg-muted">
              <HouseIcon className="h-20 w-20" />
              <span className="font-condensed font-bold tracking-[0.08em] uppercase">{typeLabel}</span>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h1 className="font-display text-4xl font-bold">{property.title}</h1>
              <button
                type="button"
                onClick={toggleSave}
                disabled={saving}
                aria-pressed={property.is_saved}
                className="flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 font-semibold hover:bg-surface disabled:cursor-wait disabled:opacity-60"
              >
                <HeartIcon filled={property.is_saved} className={`h-5 w-5 ${property.is_saved ? 'text-primary' : ''}`} />
                {property.is_saved ? 'Saved' : 'Save'}
              </button>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 text-fg-soft">
              <StarIcon className="h-4 w-4 text-mustard" />
              {property.review_count > 0 ? (
                <span>
                  {property.rating.toFixed(2)} · {plural(property.review_count, 'review')}
                </span>
              ) : (
                <span>New listing</span>
              )}
              <span>·</span>
              <span>
                {property.address}, {property.city}, {property.state} {property.zip_code}
              </span>
            </p>
            <p className="text-fg-muted">
              {typeLabel} · {plural(property.capacity, 'guest')} · {plural(property.bedrooms, 'bedroom')} ·{' '}
              {plural(property.bathrooms, 'bath')}
            </p>
            {saveError && <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />}
          </div>

          {/* Host card: the Risk agent later looks at these same numbers. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-surface p-4">
            <div>
              <p className="font-condensed text-xl font-bold">Hosted by {host.name}</p>
              <p className="text-sm text-fg-muted">
                {VERIFICATION_TEXT[host.verification_status]} · Host since {host.host_since.slice(0, 4)}
              </p>
            </div>
            {host.access_level === 'superhost' && (
              <span className="rounded-full bg-mustard px-3 py-1 text-xs font-bold text-bg">Superhost</span>
            )}
            <p className="text-sm text-fg-soft sm:ml-auto">
              Replies to {host.response_rate}% of messages, in {formatResponseTime(host.response_time)}
            </p>
            <MessageButton
              label="Message host"
              inbox="/guest/messages"
              request={{ guest_id: guestId, host_id: host.host_id, property_id: property.property_id, actor_id: guestId }}
            />
          </div>

          <div className="space-y-2">
            <h2 className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">About this place</h2>
            <p className="text-fg-soft">{property.description}</p>
          </div>

          <div className="space-y-3">
            <h2 className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">Amenities</h2>
            <ul className="grid grid-cols-2 gap-2 text-fg-soft sm:grid-cols-3">
              {property.amenities.map((amenity) => (
                <li key={amenity} className="rounded-full border border-line px-3 py-1.5 text-sm">
                  {AMENITY_LABELS[amenity]}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <h2 className="font-condensed text-xl font-bold tracking-[0.06em] uppercase">Availability</h2>
            <AvailabilityCalendar blocks={blocks} checkIn={checkIn} checkOut={checkOut} />
            <p className="text-xs text-fg-muted">Calendar as of when this page loaded (today is {localDate()}).</p>
          </div>

          <PropertyReviews propertyId={property.property_id} rating={property.rating} reviewCount={property.review_count} />
        </div>

        {/* ---------- Right column: booking panel, stays in view while scrolling ---------- */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <BookingPanel
            property={property}
            blocks={blocks}
            guestId={guestId}
            checkIn={checkIn}
            checkOut={checkOut}
            guests={Math.min(guests, property.capacity)}
            onCheckInChange={setCheckIn}
            onCheckOutChange={setCheckOut}
            onGuestsChange={setGuests}
          />
        </div>
      </div>
    </section>
  )
}

export default PropertyDetailsPage
