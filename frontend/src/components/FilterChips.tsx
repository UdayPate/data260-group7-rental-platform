// Building blocks shared by the guest filter strip and the host listings strip:
// a pill chip, the panel box that opens under a chip, and a checkbox list.
import type { ReactNode } from 'react'

type ChipProps = {
  active: boolean
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  title?: string
  expanded?: boolean // for chips that open a panel
}

// One pill: mustard when active, white when not.
export function Chip({ active, onClick, children, disabled = false, title, expanded }: ChipProps) {
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
export function PanelBox({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-full left-0 z-20 mt-2 min-w-56 rounded-2xl border border-cream-border bg-white p-4 text-cream-ink shadow-lg">
      {children}
    </div>
  )
}

// A checkbox list used by the Type and More panels.
export function CheckboxList<T extends string>(props: {
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
