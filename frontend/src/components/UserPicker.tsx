// "Viewing as" dropdown in the header: pick which demo guest (guest mode) or
// demo host (host mode) we're acting as. Names come from the User Service.
import { useEffect, useState } from 'react'
import { errorMessage } from '../api/client'
import { getHost, searchGuests } from '../api/users'
import { useCurrentUser } from '../context/useCurrentUser'

// The spec has no "list hosts" endpoint, so the demo hosts are a fixed list of ids
// (team decision). Their names are loaded with /hosts/get.
const DEMO_HOST_IDS = ['h_001', 'h_002', 'h_003', 'h_004', 'h_005', 'h_006', 'h_007', 'h_008']

type Option = { id: string; name: string }

async function loadGuests(): Promise<Option[]> {
  const result = await searchGuests({ page: 1, page_size: 100 })
  return result.items.map((g) => ({ id: g.guest_id, name: `${g.first_name} ${g.last_name}` }))
}

async function loadHosts(): Promise<Option[]> {
  // Promise.all runs the 8 requests at the same time and waits for all of them.
  const hosts = await Promise.all(DEMO_HOST_IDS.map((id) => getHost({ host_id: id })))
  return hosts.map((h) => ({ id: h.host_id, name: h.name }))
}

type Props = { mode: 'guest' | 'host' }

// The header renders this with key={mode}, so switching mode starts it fresh (new list, loading again).
function UserPicker({ mode }: Props) {
  const { guestId, hostId, setGuestId, setHostId } = useCurrentUser()
  const currentId = mode === 'guest' ? guestId : hostId
  const setCurrentId = mode === 'guest' ? setGuestId : setHostId

  const [options, setOptions] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0) // bumped by Retry to load again

  useEffect(() => {
    let ignore = false // set when this effect is cleaned up, so a late answer is ignored
    const load = mode === 'guest' ? loadGuests : loadHosts
    load()
      .then((list) => {
        if (ignore) return
        setOptions(list)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (ignore) return
        setError(errorMessage(err))
        setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [mode, attempt])

  // If the saved user no longer exists (e.g. that guest deleted their profile),
  // fall back to the first one in the list.
  const savedUserMissing = options.length > 0 && !options.some((o) => o.id === currentId)
  useEffect(() => {
    if (savedUserMissing) setCurrentId(options[0].id)
  }, [savedUserMissing, options, setCurrentId])

  function retry() {
    setError(null)
    setLoading(true)
    setAttempt((n) => n + 1)
  }

  const label = <span className="font-condensed text-xs font-bold tracking-[0.08em] whitespace-nowrap text-fg-muted uppercase">Viewing as</span>

  if (loading) {
    return <div className="flex items-center gap-2">{label}<span className="text-sm text-fg-muted">Loading…</span></div>
  }

  if (error) {
    return (
      <div className="flex max-w-xs items-center gap-2" role="alert">
        <span className="truncate text-sm text-status-error" title={error}>
          Couldn’t load {mode}s: {error}
        </span>
        <button type="button" onClick={retry} className="rounded-full border border-status-error-border px-3 py-0.5 text-sm text-status-error">
          Retry
        </button>
      </div>
    )
  }

  return (
    <label className="flex items-center gap-2">
      {label}
      <select
        value={currentId}
        onChange={(e) => setCurrentId(e.target.value)}
        className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.id}
          </option>
        ))}
      </select>
    </label>
  )
}

export default UserPicker
