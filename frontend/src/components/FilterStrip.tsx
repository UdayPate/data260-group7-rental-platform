// The cream filter strip under the header on the search page.
// Chips apply immediately by changing the URL; the search page reacts to the URL.
// Price, Type and More open a small panel; it closes on a click outside or the Escape key.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { AMENITY_LABELS, PROPERTY_TYPE_LABELS, formatPrice } from '../labels'
import { RATING_CHIP_VALUE, readFilters, writeFilters, type SearchFilters } from '../searchFilters'
import { AMENITIES, PROPERTY_TYPES, type Amenity, type PropertyType } from '../types/property'
import { ChevronDownIcon, StarIcon } from './icons'

// Amenities shown as their own chips; the rest are under "More".
const QUICK_AMENITIES: Amenity[] = ['parking', 'kitchen', 'wifi', 'washer', 'workspace']
const MORE_AMENITIES = AMENITIES.filter((a) => !QUICK_AMENITIES.includes(a))

type Panel = 'price' | 'type' | 'more' | null

// ---------- Small building blocks ----------

type ChipProps = {
  active: boolean
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  title?: string
  expanded?: boolean // for chips that open a panel
}

// One pill: mustard when active, white when not.
function Chip({ active, onClick, children, disabled = false, title, expanded }: ChipProps) {
  const colors = active ? 'border-mustard-border bg-mustard' : 'border-cream-border bg-white'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={expanded === undefined ? active : undefined}
      aria-expanded={expanded}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap text-cream-ink ${colors} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  )
}

// The box that opens under a chip.
function PanelBox({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-full left-0 z-20 mt-2 min-w-56 rounded-2xl border border-cream-border bg-white p-4 text-cream-ink shadow-lg">
      {children}
    </div>
  )
}

// A checkbox list used by the Type and More panels.
function CheckboxList<T extends string>(props: {
  options: readonly T[]
  labels: Record<T, string>
  selected: T[]
  onToggle: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {props.options.map((option) => (
        <label key={option} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={props.selected.includes(option)}
            onChange={() => props.onToggle(option)}
            className="h-4 w-4 accent-primary"
          />
          {props.labels[option]}
        </label>
      ))}
    </div>
  )
}

// Min/max price inputs. It has its own typing state and only changes the URL on Apply.
function PricePanel(props: { min: number | null; max: number | null; onApply: (min: number | null, max: number | null) => void }) {
  const [min, setMin] = useState(props.min === null ? '' : String(props.min))
  const [max, setMax] = useState(props.max === null ? '' : String(props.max))
  const inputClass = 'w-24 rounded-full border border-cream-border px-3 py-1 text-sm'
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        props.onApply(min === '' ? null : Number(min), max === '' ? null : Number(max))
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-sm text-cream-ink-soft">Nightly price (USD)</p>
      <div className="flex items-center gap-2">
        <input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} placeholder="Min" aria-label="Minimum price" className={inputClass} />
        <span>–</span>
        <input type="number" min={0} value={max} onChange={(e) => setMax(e.target.value)} placeholder="Max" aria-label="Maximum price" className={inputClass} />
      </div>
      <button type="submit" className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary">
        Apply
      </button>
    </form>
  )
}

// Adds the value if it's missing, removes it if it's there.
function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

// ---------- The strip ----------

