// The pill search bar in the header (guest mode): where, check-in, check-out, guests.
// Typing doesn't search yet; clicking Search puts the values in the URL and goes to "/search",
// where the search page reads them. Filters from the travertine strip are kept.
import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { localDate } from '../dates'
import { readFilters, writeFilters } from '../searchFilters'
import { SearchIcon } from './icons'

const GUEST_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] // 8 = the largest listing

const fieldClass = 'flex flex-col px-4'
const labelClass = 'font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase'
// [color-scheme:dark] makes the browser draw its date picker icon light, for our dark background
const inputClass = 'bg-transparent text-fg placeholder:text-fg-muted focus:outline-none [color-scheme:dark]'

// The header gives this a key that changes with the URL, so the fields always
// start from what's currently in the URL.
function SearchBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  // Only the search page's URL holds search filters; on other pages start empty.
  const current = readFilters(pathname === '/search' ? searchParams : new URLSearchParams())

  const [location, setLocation] = useState(current.location)
  const [checkIn, setCheckIn] = useState(current.check_in)
  const [checkOut, setCheckOut] = useState(current.check_out)
  const [guests, setGuests] = useState(current.guests === null ? '' : String(current.guests))

  function changeCheckIn(value: string) {
    setCheckIn(value)
    // A check-out on or before the new check-in no longer makes sense: clear it.
    if (checkOut && value && checkOut <= value) setCheckOut('')
  }

  function submit(event: FormEvent) {
    event.preventDefault() // stop the browser's own form submit (a full page reload)
    const hasDates = checkIn !== '' && checkOut !== ''
    const hadDates = current.check_in !== '' && current.check_out !== ''
    const next = {
      ...current, // keep the strip filters (price, type, amenities, ...)
      location: location.trim(),
      check_in: checkIn,
      check_out: checkOut,
      guests: guests === '' ? null : Number(guests),
      // "Available only" switches on when dates are first added (team decision),
      // keeps whatever the guest chose if dates were already there, and is off without dates.
      available_only: hasDates ? (hadDates ? current.available_only : true) : false,
    }
    navigate(`/search?${writeFilters(next).toString()}`)
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      className="mx-auto flex w-fit items-center divide-x divide-line rounded-full border border-line bg-surface-2 py-1.5 pr-1.5 pl-3"
    >
      <label className={fieldClass}>
        <span className={labelClass}>Where</span>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="City or address"
          className={`${inputClass} w-40`}
        />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Check-in</span>
        <input
          type="date"
          value={checkIn}
          min={localDate()}
          onChange={(e) => changeCheckIn(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Check-out</span>
        <input
          type="date"
          value={checkOut}
          // At least one night: the day after check-in (or tomorrow if no check-in yet).
          min={checkIn ? localDate(1, checkIn) : localDate(1)}
          onChange={(e) => setCheckOut(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Guests</span>
        <select value={guests} onChange={(e) => setGuests(e.target.value)} className={`${inputClass} pr-2`}>
          <option value="">Any</option>
          {GUEST_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="pl-3">
        <button
          type="submit"
          className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-semibold text-on-primary hover:brightness-110"
        >
          <SearchIcon className="h-4 w-4" />
          Search
        </button>
      </div>
    </form>
  )
}

export default SearchBar
