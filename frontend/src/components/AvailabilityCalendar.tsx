// Read-only calendar of this month and next (team decision D3a).
// Each day is one NIGHT: it's unavailable if a blocked/booked block covers it.
// The picked nights (start up to, not including, end) are outlined.
// Guest view: all unavailable nights look the same.
// Host view (U5a): nights the host blocked are teal; nights held by reservations are struck through.
import { blockForNight } from '../availability'
import { dateString, localDate } from '../dates'
import type { AvailabilityBlock } from '../types/availability'

type Props = {
  blocks: AvailabilityBlock[]
  checkIn: string // first picked night, '' if none
  checkOut: string // day after the last picked night, '' if none
  hostView?: boolean
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function Month({ year, month, blocks, checkIn, checkOut, hostView = false }: Props & { year: number; month: number }) {
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
          const block = past ? undefined : blockForNight(blocks, date)
          const blockedByHost = hostView && block?.source === 'host'
          const picked = checkIn !== '' && checkOut !== '' && checkIn <= date && date < checkOut

          let style = 'text-fg'
          let label: string | undefined
          if (past) style = 'text-fg-muted opacity-40'
          else if (blockedByHost) {
            style = 'bg-teal font-semibold text-bg'
            label = 'Blocked by you'
          } else if (block) {
            style = 'bg-surface-2 text-fg-muted line-through'
            label = hostView ? 'Booked by a guest' : 'Unavailable'
          }
          const outline = picked ? (block ? 'ring-2 ring-status-error' : 'ring-2 ring-mustard') : ''

          return (
            <div
              key={date}
              data-date={date}
              data-unavailable={block ? true : undefined}
              data-source={block?.source}
              title={label}
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

function AvailabilityCalendar(props: Props) {
  const now = new Date()
  const thisMonth = { year: now.getFullYear(), month: now.getMonth() + 1 }
  const nextMonth = thisMonth.month === 12 ? { year: thisMonth.year + 1, month: 1 } : { year: thisMonth.year, month: thisMonth.month + 1 }
  const picked = props.hostView ? 'Selected nights' : 'Your nights'

  return (
    <div>
      <div className="grid gap-8 sm:grid-cols-2">
        <Month {...thisMonth} {...props} />
        <Month {...nextMonth} {...props} />
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-sm text-fg-muted">
        {props.hostView && (
          <span className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded bg-teal" /> Blocked by you
          </span>
        )}
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded bg-surface-2" /> <span className="line-through">12</span>{' '}
          {props.hostView ? 'Booked by a guest' : 'Unavailable'}
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded ring-2 ring-mustard" /> {picked}
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded ring-2 ring-status-error" /> {picked}, but unavailable
        </span>
      </div>
    </div>
  )
}

export default AvailabilityCalendar
