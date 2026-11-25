// Create a listing (/host/listings/new) or edit one (/host/listings/:propertyId/edit).
// One form for both (U3a): every field except latitude/longitude (no geocoding;
// the server defaults them on create and keeps them on edit).
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '../../api/client'
import { createProperty, getProperty, updateProperty } from '../../api/properties'
import ErrorBanner from '../../components/ErrorBanner'
import { useCurrentUser } from '../../context/useCurrentUser'
import { AMENITY_LABELS, PROPERTY_TYPE_LABELS } from '../../labels'
import { toggleIn } from '../../searchFilters'
import { AMENITIES, PROPERTY_TYPES, type Amenity, type Property, type PropertyStatus, type PropertyType } from '../../types/property'

// What the inputs hold. Numbers are kept as text while typing and converted on save.
type FormValues = {
  title: string
  description: string
  property_type: PropertyType
  address: string
  city: string
  state: string
  zip_code: string
  capacity: string
  bedrooms: string
  bathrooms: string
  nightly_price: string
  cleaning_fee: string
  amenities: Amenity[]
  status: PropertyStatus
  photo_url: string
}

const EMPTY_FORM: FormValues = {
  title: '',
  description: '',
  property_type: 'house',
  address: '',
  city: '',
  state: 'CA',
  zip_code: '',
  capacity: '2',
  bedrooms: '1',
  bathrooms: '1',
  nightly_price: '',
  cleaning_fee: '0',
  amenities: [],
  status: 'active',
  photo_url: '',
}

function toFormValues(p: Property): FormValues {
  return {
    title: p.title,
    description: p.description,
    property_type: p.property_type,
    address: p.address,
    city: p.city,
    state: p.state,
    zip_code: p.zip_code,
    capacity: String(p.capacity),
    bedrooms: String(p.bedrooms),
    bathrooms: String(p.bathrooms),
    nightly_price: String(p.nightly_price),
    cleaning_fee: String(p.cleaning_fee),
    amenities: p.amenities,
    status: p.status,
    photo_url: p.photo_url,
  }
}

function ListingFormPage() {
  const { propertyId } = useParams() // undefined on /host/listings/new
  const { hostId } = useCurrentUser()
  return <ListingForm key={`${propertyId ?? 'new'}|${hostId}`} propertyId={propertyId} hostId={hostId} />
}

type Props = { propertyId?: string; hostId: string }

