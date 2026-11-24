// Create an account (User Service, POST /auth/signup). A guest account or a host account;
// one person isn't both, and there is no admin sign-up. Signing up also logs you in.
// Guests add their preferences later on the Profile page (team decision A6a).
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError, errorMessage } from '../../api/client'
import { HOME, safeNext, useAuth } from '../../auth/useAuth'
import ErrorBanner from '../../components/ErrorBanner'
import { inputClass, labelClass } from './formClasses'

type AccountType = 'guest' | 'host'

const EMPTY = { email: '', password: '', first_name: '', last_name: '', name: '', phone: '', location: '' }

function SignupPage() {
  const { user, signUp } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = safeNext(searchParams.get('next'))

  const [type, setType] = useState<AccountType>('guest')
  const [values, setValues] = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; emailTaken: boolean } | null>(null)

  if (user && !submitting) return <Navigate to={next ?? HOME[user.role]} replace />

  const set = (field: keyof typeof EMPTY, value: string) => setValues((v) => ({ ...v, [field]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const common = { email: values.email.trim(), password: values.password, phone: values.phone.trim() }
    try {
      const created =
        type === 'guest'
          ? await signUp({ role: 'guest', ...common, first_name: values.first_name.trim(), last_name: values.last_name.trim(), location: values.location.trim() })
          : await signUp({ role: 'host', ...common, name: values.name.trim() })
      navigate(next ?? HOME[created.role], { replace: true })
    } catch (err) {
      setError({ message: errorMessage(err), emailTaken: err instanceof ApiError && err.code === 'EMAIL_TAKEN' })
      setSubmitting(false)
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-6">
      <h1 className="font-display text-4xl font-bold">Create an account</h1>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6">
        <fieldset className="space-y-2">
          <legend className={labelClass}>I want to</legend>
          <div className="flex rounded-full bg-surface-2 p-1">
            {(['guest', 'host'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={`flex-1 rounded-full px-4 py-1.5 font-semibold ${type === t ? 'bg-mustard text-bg' : 'text-fg-muted'}`}
              >
                {t === 'guest' ? 'Book stays (guest)' : 'List my place (host)'}
              </button>
            ))}
          </div>
        </fieldset>

        {type === 'guest' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={labelClass}>First name</span>
              <input required value={values.first_name} onChange={(e) => set('first_name', e.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Last name</span>
              <input required value={values.last_name} onChange={(e) => set('last_name', e.target.value)} className={inputClass} />
            </label>
          </div>
        ) : (
          <label className="block space-y-1">
            <span className={labelClass}>Name</span>
            <input required value={values.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
          </label>
        )}

        <label className="block space-y-1">
          <span className={labelClass}>Email</span>
          <input required type="email" autoComplete="email" value={values.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Password (at least 8 characters)</span>
          <input
            required
            type="password"
            minLength={8}
            autoComplete="new-password"
            value={values.password}
            onChange={(e) => set('password', e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Phone</span>
          <input required type="tel" value={values.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} />
        </label>
        {type === 'guest' && (
          <label className="block space-y-1">
            <span className={labelClass}>Where you live</span>
            <input required value={values.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Seattle, WA" className={inputClass} />
          </label>
        )}

        {error && (
          <ErrorBanner message={error.message} onDismiss={() => setError(null)}>
            {error.emailTaken && (
              <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="mt-1 inline-block text-sm font-semibold text-primary hover:underline">
                Go to log in
              </Link>
            )}
          </ErrorBanner>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-primary py-3 font-semibold text-on-primary hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
        <p className="text-center text-sm text-fg-muted">
          Already have an account?{' '}
          <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-primary hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </section>
  )
}

export default SignupPage
