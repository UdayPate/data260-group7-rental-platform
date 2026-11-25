// The home page for logged-out visitors: a full-width hero photo (it already shows a
// stone arch, so no frame around it) whose bottom fades into the dark background, with
// XENIA, the tagline and the search bar on that dark part; then 3 featured stays and
// how the AI concierge works.
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { errorMessage } from '../api/client'
import { searchProperties } from '../api/properties'
import { BRAND } from '../brand'
import BrandLogo from '../components/BrandLogo'
import ErrorBanner from '../components/ErrorBanner'
import ListingCard from '../components/ListingCard'
import SearchBar from '../components/SearchBar'
import type { PropertySearchResult } from '../types/property'

// The 3 steps of the AI concierge (Roman numerals, to match the villa theme).
const STEPS = [
  { numeral: 'I', title: 'Describe your trip', text: 'Write it the way you would say it: “2 nights in San Jose for 2, under $250, parking, kitchen”.' },
  { numeral: 'II', title: 'The agents debate in the Forum', text: 'A Matcher, a Risk agent and a Fairness Auditor argue for their picks while a Chair challenges them, live.' },
  { numeral: 'III', title: 'You approve', text: 'Nothing is booked for you: approve the verdict, edit the request, or reject it.' },
]

function HomePage() {
  const location = useLocation()
  // A note passed by another page, e.g. "You’ve been logged out" after deleting a profile.
  const notice = (location.state as { notice?: string } | null)?.notice

  return (
    <>
      {/* ---------- Hero ---------- */}
      <section data-hero className="relative h-[min(80vh,720px)] min-h-[560px] overflow-hidden">
        <img src="/photos/hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[center_35%]" />
        {/* Fade the bottom of the photo into the page background, so the text below sits on dark. */}
        <div className="absolute inset-0 bg-linear-to-b from-transparent from-40% via-bg/85 via-70% to-bg" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 space-y-4 px-6 pb-10 text-center">
          <h1 className="text-5xl text-fg md:text-6xl">
            <BrandLogo />
          </h1>
          <p data-tagline className="text-lg text-fg-soft">{BRAND.tagline}</p>
          <SearchBar />
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-14 px-6 py-10">
        {notice && (
          <div role="status" className="rounded-2xl border border-status-ok bg-surface px-4 py-3 text-status-ok">
            {notice}
          </div>
        )}
        <FeaturedStays />

        {/* ---------- How the AI concierge works ---------- */}
        <section data-concierge className="space-y-6">
          <h2 className="cornice font-display text-3xl font-bold">How the AI concierge works</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.numeral} className="rounded-2xl border border-line bg-surface p-5">
                <span className="font-display text-3xl font-bold text-gold">{step.numeral}</span>
                <h3 className="mt-2 font-condensed text-xl font-bold tracking-[0.06em] uppercase">{step.title}</h3>
                <p className="mt-1 text-fg-soft">{step.text}</p>
              </li>
            ))}
          </ol>
          {/* The concierge needs a guest account: log in, then land on the request box. */}
          <Link
            to={`/login?next=${encodeURIComponent('/ai')}`}
            className="inline-block rounded-full bg-primary px-6 py-2.5 font-semibold text-on-primary hover:brightness-110"
          >
            Try the AI concierge
          </Link>
        </section>
      </div>
    </>
  )
}

// The 3 highest-rated active listings (team decision H2a): one normal search call, then
// sort by rating (more reviews first on a tie) and keep the top 3.
function FeaturedStays() {
  const [stays, setStays] = useState<PropertySearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0) // bumped by Retry

  useEffect(() => {
    let ignore = false // a late answer after leaving the page is ignored
    searchProperties({ page: 1, page_size: 100 })
      .then((result) => {
        if (ignore) return
        const best = [...result.items].sort((a, b) => b.rating - a.rating || b.review_count - a.review_count).slice(0, 3)
        setStays(best)
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
  }, [attempt])

  function retry() {
    setError(null)
    setLoading(true)
    setAttempt((n) => n + 1)
  }

  return (
    <section data-featured className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="cornice font-display text-3xl font-bold">Featured stays</h2>
        <Link to="/search" className="font-semibold text-primary hover:underline">
          See all stays →
        </Link>
      </div>
      {loading && <p className="text-fg-muted">Loading stays…</p>}
      {error && <ErrorBanner message={`Couldn’t load the featured stays: ${error}`} onRetry={retry} />}
      {!loading && !error && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {stays.map((property) => (
            // No save heart here: saving needs an account (the search page offers it).
            <ListingCard key={property.property_id} property={property} saving={false} linkQuery="" />
          ))}
        </div>
      )}
    </section>
  )
}

export default HomePage
