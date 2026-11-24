// The guest profile form, shared by "edit profile" and "create a new profile" (P1a, P3a).
// Preferences (P2a): preferred cities as comma-separated text, a max nightly price,
// property types and amenities.
import { useState, type FormEvent, type ReactNode } from 'react'
import { AMENITY_LABELS, PROPERTY_TYPE_LABELS } from '../labels'
import { toggleIn } from '../searchFilters'
import type { CreateGuestRequest, Guest } from '../types/guest'
import { AMENITIES, PROPERTY_TYPES, type Amenity, type PropertyType } from '../types/property'
import ErrorBanner from './ErrorBanner'

// What the inputs hold (text while typing; converted on save).
type FormValues = {
  first_name: string
  last_name: string
  email: string
  phone: string
  location: string
  profile_photo_url: string
  preferred_locations: string // "San Jose, Sunnyvale"
  max_nightly_price: string // '' = no limit
  property_types: PropertyType[]
  amenities: Amenity[]
}

const EMPTY: FormValues = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  location: '',
  profile_photo_url: '',
  preferred_locations: '',
  max_nightly_price: '',
  property_types: [],
  amenities: [],
}

function toFormValues(g: Guest): FormValues {
  return {
    first_name: g.first_name,
    last_name: g.last_name,
    email: g.email,
    phone: g.phone,
    location: g.location,
    profile_photo_url: g.profile_photo_url,
    preferred_locations: g.preferences.preferred_locations.join(', '),
    max_nightly_price: g.preferences.max_nightly_price === null ? '' : String(g.preferences.max_nightly_price),
    property_types: g.preferences.property_types,
    amenities: g.preferences.amenities,
  }
}

// Form values -> the API's guest fields.
function toGuestFields(v: FormValues): CreateGuestRequest {
  return {
    first_name: v.first_name.trim(),
    last_name: v.last_name.trim(),
    email: v.email.trim(),
    phone: v.phone.trim(),
    location: v.location.trim(),
    profile_photo_url: v.profile_photo_url.trim(),
    preferences: {
      preferred_locations: v.preferred_locations
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
      max_nightly_price: v.max_nightly_price === '' ? null : Number(v.max_nightly_price),
      property_types: v.property_types,
      amenities: v.amenities,
    },
  }
}

type Props = {
  guest?: Guest // edit mode when given
  submitLabel: string
  onSubmit: (fields: CreateGuestRequest) => Promise<void> // throw to show an error
  onCancel: () => void
}

const inputClass =
  'w-full rounded-full border border-line bg-surface-2 px-4 py-2 text-fg placeholder:text-fg-muted focus:border-mustard focus:outline-none'

function GuestProfileForm({ guest, submitLabel, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<FormValues>(guest ? toFormValues(guest) : EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSubmit(toGuestFields(values))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Section title="About you">
        <Field label="First name">
          <input required value={values.first_name} onChange={(e) => set('first_name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Last name">
          <input required value={values.last_name} onChange={(e) => set('last_name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Email">
          <input required type="email" value={values.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Phone">
          <input type="tel" value={values.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Home city">
          <input value={values.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Seattle, WA" className={inputClass} />
        </Field>
        <Field label="Profile photo URL (optional)">
          <input type="url" value={values.profile_photo_url} onChange={(e) => set('profile_photo_url', e.target.value)} placeholder="https://…" className={inputClass} />
        </Field>
      </Section>

      <Section title="Preferences">
        <Field label="Preferred cities (comma-separated)">
          <input value={values.preferred_locations} onChange={(e) => set('preferred_locations', e.target.value)} placeholder="San Jose, Sunnyvale" className={inputClass} />
        </Field>
        <Field label="Max nightly price (USD, blank = no limit)">
          <input type="number" min={1} value={values.max_nightly_price} onChange={(e) => set('max_nightly_price', e.target.value)} className={inputClass} />
        </Field>
        <CheckboxGroup
          title="Property types"
          options={PROPERTY_TYPES}
          labels={PROPERTY_TYPE_LABELS}
          selected={values.property_types}
          onToggle={(t) => set('property_types', toggleIn(values.property_types, t))}
        />
        <CheckboxGroup
          title="Must-have amenities"
          options={AMENITIES}
          labels={AMENITY_LABELS}
          selected={values.amenities}
          onToggle={(a) => set('amenities', toggleIn(values.amenities, a))}
        />
      </Section>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-primary px-6 py-2.5 font-semibold text-on-primary hover:brightness-110 disabled:opacity-60"
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full border border-line-strong px-6 py-2.5 font-semibold hover:bg-surface">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------- Layout helpers ----------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2">
      <legend className="px-2 font-condensed text-lg font-bold tracking-[0.06em] uppercase">{title}</legend>
      {children}
    </fieldset>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">{label}</span>
      {children}
    </label>
  )
}

function CheckboxGroup<T extends string>(props: {
  title: string
  options: readonly T[]
  labels: Record<T, string>
  selected: T[]
  onToggle: (value: T) => void
}) {
  return (
    <div className="space-y-2 sm:col-span-2">
      <p className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">{props.title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {props.options.map((o) => (
          <label key={o} className="flex items-center gap-2 text-fg-soft">
            <input type="checkbox" checked={props.selected.includes(o)} onChange={() => props.onToggle(o)} className="h-4 w-4 accent-primary" />
            {props.labels[o]}
          </label>
        ))}
      </div>
    </div>
  )
}

export default GuestProfileForm