function FilterStrip() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = readFilters(searchParams)
  const [openPanel, setOpenPanel] = useState<Panel>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  // While a panel is open, close it on a click outside the strip or on Escape.
  useEffect(() => {
    if (openPanel === null) return
    function onPointerDown(event: PointerEvent) {
      if (!stripRef.current?.contains(event.target as Node)) setOpenPanel(null)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenPanel(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openPanel])

  // Changes some filters and puts the result in the URL (which triggers a new search).
  function update(changes: Partial<SearchFilters>) {
    setSearchParams(writeFilters({ ...filters, ...changes }))
  }

  const togglePanel = (panel: Panel) => setOpenPanel(openPanel === panel ? null : panel)
  const hasDates = filters.check_in !== '' && filters.check_out !== ''
  const moreCount = filters.amenities.filter((a) => MORE_AMENITIES.includes(a)).length

  // Price chip text: "Price", "$100–$250", "From $100", "Up to $250".
  let priceLabel = 'Price'
  if (filters.min_price !== null && filters.max_price !== null) {
    priceLabel = `${formatPrice(filters.min_price)}–${formatPrice(filters.max_price)}`
  } else if (filters.min_price !== null) {
    priceLabel = `From ${formatPrice(filters.min_price)}`
  } else if (filters.max_price !== null) {
    priceLabel = `Up to ${formatPrice(filters.max_price)}`
  }

  return (
    <div className="bg-cream">
      <div ref={stripRef} className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative">
          <Chip active={filters.min_price !== null || filters.max_price !== null} expanded={openPanel === 'price'} onClick={() => togglePanel('price')}>
            {priceLabel} <ChevronDownIcon className="h-3.5 w-3.5" />
          </Chip>
          {openPanel === 'price' && (
            <PanelBox>
              <PricePanel
                min={filters.min_price}
                max={filters.max_price}
                onApply={(min, max) => {
                  update({ min_price: min, max_price: max })
                  setOpenPanel(null)
                }}
              />
            </PanelBox>
          )}
        </div>

        <div className="relative">
          <Chip active={filters.types.length > 0} expanded={openPanel === 'type'} onClick={() => togglePanel('type')}>
            {filters.types.length > 0 ? `Type · ${filters.types.length}` : 'Type'} <ChevronDownIcon className="h-3.5 w-3.5" />
          </Chip>
          {openPanel === 'type' && (
            <PanelBox>
              <CheckboxList<PropertyType>
                options={PROPERTY_TYPES}
                labels={PROPERTY_TYPE_LABELS}
                selected={filters.types}
                onToggle={(type) => update({ types: toggleIn(filters.types, type) })}
              />
            </PanelBox>
          )}
        </div>

        <Chip
          active={filters.min_rating === RATING_CHIP_VALUE}
          onClick={() => update({ min_rating: filters.min_rating === RATING_CHIP_VALUE ? null : RATING_CHIP_VALUE })}
        >
          <StarIcon className="h-3.5 w-3.5" /> {RATING_CHIP_VALUE}+
        </Chip>

        <Chip
          active={filters.available_only}
          disabled={!hasDates}
          title={hasDates ? undefined : 'Pick check-in and check-out dates first'}
          onClick={() => update({ available_only: !filters.available_only })}
        >
          Available only
        </Chip>

        <span className="mx-1 h-6 w-px bg-cream-border" aria-hidden="true" />

        {QUICK_AMENITIES.map((amenity) => (
          <Chip
            key={amenity}
            active={filters.amenities.includes(amenity)}
            onClick={() => update({ amenities: toggleIn(filters.amenities, amenity) })}
          >
            {AMENITY_LABELS[amenity]}
          </Chip>
        ))}

        <div className="relative">
          <Chip active={moreCount > 0} expanded={openPanel === 'more'} onClick={() => togglePanel('more')}>
            {moreCount > 0 ? `More · ${moreCount}` : 'More'} <ChevronDownIcon className="h-3.5 w-3.5" />
          </Chip>
          {openPanel === 'more' && (
            <PanelBox>
              <CheckboxList<Amenity>
                options={MORE_AMENITIES}
                labels={AMENITY_LABELS}
                selected={filters.amenities}
                onToggle={(amenity) => update({ amenities: toggleIn(filters.amenities, amenity) })}
              />
            </PanelBox>
          )}
        </div>

        <span className="mx-1 h-6 w-px bg-cream-border" aria-hidden="true" />

        {/* Clears the strip's filters; where / dates / guests from the search bar stay. */}
        <button
          type="button"
          onClick={() =>
            update({ min_price: null, max_price: null, types: [], amenities: [], min_rating: null, available_only: false })
          }
          className="text-sm font-semibold text-cream-ink underline-offset-2 hover:underline"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

export default FilterStrip
