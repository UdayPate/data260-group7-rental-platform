// Guest profile (P1a): a view card -> Edit turns it into the form -> Save / Cancel.
// Delete has a confirm step; the server refuses while the guest has upcoming trips (C5a).
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { ApiError, errorMessage } from '../../api/client'
import { deleteGuest, getGuest, updateGuest } from '../../api/users'
import ErrorBanner from '../../components/ErrorBanner'
import GuestProfileForm from '../../components/GuestProfileForm'
import { useAuth } from '../../auth/useAuth'
import { useCurrentUser } from '../../context/useCurrentUser'
import { formatDate } from '../../dates'
import { AMENITY_LABELS, PROPERTY_TYPE_LABELS, formatPrice, plural } from '../../labels'
import type { Guest } from '../../types/guest'

function GuestProfilePage() {
  const { guestId } = useCurrentUser()
  return <GuestProfile key={guestId} guestId={guestId} />
}

function GuestProfile({ guestId }: { guestId: string }) {
  const location = useLocation()
  const { logOut } = useAuth()
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null)

  const [guest, setGuest] = useState<Guest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(false)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    getGuest({ guest_id: guestId })
      .then((g) => {
        if (ignore) return
        setGuest(g)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (ignore) return
        setError(errorMessage(err))
        setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [guestId, attempt])

  async function confirmDelete() {
    if (!guest) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteGuest({ guest_id: guest.guest_id })
      // The login was deleted with the profile, so log out of this tab.
      logOut(`Deleted the profile of ${guest.first_name} ${guest.last_name}. You’ve been logged out.`)
    } catch (err) {
      // "Upcoming trips" error: the server also lists which reservations.
      const ids = err instanceof ApiError ? err.details?.reservation_ids : undefined
      setDeleteError(errorMessage(err) + (Array.isArray(ids) && ids.length > 0 ? ` (${ids.join(', ')})` : ''))
      setDeleting(false)
    }
  }

  if (loading) return <p className="text-fg-muted">Loading your profile…</p>
  if (error || !guest) {
    return (
      <section className="space-y-4">
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

  const prefs = guest.preferences
  const label = 'font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase'

  return (
    <section className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl font-bold">{editing ? 'Edit profile' : 'My profile'}</h1>
      </div>

      {notice && (
        <div role="status" className="flex items-center justify-between rounded-2xl border border-status-ok bg-surface px-4 py-3 text-status-ok">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="text-sm font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {editing ? (
        <GuestProfileForm
          guest={guest}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (fields) => {
            const updated = await updateGuest({ guest_id: guest.guest_id, ...fields })
            setGuest(updated)
            setEditing(false)
            setNotice('Profile saved.')
          }}
        />
      ) : (
        <>
          <div data-profile className="grid gap-5 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2">
            <div className="flex items-center gap-4 sm:col-span-2">
              {guest.profile_photo_url ? (
                <img src={guest.profile_photo_url} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 font-condensed text-2xl font-bold text-fg-soft">
                  {guest.first_name[0]}
                  {guest.last_name[0]}
                </span>
              )}
              <div>
                <p className="font-condensed text-2xl font-bold">
                  {guest.first_name} {guest.last_name}
                </p>
                <p className="font-mono text-sm text-fg-muted">
                  {guest.guest_id} · member since {formatDate(guest.profile_created_datetime.slice(0, 10))}
                </p>
              </div>
            </div>
            <div>
              <p className={label}>Email</p>
              <p>{guest.email}</p>
            </div>
            <div>
              <p className={label}>Phone</p>
              <p>{guest.phone || '—'}</p>
            </div>
            <div>
              <p className={label}>Home city</p>
              <p>{guest.location || '—'}</p>
            </div>
            <div>
              <p className={label}>Activity</p>
              <p>
                {plural(guest.booking_count, 'booking')} · {plural(guest.saved_properties_count, 'saved stay')}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className={label}>Preferences</p>
              <ul className="space-y-0.5 text-fg-soft">
                <li>Cities: {prefs.preferred_locations.length > 0 ? prefs.preferred_locations.join(', ') : 'any'}</li>
                <li>Budget: {prefs.max_nightly_price === null ? 'no limit' : `up to ${formatPrice(prefs.max_nightly_price)} / night`}</li>
                <li>Types: {prefs.property_types.length > 0 ? prefs.property_types.map((t) => PROPERTY_TYPE_LABELS[t]).join(', ') : 'any'}</li>
                <li>Must have: {prefs.amenities.length > 0 ? prefs.amenities.map((a) => AMENITY_LABELS[a]).join(', ') : '—'}</li>
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setEditing(true)} className="rounded-full bg-primary px-6 py-2.5 font-semibold text-on-primary hover:brightness-110">
              Edit profile
            </button>
            {!confirmingDelete && (
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(true)
                  setDeleteError(null)
                }}
                className="rounded-full border border-status-error-border px-6 py-2.5 font-semibold text-status-error hover:bg-surface"
              >
                Delete profile
              </button>
            )}
          </div>

          {confirmingDelete && (
            <div className="space-y-3 rounded-2xl border border-status-error-border bg-surface p-5">
              <p>
                Delete the profile of <strong>{guest.first_name} {guest.last_name}</strong>? Your saved stays are removed too. This can’t be undone.
              </p>
              {deleteError && <ErrorBanner message={deleteError} />}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="rounded-full bg-status-error px-5 py-2 font-semibold text-bg disabled:opacity-60"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete my profile'}
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-full border border-line-strong px-5 py-2 font-semibold hover:bg-surface-2">
                  Keep it
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default GuestProfilePage