function ListingForm({ propertyId, hostId }: Props) {
  const navigate = useNavigate()
  const isEdit = propertyId !== undefined

  const [values, setValues] = useState<FormValues>(EMPTY_FORM)
  const [ownerId, setOwnerId] = useState<string | null>(null) // the listing's host (edit only)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Edit mode: load the listing into the form.
  useEffect(() => {
    if (!propertyId) return
    let ignore = false
    getProperty({ property_id: propertyId })
      .then((property) => {
        if (ignore) return
        setValues(toFormValues(property))
        setOwnerId(property.host_id)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (ignore) return
        setLoadError(errorMessage(err))
        setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [propertyId, attempt])

  // Changes one field, keeping the others.
  function set<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((previous) => ({ ...previous, [field]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaveError(null)
    const fields = {
      title: values.title.trim(),
      description: values.description.trim(),
      property_type: values.property_type,
      address: values.address.trim(),
      city: values.city.trim(),
      state: values.state.trim(),
      zip_code: values.zip_code.trim(),
      capacity: Number(values.capacity),
      bedrooms: Number(values.bedrooms),
      bathrooms: Number(values.bathrooms),
      nightly_price: Number(values.nightly_price),
      cleaning_fee: Number(values.cleaning_fee),
      amenities: values.amenities,
      status: values.status,
      photo_url: values.photo_url.trim(),
    }
    try {
      const saved = propertyId !== undefined
        ? await updateProperty({ property_id: propertyId, host_id: hostId, ...fields })
        : await createProperty({ host_id: hostId, latitude: 0, longitude: 0, ...fields })
      navigate('/host/listings', { state: { notice: `${isEdit ? 'Saved' : 'Created'} “${saved.title}”.` } })
    } catch (err) {
      setSaveError(errorMessage(err))
      setSaving(false)
    }
  }

  const backLink = (
    <Link to="/host/listings" className="text-sm font-semibold text-fg-muted hover:text-fg">
      ← My listings
    </Link>
  )

  if (loading) return <section className="space-y-4">{backLink}<p className="text-fg-muted">Loading listing…</p></section>

  if (loadError) {
    return (
      <section className="space-y-4">
        {backLink}
        <ErrorBanner
          message={loadError}
          onRetry={() => {
            setLoadError(null)
            setLoading(true)
            setAttempt((n) => n + 1)
          }}
        />
      </section>
    )
  }

  // No login yet: only the owner sees the edit form (U9a). The server's 403 is the backstop.
  if (isEdit && ownerId !== hostId) {
    return (
      <section className="space-y-4">
        {backLink}
        <div className="rounded-2xl border border-line bg-surface p-6">
          <p className="text-fg-soft">This listing belongs to another host.</p>
          <p className="mt-1 text-sm text-fg-muted">Log in as its host to edit it.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="max-w-3xl space-y-6">
      {backLink}
      <h1 className="cornice font-display text-3xl font-bold">{isEdit ? 'Edit listing' : 'New listing'}</h1>

      <form onSubmit={submit} className="space-y-6">
        <Fieldset title="Basics">
          <Field label="Title" wide>
            <input required value={values.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Description" wide>
            <textarea rows={4} value={values.description} onChange={(e) => set('description', e.target.value)} className={textareaClass} />
          </Field>
          <Field label="Property type">
            <select value={values.property_type} onChange={(e) => set('property_type', e.target.value as PropertyType)} className={inputClass}>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROPERTY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={values.status} onChange={(e) => set('status', e.target.value as PropertyStatus)} className={inputClass}>
              <option value="active">Active (guests can find and book it)</option>
              <option value="inactive">Inactive (hidden from search)</option>
            </select>
          </Field>
        </Fieldset>

        <Fieldset title="Location">
          <Field label="Street address" wide>
            <input required value={values.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />
          </Field>
          <Field label="City">
            <input required value={values.city} onChange={(e) => set('city', e.target.value)} className={inputClass} />
          </Field>
          <Field label="State">
            <input required value={values.state} onChange={(e) => set('state', e.target.value)} className={inputClass} />
          </Field>
          <Field label="ZIP code">
            <input required value={values.zip_code} onChange={(e) => set('zip_code', e.target.value)} className={inputClass} />
          </Field>
        </Fieldset>

        <Fieldset title="Space and price">
          <Field label="Max guests">
            <input required type="number" min={1} step={1} value={values.capacity} onChange={(e) => set('capacity', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Bedrooms">
            <input required type="number" min={0} step={1} value={values.bedrooms} onChange={(e) => set('bedrooms', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Bathrooms">
            <input required type="number" min={0} step={0.5} value={values.bathrooms} onChange={(e) => set('bathrooms', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Nightly price (USD)">
            <input required type="number" min={1} step="any" value={values.nightly_price} onChange={(e) => set('nightly_price', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Cleaning fee (USD)">
            <input required type="number" min={0} step="any" value={values.cleaning_fee} onChange={(e) => set('cleaning_fee', e.target.value)} className={inputClass} />
          </Field>
        </Fieldset>

        <Fieldset title="Amenities">
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-3">
            {AMENITIES.map((amenity) => (
              <label key={amenity} className="flex items-center gap-2 text-fg-soft">
                <input
                  type="checkbox"
                  checked={values.amenities.includes(amenity)}
                  onChange={() => set('amenities', toggleIn(values.amenities, amenity))}
                  className="h-4 w-4 accent-primary"
                />
                {AMENITY_LABELS[amenity]}
              </label>
            ))}
          </div>
        </Fieldset>

        <Fieldset title="Photo">
          <Field label="Photo URL (optional)" wide>
            <input type="text" value={values.photo_url} onChange={(e) => set('photo_url', e.target.value)} placeholder="https://… or /photos/p_001.jpg" className={inputClass} />
          </Field>
        </Fieldset>

        {saveError && <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-primary px-6 py-2.5 font-semibold text-on-primary hover:brightness-110 disabled:opacity-60"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create listing'}
          </button>
          <Link to="/host/listings" className="rounded-full border border-line-strong px-6 py-2.5 font-semibold hover:bg-surface">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  )
}

// ---------- Small layout helpers for the form ----------

const inputClass =
  'w-full rounded-full border border-line bg-surface-2 px-4 py-2 text-fg placeholder:text-fg-muted focus:border-gold focus:outline-none'
// Multi-line boxes use a normal rounded corner; a full pill shape looks odd on a tall box.
const textareaClass =
  'w-full rounded-2xl border border-line bg-surface-2 px-4 py-2 text-fg placeholder:text-fg-muted focus:border-gold focus:outline-none'

function Fieldset({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2">
      <legend className="px-2 font-condensed text-lg font-bold tracking-[0.06em] uppercase">{title}</legend>
      {children}
    </fieldset>
  )
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`block space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">{label}</span>
      {children}
    </label>
  )
}

export default ListingFormPage
