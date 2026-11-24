// Guest search results. The filters come from the URL (set by the header search bar
// and the cream filter strip); this page asks the Property Service and shows the cards.
import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { trackEvent } from '../../api/analytics'
import { errorMessage } from '../../api/client'
import { saveProperty, searchProperties } from '../../api/properties'
import ErrorBanner from '../../components/ErrorBanner'
import ListingCard from '../../components/ListingCard'
import { useCurrentUser } from '../../context/useCurrentUser'
import { readFilters, toSearchRequest } from '../../searchFilters'
import type { PropertySearchResult } from '../../types/property'

const PAGE_SIZE = 12 // results per "page"; "Show more" loads the next 12

function SearchPage() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const { guestId } = useCurrentUser()
  const paramsString = searchParams.toString()
  // A note passed by another page, e.g. after deleting a profile.
  const notice = (location.state as { notice?: string } | null)?.notice

  // New filters or a different guest = a brand-new result list. Changing the key makes
  // React throw away the old <SearchResults> (and its state) and start a fresh one.
  return (
    <>
      {notice && (
        <div role="status" className="mb-6 rounded-2xl border border-status-ok bg-surface px-4 py-3 text-status-ok">
          {notice}
        </div>
      )}
      <SearchResults key={`${paramsString}|${guestId}`} paramsString={paramsString} guestId={guestId} />
    </>
  )
}

type ResultsProps = { paramsString: string; guestId: string }

function SearchResults({ paramsString, guestId }: ResultsProps) {
  const filters = readFilters(new URLSearchParams(paramsString))

  const [items, setItems] = useState<PropertySearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true) // first page
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0) // bumped by Retry
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [savingIds, setSavingIds] = useState<string[]>([]) // hearts waiting for the server
  const [saveError, setSaveError] = useState<string | null>(null)

  // Load the first page when this component starts (and again on Retry).
  useEffect(() => {
    let ignore = false // set on cleanup, so a late answer from an old search is ignored
    const request = toSearchRequest(readFilters(new URLSearchParams(paramsString)), guestId, 1, PAGE_SIZE)
    searchProperties(request)
      .then((result) => {
        if (ignore) return
        setItems(result.items)
        setTotal(result.total)
        setLoading(false)
        // Analytics (C4a): one search.performed event per search. Fire-and-forget.
        trackEvent('search.performed', guestId, { entity_type: 'search', entity_id: paramsString || 'all' }, { results: result.total })
      })
      .catch((err: unknown) => {
        if (ignore) return
        setError(errorMessage(err))
        setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [paramsString, guestId, attempt])

  function retry() {
    setError(null)
    setLoading(true)
    setAttempt((n) => n + 1)
  }

  async function showMore() {
    setLoadingMore(true)
    setMoreError(null)
    try {
      const nextPage = Math.floor(items.length / PAGE_SIZE) + 1
      const result = await searchProperties(toSearchRequest(filters, guestId, nextPage, PAGE_SIZE))
      setItems((previous) => [...previous, ...result.items])
      setTotal(result.total)
    } catch (err) {
      setMoreError(errorMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }

  // Heart click: wait for the server, then show what it says (team decision: no optimistic update).
  async function toggleSave(property: PropertySearchResult) {
    setSaveError(null)
    setSavingIds((ids) => [...ids, property.property_id])
    try {
      const result = await saveProperty({ guest_id: guestId, property_id: property.property_id, saved: !property.is_saved })
      setItems((previous) =>
        previous.map((p) => (p.property_id === result.property_id ? { ...p, is_saved: result.saved } : p)),
      )
    } catch (err) {
      const action = property.is_saved ? 'remove' : 'save'
      setSaveError(`Couldn’t ${action} ${property.title}: ${errorMessage(err)}`)
    } finally {
      setSavingIds((ids) => ids.filter((id) => id !== property.property_id))
    }
  }

  // The dates and guests go along to the property page, so its booking panel starts filled in.
  const linkParams = new URLSearchParams()
  if (filters.check_in) linkParams.set('check_in', filters.check_in)
  if (filters.check_out) linkParams.set('check_out', filters.check_out)
  if (filters.guests !== null) linkParams.set('guests', String(filters.guests))
  const linkQuery = linkParams.toString()

  // "6 STAYS NEAR SAN JOSE" / "29 STAYS"
  const heading = `${total} ${total === 1 ? 'stay' : 'stays'}${filters.location ? ` near ${filters.location}` : ''}`
  const headingClass = 'font-condensed text-2xl font-bold tracking-[0.06em] uppercase'

  return (
    <section className="space-y-6">
      {loading && <h1 className={`${headingClass} text-fg-muted`}>Finding stays…</h1>}
      {!loading && !error && <h1 className={headingClass}>{heading}</h1>}

      {saveError && <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />}

      {error && <ErrorBanner message={error} onRetry={retry} />}

      {loading && (
        // 6 grey placeholder cards with the same shape as real cards
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="animate-pulse overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="h-[190px] bg-surface-2" />
              <div className="space-y-3 p-4">
                <div className="h-5 w-3/4 rounded bg-surface-2" />
                <div className="h-4 w-1/2 rounded bg-surface-2" />
                <div className="h-6 w-24 rounded-full bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="text-fg-soft">No stays match these filters.</p>
          <Link to="/" className="mt-2 inline-block font-semibold text-primary hover:underline">
            Clear all filters
          </Link>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((property) => (
            <ListingCard
              key={property.property_id}
              property={property}
              saving={savingIds.includes(property.property_id)}
              onToggleSave={() => toggleSave(property)}
              linkQuery={linkQuery}
            />
          ))}
        </div>
      )}

      {moreError && <ErrorBanner message={moreError} onRetry={showMore} />}

      {!loading && !error && items.length < total && (
        <div className="text-center">
          <button
            type="button"
            onClick={showMore}
            disabled={loadingMore}
            className="rounded-full border border-line-strong px-6 py-2 font-semibold text-fg hover:bg-surface disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : `Show more (${total - items.length} left)`}
          </button>
        </div>
      )}
    </section>
  )
}

export default SearchPage
