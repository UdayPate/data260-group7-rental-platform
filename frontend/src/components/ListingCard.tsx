// One property in the search results: photo (or plain tile), badge, save heart,
// title, rating, meta line and price. Clicking the card opens the property page.
import { Link } from 'react-router'
import { PROPERTY_TYPE_LABELS, formatPrice, plural } from '../labels'
import type { PropertySearchResult } from '../types/property'
import { HeartIcon, StarIcon } from './icons'
import PropertyPhoto from './PropertyPhoto'

// "Guest favorite" rule (team decision): rated 4.8+ with at least 10 reviews.
function isGuestFavorite(property: { rating: number; review_count: number }) {
  return property.rating >= 4.8 && property.review_count >= 10
}

type Props = {
  property: PropertySearchResult
  saving: boolean // true while the save/unsave request is in flight
  onToggleSave?: () => void // left out = no heart (hosts and the admin can't save stays)
  linkQuery: string // e.g. "check_in=...&check_out=...&guests=2", carried to the property page
}

function ListingCard({ property, saving, onToggleSave, linkQuery }: Props) {
  const typeLabel = PROPERTY_TYPE_LABELS[property.property_type]

  return (
    // "relative" lets the heart button sit on top of the photo. The heart is outside
    // the <Link> because a button inside a link isn't valid HTML.
    <article className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      <Link
        to={`/properties/${property.property_id}${linkQuery ? `?${linkQuery}` : ''}`}
        className="block hover:brightness-110"
      >
        {/* Arch-topped photo, inset inside the card (falls back to a house tile). */}
        <div className="px-3 pt-3">
          <PropertyPhoto photoUrl={property.photo_url} typeLabel={typeLabel} className="h-[190px]" />
        </div>

        <div className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-condensed text-[21px] leading-tight font-bold">{property.title}</h2>
            <span className="flex shrink-0 items-center gap-1 pt-0.5 text-sm">
              <StarIcon className="h-4 w-4 text-gold" />
              {property.review_count > 0 ? (
                <>
                  {property.rating.toFixed(2)} <span className="text-fg-muted">({property.review_count})</span>
                </>
              ) : (
                'New'
              )}
            </span>
          </div>
          <p className="text-sm text-fg-muted">
            {property.city} · {typeLabel} · {plural(property.capacity, 'guest')} · {plural(property.bedrooms, 'bedroom')}
          </p>
          <span className="inline-block rounded-full border border-pill-border bg-pill px-3 py-0.5 font-condensed text-lg font-bold">
            {formatPrice(property.nightly_price)} <span className="text-sm font-semibold text-fg-muted">/ night</span>
          </span>
        </div>
      </Link>

      {isGuestFavorite(property) && (
        <span className="absolute top-6 left-6 flex items-center gap-1 rounded-full bg-gold px-2.5 py-1 text-xs font-bold text-bg">
          <StarIcon className="h-3.5 w-3.5" /> Guest favorite
        </span>
      )}

      {onToggleSave && (
        <button
          type="button"
          onClick={onToggleSave}
          disabled={saving}
          aria-pressed={property.is_saved}
          aria-label={property.is_saved ? `Remove ${property.title} from saved` : `Save ${property.title}`}
          className="absolute top-6 right-6 flex h-9 w-9 items-center justify-center rounded-full bg-bg/80 text-fg hover:bg-bg disabled:cursor-wait disabled:opacity-60"
        >
          <HeartIcon filled={property.is_saved} className={`h-5 w-5 ${property.is_saved ? 'text-primary' : ''}`} />
        </button>
      )}
    </article>
  )
}

export default ListingCard
