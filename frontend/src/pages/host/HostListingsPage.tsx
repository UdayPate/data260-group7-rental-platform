// Host "My listings": the current host's listings as rows (U1a), filtered by the cream
// strip (URL), with View / Edit / Availability / Delete actions and a "New listing" button.
import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { ApiError, errorMessage } from '../../api/client'
import { deleteProperty, searchProperties } from '../../api/properties'
import ErrorBanner from '../../components/ErrorBanner'
import { StarIcon } from '../../components/icons'
import { useCurrentUser } from '../../context/useCurrentUser'
import { PROPERTY_TYPE_LABELS, formatPrice } from '../../labels'
import { readHostFilters } from '../../searchFilters'
import type { Property } from '../../types/property'

function HostListingsPage() {
  const [searchParams] = useSearchParams()
  const { hostId } = useCurrentUser()
  const paramsString = searchParams.toString()
  // New filters or a different host = a fresh list (the key resets the state).
  return <HostListings key={`${paramsString}|${hostId}`} paramsString={paramsString} hostId={hostId} />
}

type Props = { paramsString: string; hostId: string }

function HostListings({ paramsString, hostId }: Props) {
  const location = useLocation()
  // A note passed by the listing form after saving, e.g. 'Saved "Rose Garden Bungalow".'
  const formNotice = (location.state as { notice?: string } | null)?.notice

  const [listings, setListings] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const [notice, setNotice] = useState<string | null>(formNotice ?? null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    const filters = readHostFilters(new URLSearchParams(paramsString))
    searchProperties({
      host_id: hostId, // only this host's listings, active and inactive
      location: filters.location || undefined,
      property_types: filters.types.length > 0 ? filters.types : undefined,
      status: filters.status ?? undefined,
      page: 1,
      page_size: 100, // a host has a handful of listings; no paging needed here
    })
      .then((result) => {
        if (ignore) return
        setListings(result.items)
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
  }, [paramsString, hostId, attempt])

  function retry() {
    setError(null)
    setLoading(true)
    setAttempt((n) => n + 1)
  }

  function askDelete(propertyId: string) {
    setConfirmDeleteId(propertyId)
    setDeleteError(null)
  }

  async function confirmDelete(listing: Property) {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProperty({ property_id: listing.property_id, host_id: hostId })
      setListings((previous) => previous.filter((p) => p.property_id !== listing.property_id))
      setConfirmDeleteId(null)
      setNotice(`Deleted “${listing.title}”.`)
    } catch (err) {
      // For "has upcoming reservations" the server also lists which ones.
      const ids = err instanceof ApiError ? err.details?.reservation_ids : undefined
      const extra = Array.isArray(ids) && ids.length > 0 ? ` (${ids.join(', ')})` : ''
      setDeleteError(errorMessage(err) + extra)
    } finally {
      setDeleting(false)
    }
  }

  const hasFilters = paramsString !== ''

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-condensed text-3xl font-bold tracking-[0.06em] uppercase">
          My listings {!loading && !error && <span className="text-fg-muted">({listings.length})</span>}
        </h1>
        <Link to="/host/listings/new" className="rounded-full bg-primary px-5 py-2 font-semibold text-on-primary hover:brightness-110">
          + New listing
        </Link>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-2xl border border-status-ok bg-surface px-4 py-3 text-status-ok" role="status">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="text-sm font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={retry} />}
      {loading && <p className="text-fg-muted">Loading your listings…</p>}

      {!loading && !error && listings.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-fg-soft">
          {hasFilters ? 'No listings match these filters.' : 'You don’t have any listings yet.'}
        </div>
      )}

      {!loading && !error && listings.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-line">
          <table className="w-full text-left">
            <thead className="bg-surface-2 font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">
              <tr>
                <th className="px-4 py-3">Listing</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <ListingRow
                  key={listing.property_id}
                  listing={listing}
                  confirming={confirmDeleteId === listing.property_id}
                  deleting={deleting}
                  deleteError={confirmDeleteId === listing.property_id ? deleteError : null}
                  onAskDelete={() => askDelete(listing.property_id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                  onConfirmDelete={() => confirmDelete(listing)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type RowProps = {
  listing: Property
  confirming: boolean
  deleting: boolean
  deleteError: string | null
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}

const actionClass = 'rounded-full border border-line-strong px-3 py-1 text-sm font-semibold hover:bg-surface-2'

function ListingRow({ listing, confirming, deleting, deleteError, onAskDelete, onCancelDelete, onConfirmDelete }: RowProps) {
  return (
    <>
      <tr className="border-t border-line bg-surface align-middle">
        <td className="px-4 py-3">
          <p className="font-condensed text-lg font-bold">{listing.title}</p>
          <p className="text-sm text-fg-muted">
            {listing.city} · <span className="font-mono">{listing.property_id}</span>
          </p>
        </td>
        <td className="px-4 py-3 text-fg-soft">{PROPERTY_TYPE_LABELS[listing.property_type]}</td>
        <td className="px-4 py-3 font-mono">{formatPrice(listing.nightly_price)}</td>
        <td className="px-4 py-3">
          <span
            className={`rounded-full border px-2.5 py-0.5 font-condensed text-xs font-bold tracking-[0.08em] uppercase ${
              listing.status === 'active' ? 'border-status-ok text-status-ok' : 'border-line-strong text-fg-muted'
            }`}
          >
            {listing.status}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="flex items-center gap-1 text-sm">
            <StarIcon className="h-4 w-4 text-mustard" />
            {listing.review_count > 0 ? `${listing.rating.toFixed(2)} (${listing.review_count})` : 'New'}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap justify-end gap-2">
            <Link to={`/properties/${listing.property_id}`} className={actionClass}>
              View
            </Link>
            <Link to={`/host/listings/${listing.property_id}/edit`} className={actionClass}>
              Edit
            </Link>
            <Link to={`/host/listings/${listing.property_id}/availability`} className={actionClass}>
              Availability
            </Link>
            <button
              type="button"
              onClick={onAskDelete}
              className="rounded-full border border-status-error-border px-3 py-1 text-sm font-semibold text-status-error hover:bg-surface-2"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {confirming && (
        <tr className="bg-surface">
          <td colSpan={6} className="px-4 pb-4">
            <div className="space-y-3 rounded-2xl border border-status-error-border p-4">
              <p>
                Delete <strong>{listing.title}</strong>? Guests won’t be able to find or book it. This can’t be undone.
              </p>
              {deleteError && <ErrorBanner message={deleteError} />}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onConfirmDelete}
                  disabled={deleting}
                  className="rounded-full bg-status-error px-5 py-2 font-semibold text-bg disabled:opacity-60"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button type="button" onClick={onCancelDelete} className="rounded-full border border-line-strong px-5 py-2 font-semibold hover:bg-surface-2">
                  Keep it
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default HostListingsPage
