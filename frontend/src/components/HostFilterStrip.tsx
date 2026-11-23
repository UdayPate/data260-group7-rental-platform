// The cream strip on the host's "My listings" page: city/address search, Type ▾,
// Active / Inactive, Clear. Like the guest strip, it only changes the URL;
// the listings page reads the URL and asks /properties/search (with host_id).
import { useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { PROPERTY_TYPE_LABELS } from '../labels'
import { readHostFilters, toggleIn, writeHostFilters, type HostListingFilters } from '../searchFilters'
import { PROPERTY_TYPES, type PropertyStatus, type PropertyType } from '../types/property'
import { usePanelDismiss } from '../usePanelDismiss'
import { CheckboxList, Chip, PanelBox } from './FilterChips'
import { ChevronDownIcon, SearchIcon } from './icons'

function HostFilterStrip() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = readHostFilters(searchParams)
  const [location, setLocation] = useState(filters.location) // typing; applied on Enter
  const [typeOpen, setTypeOpen] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
  usePanelDismiss(typeOpen, stripRef, () => setTypeOpen(false))

  function update(changes: Partial<HostListingFilters>) {
    setSearchParams(writeHostFilters({ ...filters, ...changes }))
  }

  function submitLocation(event: FormEvent) {
    event.preventDefault()
    update({ location: location.trim() })
  }

  // Clicking the active status chip again turns the status filter off.
  const toggleStatus = (status: PropertyStatus) => update({ status: filters.status === status ? null : status })

  return (
    <div className="bg-cream">
      <div ref={stripRef} className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-6 py-3">
        <form onSubmit={submitLocation} role="search" className="flex items-center rounded-full border border-cream-border bg-white pr-1 pl-3.5">
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or address"
            aria-label="Filter my listings by city or address"
            className="w-44 bg-transparent py-1.5 text-sm text-cream-ink placeholder:text-cream-ink-soft focus:outline-none"
          />
          <button type="submit" aria-label="Apply" className="rounded-full p-1.5 text-cream-ink hover:bg-cream">
            <SearchIcon className="h-4 w-4" />
          </button>
        </form>

        <div className="relative">
          <Chip active={filters.types.length > 0} expanded={typeOpen} onClick={() => setTypeOpen(!typeOpen)}>
            {filters.types.length > 0 ? `Type · ${filters.types.length}` : 'Type'} <ChevronDownIcon className="h-3.5 w-3.5" />
          </Chip>
          {typeOpen && (
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

        <span className="mx-1 h-6 w-px bg-cream-border" aria-hidden="true" />

        <Chip active={filters.status === 'active'} onClick={() => toggleStatus('active')}>
          Active
        </Chip>
        <Chip active={filters.status === 'inactive'} onClick={() => toggleStatus('inactive')}>
          Inactive
        </Chip>

        <span className="mx-1 h-6 w-px bg-cream-border" aria-hidden="true" />

        <button
          type="button"
          onClick={() => {
            setLocation('')
            setSearchParams(new URLSearchParams())
          }}
          className="text-sm font-semibold text-cream-ink underline-offset-2 hover:underline"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

export default HostFilterStrip
