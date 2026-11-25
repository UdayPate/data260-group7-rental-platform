// Star ratings: a read-only row of stars, and a 1-5 picker for writing a review (T2a).
import { StarIcon } from './icons'

// Read-only, e.g. ★★★★☆ for 4. The number is read out to screen readers.
export function StarRating({ value, size = 'h-4 w-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} className={`${size} ${n <= value ? 'text-gold' : 'text-line-strong'}`} />
      ))}
    </span>
  )
}

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

// Five star buttons. role="radiogroup"/"radio" tells screen readers it's a one-of-five choice;
// each button is reachable with Tab and has a spoken label ("4 stars, Very good").
export function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Your rating" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}, ${WORDS[n]}`}
            onClick={() => onChange(n)}
            className="rounded-full p-1 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            <StarIcon className={`h-8 w-8 ${n <= value ? 'text-gold' : 'text-line-strong hover:text-gold-border'}`} />
          </button>
        ))}
      </div>
      <span className="text-fg-soft">{value > 0 ? WORDS[value] : 'Pick a rating'}</span>
    </div>
  )
}
