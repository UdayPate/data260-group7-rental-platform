// Read-only calendar of this month and next (team decision D3a).
// Each day is one NIGHT: it's unavailable if a blocked/booked block covers it.
// The guest's picked nights (check-in up to, not including, check-out) are outlined.
import { isNightUnavailable } from '../availability'
import { dateString, localDate } from '../dates'
import type { AvailabilityBlock } from '../types/availability'

type Props = {
  blocks: AvailabilityBlock[]
  checkIn: string // '' if not picked yet
  checkOut: string
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function Month({ year, month, blocks, checkIn, checkOut }: Props & { year: number; month: number }) {
  const today = localDate()
  const firstWeekday = new Date(year, month - 1, 1).getDay() // 0 = Sunday
  const daysInMonth = new Date(year, month, 0).getDate() // day 0 of next month = last day of this one
  const title = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div>
      <h3 className="mb-2 font-condensed text-lg font-bold tracking-[0.06em] uppercase">{title}</h3>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-xs text-fg-muted">
            {d}
          </div>
        ))}
        {/* Empty cells so day 1 lands on the right weekday */}
        {Array.from({ length: firstWeekday }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1
          const date = dateString(year, month, day)
          const past = date < today
          const unavailable = !past && isNightUnavailable(blocks, date)
          const picked = checkIn !== '' && checkOut !== '' && checkIn <= date && date < checkOut

          let style = 'text-fg'
          if (past) style = 'text-fg-muted opacity-40'
          else if (unavailable) style = 'bg-surface-2 text-fg-muted line-through'
          const outline = picked ? (unavailable ? 'ring-2 ring-status-error' : 'ring-2 ring-mustard') : ''

          return (
            <div
              key={date}
              data-date={date}
              data-unavailable={unavailable || undefined}
              title={unavailable ? 'Unavailable' : undefined}
              className={`rounded-lg py-1.5 ${style} ${outline}`}
            >
              {day}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AvailabilityCalendar({ blocks, checkIn, checkOut }: Props) {
  const now = new Date()
  const thisMonth = { year: now.getFullYear(), month: now.getMonth() + 1 }
  const nextMonth = thisMonth.month === 12 ? { year: thisMonth.year + 1, month: 1 } : { year: thisMonth.year, month: thisMonth.month + 1 }

  return (
    <div>
      <div className="grid gap-8 sm:grid-cols-2">
        <Month {...thisMonth} blocks={blocks} checkIn={checkIn} checkOut={checkOut} />
        <Month {...nextMonth} blocks={blocks} checkIn={checkIn} checkOut={checkOut} />
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-sm text-fg-muted">
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded bg-surface-2" /> <span className="line-through">12</span> Unavailable
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded ring-2 ring-mustard" /> Your nights
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded ring-2 ring-status-error" /> Your nights, but unavailable
        </span>
      </div>
    </div>
  )
}

export default AvailabilityCalendar
