// Log in with email + password (User Service, POST /auth/login).
// After logging in you go back to "?next=" (where you were), or to your role's home page.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { errorMessage } from '../../api/client'
import { HOME, safeNext, useAuth } from '../../auth/useAuth'
import ErrorBanner from '../../components/ErrorBanner'
import { mocksEnabled } from '../../config'
import type { Role } from '../../types/auth'
import { inputClass, labelClass } from './formClasses'

type DemoAccount = { email: string; role: Role; name: string }

function LoginPage() {
  const { user, logIn } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const next = safeNext(searchParams.get('next'))
  const note = (location.state as { note?: string } | null)?.note

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Demo accounts (team decision A11a): only with mocks on, loaded from the mock data.
  const [demo, setDemo] = useState<{ accounts: DemoAccount[]; password: string } | null>(null)
  useEffect(() => {
    if (!mocksEnabled) return
    import('../../mocks/data/accounts').then((m) => setDemo({ accounts: m.demoAccounts, password: m.DEMO_PASSWORD }))
  }, [])

  // Already logged in (e.g. pressed Back): nothing to do here.
  if (user && !submitting) return <Navigate to={next ?? HOME[user.role]} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const loggedIn = await logIn({ email: email.trim(), password })
      navigate(next ?? HOME[loggedIn.role], { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-6">
      <h1 className="cornice font-display text-4xl font-bold">Log in</h1>
      {note && (
        <p role="status" className="rounded-2xl border border-status-pending p-3 text-sm text-status-pending">
          {note}
        </p>
      )}
      {next && !note && <p className="text-fg-soft">Log in to continue.</p>}

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6">
        <label className="block space-y-1">
          <span className={labelClass}>Email</span>
          <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Password</span>
          <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </label>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-primary py-3 font-semibold text-on-primary hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-center text-sm text-fg-muted">
          New here?{' '}
          <Link to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </form>

      {demo && (
        <details data-demo-accounts className="rounded-2xl border border-line bg-surface p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-fg-soft">
            Demo accounts (mock data, password <span className="font-mono">{demo.password}</span>)
          </summary>
          <ul className="mt-3 grid gap-1">
            {demo.accounts.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(a.email)
                    setPassword(demo.password)
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-surface-2"
                >
                  <span className="w-12 font-condensed text-xs font-bold tracking-[0.08em] text-gold uppercase">{a.role}</span>
                  <span className="text-fg">{a.name}</span>
                  <span className="ml-auto font-mono text-xs text-fg-muted">{a.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

export default LoginPage
